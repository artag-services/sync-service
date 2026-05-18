import { Module } from '@nestjs/common'
import { InternalAuthGuard } from '../common/guards/internal-auth.guard'
import { HealthController, QueryController } from './controllers/query.controller'
import { QueryService } from './query.service'

@Module({
  controllers: [QueryController, HealthController],
  providers: [QueryService, InternalAuthGuard],
})
export class QueryModule {}
