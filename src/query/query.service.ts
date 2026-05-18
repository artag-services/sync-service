import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

interface ListOpts {
  limit?: number
  cursor?: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * Read-only query service over the Mongo read model. Cursor pagination is
 * by ascending `_id` (since Mongo ObjectIds are sortable and our string ids
 * also sort lexicographically well enough for our purposes).
 */
@Injectable()
export class QueryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Users ────────────────────────────────────────────────────────────

  async getUser(userId: string) {
    const user = await this.prisma.unifiedUser.findUnique({ where: { id: userId } })
    if (!user || user.deletedAt) {
      throw new NotFoundException(`User ${userId} not found in read model`)
    }
    return user
  }

  async listUsers({ limit, cursor }: ListOpts) {
    const take = clampLimit(limit)
    return this.prisma.unifiedUser.findMany({
      where: { deletedAt: null },
      take,
      orderBy: { lastSeenAt: 'desc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  // ─── Conversations ───────────────────────────────────────────────────

  async getUserConversations(userId: string, { limit, cursor }: ListOpts) {
    const take = clampLimit(limit)
    return this.prisma.unifiedConversation.findMany({
      where: { userId, status: { not: 'DELETED' } },
      take,
      orderBy: { lastMessageAt: 'desc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  async getConversation(conversationId: string) {
    const conv = await this.prisma.unifiedConversation.findUnique({
      where: { id: conversationId },
    })
    if (!conv || conv.status === 'DELETED') {
      throw new NotFoundException(`Conversation ${conversationId} not found`)
    }
    return conv
  }

  async listConversations({ limit, cursor }: ListOpts) {
    const take = clampLimit(limit)
    return this.prisma.unifiedConversation.findMany({
      where: { status: { not: 'DELETED' } },
      take,
      orderBy: { lastMessageAt: 'desc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  // ─── Messages ────────────────────────────────────────────────────────

  async getConversationMessages(conversationId: string, { limit, cursor }: ListOpts) {
    const take = clampLimit(limit)
    return this.prisma.unifiedMessage.findMany({
      where: { conversationId },
      take,
      orderBy: { occurredAt: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  // ─── Scraping summaries ──────────────────────────────────────────────

  async getUserScrapingTasks(userId: string, { limit, cursor }: ListOpts) {
    const take = clampLimit(limit)
    return this.prisma.scrapingTaskSummary.findMany({
      where: { userId },
      take,
      orderBy: { occurredAt: 'desc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  // ─── Emails ──────────────────────────────────────────────────────────

  async getEmail(emailId: string) {
    const email = await this.prisma.unifiedEmail.findUnique({ where: { id: emailId } })
    if (!email) throw new NotFoundException(`Email ${emailId} not found in read model`)
    return email
  }

  /**
   * List emails with optional filters.
   *   - direction: 'inbound' | 'outbound' (omit for both)
   *   - domain: filter by receiving/sending domain
   *   - status: outbound lifecycle (SENT/DELIVERED/BOUNCED/OPENED/CLICKED/...)
   */
  async listEmails(
    filters: { direction?: string; domain?: string; status?: string },
    { limit, cursor }: ListOpts,
  ) {
    const take = clampLimit(limit)
    return this.prisma.unifiedEmail.findMany({
      where: {
        direction: filters.direction ?? undefined,
        domain: filters.domain ?? undefined,
        status: filters.status ?? undefined,
      },
      take,
      orderBy: { occurredAt: 'desc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  /** Emails associated with a user (either direction). */
  async getUserEmails(
    userId: string,
    filters: { direction?: string },
    { limit, cursor }: ListOpts,
  ) {
    const take = clampLimit(limit)
    return this.prisma.unifiedEmail.findMany({
      where: {
        userId,
        direction: filters.direction ?? undefined,
      },
      take,
      orderBy: { occurredAt: 'desc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
  }

  // ─── Search ──────────────────────────────────────────────────────────

  /**
   * Naive cross-channel search: substring-matches `q` against message content
   * and conversation topic. NOT using Mongo full-text indexes yet — keep it
   * simple until we know what queries matter.
   */
  async search(q: string, { limit }: ListOpts) {
    const take = clampLimit(limit)
    if (!q || q.trim().length < 2) return { messages: [], conversations: [] }

    const [messages, conversations] = await Promise.all([
      this.prisma.unifiedMessage.findMany({
        where: { content: { contains: q, mode: 'insensitive' } },
        take,
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.unifiedConversation.findMany({
        where: { topic: { contains: q, mode: 'insensitive' } },
        take,
        orderBy: { lastMessageAt: 'desc' },
      }),
    ])

    return { messages, conversations }
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(limit, 1), MAX_LIMIT)
}
