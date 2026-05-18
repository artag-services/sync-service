import { Module } from '@nestjs/common'

import { ConversationProjector } from './projectors/conversation.projector'
import { EmailProjector } from './projectors/email.projector'
import { IdentityProjector } from './projectors/identity.projector'
import { MessageProjector } from './projectors/message.projector'
import { ScrapingProjector } from './projectors/scraping.projector'
import { SyncConsumer } from './sync.consumer'

@Module({
  providers: [
    IdentityProjector,
    ConversationProjector,
    MessageProjector,
    ScrapingProjector,
    EmailProjector,
    SyncConsumer,
  ],
  exports: [
    IdentityProjector,
    ConversationProjector,
    MessageProjector,
    ScrapingProjector,
    EmailProjector,
  ],
})
export class SyncModule {}
