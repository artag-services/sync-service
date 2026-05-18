import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  InstagramMessageReceivedEvent,
  WhatsappMessageReceivedEvent,
} from '../events/data-events.types'

type MessageReceived = WhatsappMessageReceivedEvent | InstagramMessageReceivedEvent

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
}
