import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as amqp from 'amqplib'

import { RABBITMQ_EXCHANGE } from './constants/queues'

/**
 * Thin amqplib wrapper for sync-service.
 *
 * Unlike the other services, sync passes the inbound `routingKey` to its
 * handler — the projector dispatches on it. This service does NOT publish.
 */
@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name)
  private connection: Awaited<ReturnType<typeof amqp.connect>> | null = null
  private channel: amqp.Channel | null = null

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.connect()
  }

  async onModuleDestroy() {
    await this.disconnect()
  }

  private async connect(retries = 10, delayMs = 3000) {
    const url = this.config.get<string>('RABBITMQ_URL')
    if (!url) throw new Error('RABBITMQ_URL is not defined')

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.connection = await amqp.connect(url)
        this.channel = await this.connection.createChannel()
        await this.channel.assertExchange(RABBITMQ_EXCHANGE, 'topic', { durable: true })
        this.logger.log(`Connected to RabbitMQ — exchange [${RABBITMQ_EXCHANGE}]`)
        return
      } catch (err) {
        this.logger.warn(
          `RabbitMQ attempt ${attempt}/${retries} failed. Retrying in ${delayMs}ms...`,
        )
        if (attempt === retries) throw err
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }

  private async disconnect() {
    try {
      await this.channel?.close()
      await this.connection?.close()
      this.logger.log('Disconnected from RabbitMQ')
    } catch {
      /* ignore */
    }
  }

  /**
   * Bind a single queue to a (possibly wildcarded) routing-key pattern and
   * stream messages to the handler. The handler receives both the parsed
   * payload AND the inbound `routingKey` so projectors can dispatch.
   *
   * On handler error we `nack(msg, false, false)` — message goes to DLX if
   * configured, otherwise dropped. Acceptable for read-model projections
   * since we always have the source of truth in the producer's DB and can
   * replay.
   */
  async subscribePattern(
    queue: string,
    pattern: string,
    handler: (payload: Record<string, unknown>, routingKey: string) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ channel not available')

    await this.channel.assertQueue(queue, { durable: true })
    await this.channel.bindQueue(queue, RABBITMQ_EXCHANGE, pattern)
    this.channel.prefetch(8) // sync is read-model only; small parallelism is fine

    await this.channel.consume(queue, async (msg) => {
      if (!msg) return
      const routingKey = msg.fields.routingKey
      try {
        const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>
        await handler(payload, routingKey)
        this.channel!.ack(msg)
      } catch (error) {
        this.logger.error(
          `Error processing [${queue}] routingKey=[${routingKey}]`,
          error as Error,
        )
        this.channel!.nack(msg, false, false)
      }
    })

    this.logger.log(`Subscribed → queue [${queue}] | pattern [${pattern}]`)
  }
}
