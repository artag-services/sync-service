import { NestFactory } from '@nestjs/core'
import { Logger, ValidationPipe } from '@nestjs/common'

import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  app.useGlobalFilters(new HttpExceptionFilter())

  // Graceful shutdown — closes RabbitMQ + Prisma cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks()

  const port = process.env.PORT ?? process.env.SYNC_PORT ?? 3012
  await app.listen(port)

  const logger = new Logger('Bootstrap')
  logger.log(`Sync service running on port ${port}`)
  logger.log(`Internal API: GET http://localhost:${port}/internal/query/* (X-Internal-Auth)`)
  logger.log(`Health: GET http://localhost:${port}/health`)
}

bootstrap()
