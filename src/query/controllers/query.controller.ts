import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard'
import { QueryService } from '../query.service'

/**
 * Internal HTTP API consumed by the gateway. Mounted at `/internal/query/*`
 * so anyone hitting `/v1/...` from outside hits 404 (defense in depth —
 * gateway's queries should be the only thing calling these routes).
 *
 * Every endpoint is RPC-style RPC (200 OK + body or 404). Pagination uses
 * `?limit=N&cursor=<id>`.
 */
@Controller('internal/query')
@UseGuards(InternalAuthGuard)
export class QueryController {
  constructor(private readonly q: QueryService) {}

  // ── Users ────────────────────────────────────────────────────────────

  @Get('users')
  listUsers(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.q.listUsers({ limit: parseLimit(limit), cursor })
  }

  @Get('users/:userId')
  getUser(@Param('userId') userId: string) {
    return this.q.getUser(userId)
  }

  @Get('users/:userId/conversations')
  getUserConversations(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.q.getUserConversations(userId, { limit: parseLimit(limit), cursor })
  }

  @Get('users/:userId/scraping-tasks')
  getUserScrapingTasks(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.q.getUserScrapingTasks(userId, { limit: parseLimit(limit), cursor })
  }

  // ── Conversations ────────────────────────────────────────────────────

  @Get('conversations')
  listConversations(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.q.listConversations({ limit: parseLimit(limit), cursor })
  }

  @Get('conversations/:id')
  getConversation(@Param('id') id: string) {
    return this.q.getConversation(id)
  }

  @Get('conversations/:id/messages')
  getConversationMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.q.getConversationMessages(id, { limit: parseLimit(limit), cursor })
  }

  // ── Search ───────────────────────────────────────────────────────────

  @Get('search')
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.q.search(q, { limit: parseLimit(limit) })
  }
}

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, service: 'sync', ts: new Date().toISOString() }
  }
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? undefined : n
}
