import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { RabbitMQService } from '../rabbitmq/rabbitmq.service'
import { DATA_ROUTING_KEYS, SYNC_BINDINGS } from '../rabbitmq/constants/queues'
import { ConversationProjector } from './projectors/conversation.projector'
import { EmailProjector } from './projectors/email.projector'
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
    private readonly emails: EmailProjector,
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
      case DATA_ROUTING_KEYS.SCRAPING_TASK_FAILED:
        // Same projector handles both — `status` inside the payload
        // distinguishes `completed` vs `failed`.
        return this.scraping.onCompleted(payload as never)

      case DATA_ROUTING_KEYS.EMAIL_MESSAGE_SENT:
        return this.emails.onSent(payload as never)
      case DATA_ROUTING_KEYS.EMAIL_MESSAGE_RECEIVED:
        return this.emails.onReceived(payload as never)

      case DATA_ROUTING_KEYS.SLACK_MESSAGE_SENT:
        // Slack outbound — sender='BOT'. No conversation server-side.
        return this.messages.onSent('slack', payload as never)

      case DATA_ROUTING_KEYS.AGENT_CONVERSATION_CREATED:
        return this.conversations.onCreated('agent', payload as never)
      case DATA_ROUTING_KEYS.AGENT_CONVERSATION_DELETED:
        return this.conversations.onDeleted(
          (payload as { conversationId?: string }).conversationId ?? '',
        )
      case DATA_ROUTING_KEYS.AGENT_MESSAGE_RECEIVED:
        // User prompt to the agent — sender='USER'.
        return this.messages.onReceived('agent', payload as never)
      case DATA_ROUTING_KEYS.AGENT_MESSAGE_SENT:
        // Assistant final reply — sender='BOT'. Intermediate tool-loop
        // rounds are NOT emitted by the producer.
        return this.messages.onSent('agent', payload as never)

      default:
        // Generic fall-through patterns. The explicit cases above win for
        // the documented channels; this lets us pick up future producers
        // (e.g. POST /v1/conversations with a new channel string) without
        // recompiling sync.
        return this.routeGeneric(payload, routingKey)
    }
  }

  /**
   * Match generic data.* shapes by routing-key suffix. Channel is the
   * second segment of the key (e.g. `data.facebook.conversation.created`
   * → channel = 'facebook'). Falls back to logging when nothing matches.
   */
  private async routeGeneric(
    payload: Record<string, unknown>,
    routingKey: string,
  ): Promise<void> {
    const parts = routingKey.split('.') // ["data", "<channel>", "<entity>", "<action>"]
    if (parts.length < 4 || parts[0] !== 'data') {
      this.logger.debug(`Unknown routing key shape: ${routingKey}`)
      return
    }
    const [, channel, entity, action] = parts

    if (entity === 'conversation' && action === 'created') {
      return this.conversations.onCreated(channel, payload as never)
    }
    if (entity === 'conversation' && action === 'deleted') {
      return this.conversations.onDeleted(
        (payload as { conversationId?: string }).conversationId ?? '',
      )
    }
    if (entity === 'message' && action === 'received') {
      return this.messages.onReceived(channel, payload as never)
    }
    if (entity === 'message' && action === 'sent') {
      return this.messages.onSent(channel, payload as never)
    }

    this.logger.debug(
      `No projector matched routingKey=${routingKey} (event logged in event_log)`,
    )
  }
}
