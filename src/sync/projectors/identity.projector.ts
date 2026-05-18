import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { IdentityUserLinkedEvent } from '../events/data-events.types'

/**
 * Projects `data.identity.user.linked` events into the `UnifiedUser`
 * collection. Idempotent — replay-safe because we upsert by userId and
 * dedupe the `identities[]` array on (channel, channelUserId).
 */
@Injectable()
export class IdentityProjector {
  private readonly logger = new Logger(IdentityProjector.name)

  constructor(private readonly prisma: PrismaService) {}

  async onUserLinked(event: IdentityUserLinkedEvent): Promise<void> {
    if (!event.userId || !event.channel || !event.channelUserId) {
      this.logger.warn(
        `Skipping malformed user.linked event: ${JSON.stringify(event).slice(0, 200)}`,
      )
      return
    }

    const linkedAt = event.linkedAt ? new Date(event.linkedAt) : new Date()
    const newIdentity = {
      channel: event.channel,
      channelUserId: event.channelUserId,
      displayName: event.displayName ?? null,
      linkedAt,
    }

    const existing = await this.prisma.unifiedUser.findUnique({ where: { id: event.userId } })

    if (!existing) {
      await this.prisma.unifiedUser.create({
        data: {
          id: event.userId,
          displayName: event.displayName ?? null,
          realName: event.realName ?? null,
          avatarUrl: event.avatarUrl ?? null,
          identities: [newIdentity],
          firstSeenAt: linkedAt,
          lastSeenAt: linkedAt,
        },
      })
      this.logger.log(`Created UnifiedUser ${event.userId} (first identity: ${event.channel})`)
      return
    }

    // Merge: replace the entry for (channel, channelUserId) if present, else append.
    const merged = existing.identities.filter(
      (i) => !(i.channel === event.channel && i.channelUserId === event.channelUserId),
    )
    merged.push(newIdentity)

    await this.prisma.unifiedUser.update({
      where: { id: event.userId },
      data: {
        identities: merged,
        displayName: event.displayName ?? existing.displayName,
        realName: event.realName ?? existing.realName,
        avatarUrl: event.avatarUrl ?? existing.avatarUrl,
        lastSeenAt: linkedAt > (existing.lastSeenAt ?? new Date(0)) ? linkedAt : existing.lastSeenAt,
      },
    })
    this.logger.debug(`Updated UnifiedUser ${event.userId} (identity ${event.channel})`)
  }
}
