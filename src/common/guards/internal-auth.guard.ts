import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'
import { timingSafeEqual } from 'crypto'

/**
 * Defense-in-depth: only the gateway should ever talk to this service. Even
 * though the service binds to an internal Docker network port, we enforce
 * a shared-secret header so a misconfigured port-forward / Cloudflare Tunnel
 * doesn't accidentally expose the read model to the world.
 *
 * Header: `X-Internal-Auth: <SYNC_INTERNAL_AUTH_TOKEN>`
 *
 * The shared secret comes from `SYNC_INTERNAL_AUTH_TOKEN` in the root `.env`.
 * Both gateway and sync read it. If unset, the guard logs a warning and
 * lets requests through — convenient for local dev, NEVER do this in prod.
 */
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly logger = new Logger(InternalAuthGuard.name)
  private readonly expected: string | undefined
  private readonly expectedBuf: Buffer | null

  constructor(config: ConfigService) {
    this.expected = config.get<string>('SYNC_INTERNAL_AUTH_TOKEN')
    this.expectedBuf = this.expected ? Buffer.from(this.expected, 'utf8') : null
    if (!this.expected) {
      this.logger.warn(
        'SYNC_INTERNAL_AUTH_TOKEN is not set — internal API is accepting all requests. ' +
          'Set the env var to enable header verification (required in production).',
      )
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expectedBuf) return true // dev mode

    const req = context.switchToHttp().getRequest<Request>()
    const provided = req.header('x-internal-auth')
    if (!provided) {
      throw new UnauthorizedException('Missing X-Internal-Auth header')
    }

    const providedBuf = Buffer.from(provided, 'utf8')
    if (
      providedBuf.length !== this.expectedBuf.length ||
      !timingSafeEqual(providedBuf, this.expectedBuf)
    ) {
      throw new UnauthorizedException('Invalid X-Internal-Auth header')
    }
    return true
  }
}
