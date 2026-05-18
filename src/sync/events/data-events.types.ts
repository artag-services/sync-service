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
