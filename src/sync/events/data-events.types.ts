/**
 * Typed shapes for the `data.*` events the sync service consumes.
 *
 * Keep these in sync with AGENTS.md "CQRS / Sync Service" section and with
 * the producer services. Treat any field as optional defensively — older
 * producers may not emit every field, and we'd rather store partial data
 * than drop the event.
 */

export interface IdentityUserLinkedEvent {
  userId: string
  channel: string
  channelUserId: string
  displayName?: string | null
  realName?: string | null
  avatarUrl?: string | null
  linkedAt?: string // ISO
}

/**
 * Same payload as `linked`, but only emitted the very first time a user
 * record gets created. Consumers may treat it identically to `linked` —
 * it's just a hint for analytics / onboarding flows.
 */
export interface IdentityUserCreatedEvent extends IdentityUserLinkedEvent {}

/**
 * Soft delete or post-merge tombstone.
 * If `reason === 'merged'`, `mergedInto` carries the surviving userId.
 */
export interface IdentityUserDeletedEvent {
  userId: string
  reason: 'soft-delete' | 'merged'
  deletedAt: string // ISO
  mergedInto?: string
  /** Free-text reason supplied by the caller (merge requests carry one). */
  detail?: string
}

export interface WhatsappMessageReceivedEvent {
  messageId: string
  senderId: string // wa_id
  content: string
  conversationId?: string
  channelUserId?: string
  userId?: string
  mediaUrl?: string | null
  timestamp?: string // ISO
}

export interface WhatsappConversationCreatedEvent {
  conversationId: string
  channelUserId: string
  topic?: string | null
  userId?: string | null
  channel?: string
  status?: string
  aiEnabled?: boolean
  createdAt?: string // ISO
}

export interface InstagramMessageReceivedEvent {
  messageId: string
  senderId: string // IGSID
  content: string
  conversationId?: string
  channelUserId?: string
  userId?: string
  mediaUrl?: string | null
  timestamp?: string
}

export interface InstagramConversationCreatedEvent {
  conversationId: string
  channelUserId: string
  topic?: string | null
  userId?: string | null
  channel?: string
  status?: string
  aiEnabled?: boolean
  createdAt?: string
}

export interface ScrapingTaskCompletedEvent {
  taskId: string
  userId?: string | null
  url: string
  title?: string | null
  status?: 'completed' | 'failed'
  notionPageUrl?: string | null
  durationMs?: number
  error?: string | null
  timestamp?: string
}

/**
 * Outbound email events. `data.email.message.sent` is emitted on initial
 * send AND on every subsequent status change (delivered, bounced, opened,
 * clicked, complained, failed). The projector upserts by `emailId` so
 * re-emission is safe; only fields present in the latest event overwrite.
 */
export interface EmailMessageSentEvent {
  emailId: string
  userId?: string | null
  domain?: string | null
  fromAddress: string
  toAddresses: string[]
  replyTo?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  provider?: string | null
  providerMessageId?: string | null
  status?:
    | 'QUEUED'
    | 'SENT'
    | 'DELIVERED'
    | 'BOUNCED'
    | 'COMPLAINED'
    | 'FAILED'
    | 'OPENED'
    | 'CLICKED'
    | string
  sentAt?: string | null
  deliveredAt?: string | null
  bouncedAt?: string | null
  complainedAt?: string | null
  openedAt?: string | null
  clickedAt?: string | null
  errorReason?: string | null
  metadata?: Record<string, unknown>
  timestamp?: string
}

/** Inbound email snapshot at receipt time. */
export interface EmailMessageReceivedEvent {
  emailId: string
  domain: string
  toAddress: string
  toAlias?: string | null
  fromAddress: string
  fromName?: string | null
  subject?: string | null
  textBody?: string | null
  htmlBody?: string | null
  attachments?: Array<{ name?: string; contentType?: string; size?: number }>
  userId?: string | null
  receivedAt?: string
  metadata?: Record<string, unknown>
}
