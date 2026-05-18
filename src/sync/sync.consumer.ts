import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { RabbitMQService } from '../rabbitmq/rabbitmq.service'
import { DATA_ROUTING_KEYS, SYNC_BINDINGS } from '../rabbitmq/constants/queues'
import { ConversationProjector } from './projectors/conversation.projector'
import { IdentityProjector } from './projectors/identity.projector'
import { MessageProjector } from './projectors/message.projector'
import { ScrapingProjector } from './projectors/scraping.projector'

/**
 * Binds ONE queue to `data.#` and dispatches each event to the right
 * projector based on the routing key.
 *
 * Every event is also written to the `event_log` collection for audit /
 * replay purposes (in addition to whatever projection runs). Failures are
 * logged with status='ERROR' but we ack the message — read-model projection
 * errors should never block the broker. The source of truth is the
 * producer's Postgres; we can always reconcile later.
 */
@Injectable()
export class SyncConsumer implements OnModuleInit {
  private readonly logger = new Logger(SyncConsumer.name)

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly identity: IdentityProjector,
    private readonly conversations: ConversationProjector,
    private readonly messages: MessageProjector,
    private readonly scraping: ScrapingProjector,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.subscribePattern(
      SYNC_BINDINGS.ALL_DATA_EVENTS.queue,
      SYNC_BINDINGS.ALL_DATA_EVENTS.pattern,
      (payload, routingKey) => this.dispatch(payload, routingKey),
    )
    this.logger.log('Sync consumer ready — listening to data.#')
  }

  private async dispatch(payload: Record<string, unknown>, routingKey: string): Promise<void> {
    let status: 'OK' | 'ERROR' = 'OK'
    let errorReason: string | undefined

    try {
      await this.route(payload, routingKey)
    } catch (err) {
      status = 'ERROR'
      errorReason = err instanceof Error ? err.message : String(err)
      this.logger.error(`Projection failed for ${routingKey}: ${errorReason}`)
    }

    // Always log the event — even failures. The audit is useful for replay.
    await this.prisma.eventLog
      .create({
        data: {
          routingKey,
          payload: payload as object,
          status,
          errorReason,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to write event_log entry: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
  }

  private async route(payload: Record<string, unknown>, routingKey: string): Promise<void> {
    switch (routingKey) {
      case DATA_ROUTING_KEYS.IDENTITY_USER_CREATED:
        return this.identity.onUserCreated(payload as never)
      case DATA_ROUTING_KEYS.IDENTITY_USER_LINKED:
        return this.identity.onUserLinked(payload as never)
      case DATA_ROUTING_KEYS.IDENTITY_USER_DELETED:
        return this.identity.onUserDeleted(payload as never)

      case DATA_ROUTING_KEYS.WHATSAPP_CONVERSATION_CREATED:
        return this.conversations.onCreated('whatsapp', payload as never)
      case DATA_ROUTING_KEYS.INSTAGRAM_CONVERSATION_CREATED:
        return this.conversations.onCreated('instagram', payload as never)

      case DATA_ROUTING_KEYS.WHATSAPP_MESSAGE_RECEIVED:
        return this.messages.onReceived('whatsapp', payload as never)
      case DATA_ROUTING_KEYS.INSTAGRAM_MESSAGE_RECEIVED:
        return this.messages.onReceived('instagram', payload as never)

      case DATA_ROUTING_KEYS.SCRAPING_TASK_COMPLETED:
        return this.scraping.onCompleted(payload as never)

      default:
        // Unknown but well-formed `data.*` event. We still log it (caller will
        // do that). Skipping projection is fine — projectors are additive.
        this.logger.debug(`No projector for routingKey=${routingKey} (event logged anyway)`)
    }
  }
}
