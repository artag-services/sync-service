import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  IdentityUserDeletedEvent,
  IdentityUserLinkedEvent,
} from '../events/data-events.types'

/**
 * Projects `data.identity.*` events into the `UnifiedUser` collection.
 *
 * All handlers are idempotent — replay-safe — because we upsert by userId
 * and dedupe the `identities[]` array on (channel, channelUserId).
 *
 * The producer (identity-service) is expected to emit AFTER it has
 * committed to its own Postgres, so when we get here the source-of-truth
 * already reflects the change.
 */
@Injectable()
export class IdentityProjector {
  private readonly logger = new Logger(IdentityProjector.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `data.identity.user.created` — first time we see this user record.
   * Pre-creates the UnifiedUser so subsequent linked events don't have to
   * race the user-creation. Treated the same as `linked` for the identity
   * itself; the `created` is a hint, not the authoritative write.
   */
  async onUserCreated(event: IdentityUserLinkedEvent): Promise<void> {
    await this.onUserLinked(event)
  }

  /**
   * `data.identity.user.linked` — a channel identity was attached, refreshed
   * or re-attached (post-merge). Upsert the user document and merge the
   * identity into the `identities[]` array.
   */
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

    // Merge: replace (channel, channelUserId) if present, else append.
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
        lastSeenAt:
          linkedAt > (existing.lastSeenAt ?? new Date(0)) ? linkedAt : existing.lastSeenAt,
        // If a previously-deleted user gets a new linked event, treat it as
        // resurrection — clear the tombstone fields.
        deletedAt: null,
        mergedInto: null,
      },
    })
    this.logger.debug(`Updated UnifiedUser ${event.userId} (identity ${event.channel})`)
  }

  /**
   * `data.identity.user.deleted` — soft delete or merged-into-another tombstone.
   * We don't physically remove the document so that historical queries (and
   * the audit `event_log`) still work; consumers filter on `deletedAt`.
   */
  async onUserDeleted(event: IdentityUserDeletedEvent): Promise<void> {
    if (!event.userId) {
      this.logger.warn(`Skipping malformed user.deleted event (no userId)`)
      return
    }
    const deletedAt = event.deletedAt ? new Date(event.deletedAt) : new Date()
    const existing = await this.prisma.unifiedUser.findUnique({ where: { id: event.userId } })
    if (!existing) {
      this.logger.debug(`user.deleted for unknown UnifiedUser ${event.userId}, ignoring`)
      return
    }
    await this.prisma.unifiedUser.update({
      where: { id: event.userId },
      data: {
        deletedAt,
        mergedInto: event.reason === 'merged' ? event.mergedInto ?? null : null,
      },
    })
    this.logger.log(
      `Soft-deleted UnifiedUser ${event.userId} (reason=${event.reason}` +
        (event.mergedInto ? ` mergedInto=${event.mergedInto}` : '') +
        `)`,
    )
  }
}
