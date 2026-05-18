import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { PrismaModule } from './prisma/prisma.module'
import { QueryModule } from './query/query.module'
import { RabbitMQModule } from './rabbitmq/rabbitmq.module'
import { SyncModule } from './sync/sync.module'

// Sync service (CQRS read model):
//   - Subscribes to RabbitMQ topic exchange `channels` on pattern `data.#`
//   - Projects events into MongoDB collections via Prisma (provider=mongodb)
//   - Exposes a guarded HTTP API at /internal/query/* consumed ONLY by the gateway
//
// Per CLAUDE.md / AGENTS.md, this is the ONE service the gateway calls over
// HTTPS directly. No external client should hit this service.

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    PrismaModule,
    RabbitMQModule,
    SyncModule,
    QueryModule,
  ],
})
export class AppModule {}
