import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ScrapingTaskCompletedEvent } from '../events/data-events.types'

/**
 * Projects `data.scraping.task.completed` events into ScrapingTaskSummary.
 * Idempotent via `taskId` as _id.
 */
@Injectable()
export class ScrapingProjector {
  private readonly logger = new Logger(ScrapingProjector.name)

  constructor(private readonly prisma: PrismaService) {}

  async onCompleted(event: ScrapingTaskCompletedEvent): Promise<void> {
    if (!event.taskId || !event.url) {
      this.logger.warn(`Skipping malformed scraping.task.completed: missing taskId/url`)
      return
    }

    const occurredAt = event.timestamp ? new Date(event.timestamp) : new Date()

    await this.prisma.scrapingTaskSummary.upsert({
      where: { id: event.taskId },
      create: {
        id: event.taskId,
        userId: event.userId ?? null,
        url: event.url,
        title: event.title ?? null,
        status: event.status ?? (event.error ? 'failed' : 'completed'),
        notionPageUrl: event.notionPageUrl ?? null,
        durationMs: event.durationMs ?? null,
        error: event.error ?? null,
        occurredAt,
      },
      update: {
        title: event.title ?? undefined,
        status: event.status ?? undefined,
        notionPageUrl: event.notionPageUrl ?? undefined,
        durationMs: event.durationMs ?? undefined,
        error: event.error ?? undefined,
      },
    })

    this.logger.debug(`ScrapingTaskSummary upsert ${event.taskId} (${event.status ?? 'unknown'})`)
  }
}
