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
