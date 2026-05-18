import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  InstagramConversationCreatedEvent,
  WhatsappConversationCreatedEvent,
} from '../events/data-events.types'

type ConversationCreated =
  | (WhatsappConversationCreatedEvent & { channel?: 'whatsapp' })
  | (InstagramConversationCreatedEvent & { channel?: 'instagram' })

/**
 * Projects `data.<channel>.conversation.created` events into UnifiedConversation.
 * Uses `conversationId` as the Mongo `_id` so upserts are idempotent.
 */
@Injectable()
export class ConversationProjector {
  private readonly logger = new Logger(ConversationProjector.name)

  constructor(private readonly prisma: PrismaService) {}

  async onCreated(channel: string, event: ConversationCreated): Promise<void> {
    if (!event.conversationId || !event.channelUserId) {
      this.logger.warn(
        `Skipping malformed conversation.created event (${channel}): ${JSON.stringify(event).slice(0, 200)}`,
      )
      return
    }

    const createdAt = event.createdAt ? new Date(event.createdAt) : new Date()

    await this.prisma.unifiedConversation.upsert({
      where: { id: event.conversationId },
      create: {
        id: event.conversationId,
        userId: event.userId ?? null,
        channel,
        channelUserId: event.channelUserId,
        topic: event.topic ?? null,
        status: event.status ?? 'ACTIVE',
        aiEnabled: event.aiEnabled ?? true,
        firstMessageAt: createdAt,
        lastMessageAt: createdAt,
        createdAt,
      },
      update: {
        // Replay-safe: if we somehow get the event again, refresh top-of-row fields
        // but don't overwrite counters or lastMessageAt with stale create timestamps.
        userId: event.userId ?? undefined,
        topic: event.topic ?? undefined,
        status: event.status ?? undefined,
        aiEnabled: event.aiEnabled ?? undefined,
      },
    })

    this.logger.debug(`UnifiedConversation upsert ${event.conversationId} (${channel})`)
  }

  /**
   * Soft-delete: mark the conversation tombstoned so it disappears from
   * default queries. We keep the doc for audit; the QueryService filters
   * `status: 'DELETED'` out.
   */
  async onDeleted(conversationId: string): Promise<void> {
    if (!conversationId) return
    const existing = await this.prisma.unifiedConversation.findUnique({
      where: { id: conversationId },
    })
    if (!existing) {
      this.logger.debug(`conversation.deleted for unknown ${conversationId}, ignoring`)
      return
    }
    await this.prisma.unifiedConversation.update({
      where: { id: conversationId },
      data: { status: 'DELETED' },
    })
    this.logger.log(`Soft-deleted UnifiedConversation ${conversationId}`)
  }
}
