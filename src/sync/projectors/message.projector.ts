import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  InstagramMessageReceivedEvent,
  WhatsappMessageReceivedEvent,
} from '../events/data-events.types'

type MessageReceived = WhatsappMessageReceivedEvent | InstagramMessageReceivedEvent

/**
 * Shape used by outbound channels (slack send, future agent reply). Same
 * underlying UnifiedMessage row, but sender='BOT' and conversationId
 * may be null because some channels (slack) don't model conversations
 * server-side.
 */
interface MessageSent {
  messageId: string
  externalMessageId?: string | null
  recipient: string
  channelUserId?: string | null
  conversationId?: string | null
  userId?: string | null
  content: string
  mediaUrl?: string | null
  timestamp?: string
}

/**
 * Projects `data.<channel>.message.received` events into UnifiedMessage AND
 * updates the parent UnifiedConversation counters in the same logical unit.
 *
 * Uses the producer's `messageId` as `_id` for idempotency. On replay we
 * `upsert`, but we ONLY increment counters when the message was newly
 * created — otherwise replaying a backfill would inflate counts.
 */
@Injectable()
export class MessageProjector {
  private readonly logger = new Logger(MessageProjector.name)

  constructor(private readonly prisma: PrismaService) {}

  async onReceived(channel: string, event: MessageReceived): Promise<void> {
    if (!event.messageId || !event.senderId) {
      this.logger.warn(
        `Skipping malformed message.received event (${channel}): ${JSON.stringify(event).slice(0, 200)}`,
      )
      return
    }

    const occurredAt = event.timestamp ? new Date(event.timestamp) : new Date()

    // Try to create the message; if it already exists, skip the counter bump.
    let isNew = false
    try {
      await this.prisma.unifiedMessage.create({
        data: {
          id: event.messageId,
          conversationId: event.conversationId ?? null,
          userId: event.userId ?? null,
          channel,
          channelUserId: event.channelUserId ?? event.senderId,
          sender: 'USER',
          content: event.content ?? '',
          mediaUrl: event.mediaUrl ?? null,
          externalId: event.messageId,
          occurredAt,
        },
      })
      isNew = true
    } catch (err) {
      // Duplicate key on _id → message already projected; treat as replay.
      const msg = err instanceof Error ? err.message : String(err)
      if (!/duplicate key|E11000|P2002/i.test(msg)) {
        throw err
      }
      this.logger.debug(`Replay of UnifiedMessage ${event.messageId}, skipping counter bump`)
    }

    if (!isNew || !event.conversationId) return

    await this.prisma.unifiedConversation.update({
      where: { id: event.conversationId },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: occurredAt,
        userId: event.userId ?? undefined,
      },
    }).catch((err) => {
      // Conversation may not exist yet if events arrived out of order.
      this.logger.warn(
        `UnifiedConversation ${event.conversationId} not found while bumping counters: ` +
          (err instanceof Error ? err.message : String(err)),
      )
    })
  }

  /**
   * Outbound counterpart to `onReceived`. Same UnifiedMessage row shape but
   * `sender='BOT'`. Used by:
   *   - slack-service after a chat.postMessage commits
   *   - agent-service after an assistant reply is persisted
   *
   * Conversation counters only bump if a conversationId is supplied AND we
   * created a new row (replays are no-ops). Slack messages have no
   * conversation, so they just land as orphan UnifiedMessages — still
   * queryable by channel + channelUserId + occurredAt.
   */
  async onSent(channel: string, event: MessageSent): Promise<void> {
    if (!event.messageId || !event.recipient) {
      this.logger.warn(
        `Skipping malformed message.sent event (${channel}): ${JSON.stringify(event).slice(0, 200)}`,
      )
      return
    }

    const occurredAt = event.timestamp ? new Date(event.timestamp) : new Date()

    let isNew = false
    try {
      await this.prisma.unifiedMessage.create({
        data: {
          id: event.messageId,
          conversationId: event.conversationId ?? null,
          userId: event.userId ?? null,
          channel,
          channelUserId: event.channelUserId ?? event.recipient,
          sender: 'BOT',
          content: event.content ?? '',
          mediaUrl: event.mediaUrl ?? null,
          externalId: event.externalMessageId ?? event.messageId,
          occurredAt,
        },
      })
      isNew = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/duplicate key|E11000|P2002/i.test(msg)) {
        throw err
      }
      this.logger.debug(`Replay of UnifiedMessage ${event.messageId}, skipping counter bump`)
    }

    if (!isNew || !event.conversationId) return

    await this.prisma.unifiedConversation
      .update({
        where: { id: event.conversationId },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: occurredAt,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `UnifiedConversation ${event.conversationId} not found while bumping counters: ` +
            (err instanceof Error ? err.message : String(err)),
        )
      })
  }
}
