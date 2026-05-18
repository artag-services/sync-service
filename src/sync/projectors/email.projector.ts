import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  EmailMessageReceivedEvent,
  EmailMessageSentEvent,
} from '../events/data-events.types'

/**
 * Projects `data.email.message.{sent,received}` events into the
 * `unified_emails` collection. Keys on the producer's `emailId` so any
 * subsequent status change (delivered, bounced, opened, ...) lands on
 * the same document.
 *
 * Idempotent — replay-safe. We only overwrite the fields the event
 * actually carries, preserving earlier ones.
 */
@Injectable()
export class EmailProjector {
  private readonly logger = new Logger(EmailProjector.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Outbound (we sent it). Fires on initial send AND on every lifecycle
   * change (status updates from the provider's webhook). Sync's view of
   * the email reflects the *latest* status reported.
   */
  async onSent(event: EmailMessageSentEvent): Promise<void> {
    if (!event.emailId || !event.fromAddress) {
      this.logger.warn(
        `Skipping malformed email.sent event: ${JSON.stringify(event).slice(0, 200)}`,
      )
      return
    }

    const occurredAt = this.firstDate(
      event.timestamp,
      event.clickedAt,
      event.openedAt,
      event.bouncedAt,
      event.complainedAt,
      event.deliveredAt,
      event.sentAt,
    )

    // Build the update object dynamically so absent fields don't overwrite
    // previously-set values. (Initial send has sentAt; a later "delivered"
    // event has only deliveredAt — we want both to land on the same doc.)
    const update: Record<string, unknown> = {
      direction: 'outbound',
      fromAddress: event.fromAddress,
      toAddresses: event.toAddresses ?? [],
    }
    if (event.domain != null)         update.domain = event.domain
    if (event.replyTo != null)        update.replyTo = event.replyTo
    if (event.subject != null)        update.subject = event.subject
    if (event.textBody != null)       update.textBody = event.textBody
    if (event.htmlBody != null)       update.htmlBody = event.htmlBody
    if (event.provider != null)       update.provider = event.provider
    if (event.providerMessageId != null) update.providerMessageId = event.providerMessageId
    if (event.status != null)         update.status = event.status
    if (event.userId != null)         update.userId = event.userId
    if (event.metadata != null)       update.metadata = event.metadata
    if (event.errorReason != null)    update.errorReason = event.errorReason
    if (event.sentAt)        update.sentAt = new Date(event.sentAt)
    if (event.deliveredAt)   update.deliveredAt = new Date(event.deliveredAt)
    if (event.bouncedAt)     update.bouncedAt = new Date(event.bouncedAt)
    if (event.complainedAt)  update.complainedAt = new Date(event.complainedAt)
    if (event.openedAt)      update.openedAt = new Date(event.openedAt)
    if (event.clickedAt)     update.clickedAt = new Date(event.clickedAt)

    await this.prisma.unifiedEmail.upsert({
      where: { id: event.emailId },
      create: {
        id: event.emailId,
        direction: 'outbound',
        fromAddress: event.fromAddress,
        toAddresses: event.toAddresses ?? [],
        occurredAt,
        ...stripDateFromInputs(update),
      },
      update,
    })
    this.logger.debug(
      `UnifiedEmail upsert (outbound) ${event.emailId} status=${event.status ?? '?'}`,
    )
  }

  /**
   * Inbound (someone sent to us via Cloudflare Email Routing → gateway).
   * One event per inbound; no lifecycle to track beyond the initial snapshot.
   */
  async onReceived(event: EmailMessageReceivedEvent): Promise<void> {
    if (!event.emailId || !event.fromAddress || !event.toAddress) {
      this.logger.warn(
        `Skipping malformed email.received event: ${JSON.stringify(event).slice(0, 200)}`,
      )
      return
    }

    const occurredAt = event.receivedAt ? new Date(event.receivedAt) : new Date()

    await this.prisma.unifiedEmail.upsert({
      where: { id: event.emailId },
      create: {
        id: event.emailId,
        direction: 'inbound',
        domain: event.domain,
        toAddresses: [event.toAddress],
        toAlias: event.toAlias ?? null,
        fromAddress: event.fromAddress,
        fromName: event.fromName ?? null,
        subject: event.subject ?? null,
        textBody: event.textBody ?? null,
        htmlBody: event.htmlBody ?? null,
        attachments: (event.attachments ?? null) as object | null,
        userId: event.userId ?? null,
        metadata: (event.metadata ?? null) as object | null,
        occurredAt,
      },
      update: {
        // Late identity-resolution may backfill userId. Don't overwrite the
        // rest of the snapshot once it's been received.
        userId: event.userId ?? undefined,
      },
    })
    this.logger.debug(`UnifiedEmail upsert (inbound) ${event.emailId} from=${event.fromAddress}`)
  }

  private firstDate(...candidates: Array<string | null | undefined>): Date {
    for (const c of candidates) {
      if (c) {
        const d = new Date(c)
        if (!Number.isNaN(d.getTime())) return d
      }
    }
    return new Date()
  }
}

/**
 * Drop date keys that we already set in the `create` block to avoid Prisma's
 * "value must be set in either create or update" duplication.
 */
function stripDateFromInputs(update: Record<string, unknown>): Record<string, unknown> {
  const { direction, fromAddress, toAddresses, ...rest } = update
  return rest
}
