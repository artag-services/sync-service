/**
 * Sync service RabbitMQ contract.
 *
 * The sync service is consumer-only — it never publishes any routing key.
 * It binds ONE queue to a wildcard pattern (`data.#`) so any new `data.*`
 * event from any producer gets routed here without code changes to this file.
 *
 * Producers control the actual routing keys; see AGENTS.md for the documented
 * contracts (e.g. `data.identity.user.linked`, `data.whatsapp.message.received`).
 */

export const RABBITMQ_EXCHANGE = 'channels'

export const SYNC_BINDINGS = {
  /** Single fan-in queue bound to `data.#` — every produced data.* event lands here. */
  ALL_DATA_EVENTS: {
    queue: 'sync.data.all',
    pattern: 'data.#',
  },
} as const

/**
 * Known routing keys per producer. The consumer dispatches on `routingKey`
 * so adding a new event = adding a case in `DataEventConsumer.dispatch()`.
 * Keep this list in sync with AGENTS.md "CQRS Event Contract" table.
 */
export const DATA_ROUTING_KEYS = {
  IDENTITY_USER_CREATED: 'data.identity.user.created',
  IDENTITY_USER_LINKED: 'data.identity.user.linked',
  IDENTITY_USER_DELETED: 'data.identity.user.deleted',
  WHATSAPP_MESSAGE_RECEIVED: 'data.whatsapp.message.received',
  WHATSAPP_CONVERSATION_CREATED: 'data.whatsapp.conversation.created',
  INSTAGRAM_MESSAGE_RECEIVED: 'data.instagram.message.received',
  INSTAGRAM_CONVERSATION_CREATED: 'data.instagram.conversation.created',
  SCRAPING_TASK_COMPLETED: 'data.scraping.task.completed',
} as const

export type DataRoutingKey = (typeof DATA_ROUTING_KEYS)[keyof typeof DATA_ROUTING_KEYS]
