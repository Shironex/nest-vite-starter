import { Controller, Get, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CSRF_TOKEN_PATH } from '@repo/shared/constants';
import { CsrfService } from './csrf.service';

// Nest registers controller paths without a leading slash; derive it from the
// shared wire constant so the route cannot drift from the client's fetch path.
const CSRF_TOKEN_CONTROLLER_PATH = CSRF_TOKEN_PATH.replace(/^\//, '');

// Tighter than the global 100/60s default: the endpoint is unauthenticated and
// a legitimate client fetches a token roughly once per session (plus the 403
// self-heal retry), so 30/min per IP is generous for real traffic while
// blunting token-mint hammering.
const CSRF_TOKEN_THROTTLE = { default: { limit: 30, ttl: 60000 } };

/**
 * GET /api/csrf-token. Lives on a Nest controller (not the raw Express
 * adapter) so the global ThrottlerGuard (APP_GUARD) applies; the previous
 * registration on the adapter's Express instance bypassed Nest routing and
 * therefore every guard.
 *
 * The `{ csrfToken }` response shape is the wire contract the web client
 * (apps/web/src/lib/csrf.ts) and its 403 self-heal depend on. Cookie behavior
 * is owned by CsrfService.generate, which writes the token cookie on `res`;
 * `passthrough: true` keeps Nest serializing the return value while the
 * service mutates the response headers.
 */
@Controller(CSRF_TOKEN_CONTROLLER_PATH)
export class CsrfController {
  constructor(private readonly csrfService: CsrfService) {}

  @Get()
  @Throttle(CSRF_TOKEN_THROTTLE)
  getToken(@Req() req: Request, @Res({ passthrough: true }) res: Response): { csrfToken: string } {
    return { csrfToken: this.csrfService.generate(req, res) };
  }
}
