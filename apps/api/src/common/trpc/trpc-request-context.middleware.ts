import { Injectable } from '@nestjs/common';
import type { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { buildRequestContextStore } from '../context/request-context.module';
import { requestContext } from '../context/request-context';
import type { IRequestContext } from '../context/request-context';

/**
 * Opens the AsyncLocalStorage request scope for tRPC procedures.
 *
 * This exists because `RequestContextMiddleware` does NOT cover `/trpc`.
 * nestjs-trpc mounts its own express handler during module init, outside the
 * pipeline that `consumer.apply(...).forRoutes('*')` feeds, so a tRPC call
 * reaches its resolver with no ALS scope unless one is opened here.
 *
 * What depends on it: AuthMiddleware needs a store to write `tenantId` into, and
 * without that write EVERY query against a tenant-scoped model fails closed with
 * "Tenant context required": `workspace` and
 * `twoFactorPolicy`. Less visibly, `requestId` never reaches the structured logs
 * and `AuditService` cannot see the caller.
 *
 * Registered FIRST in `globalMiddlewares` (app.module.ts) so the scope is open
 * before any other middleware, notably AuthMiddleware, which populates
 * `userId`/`tenantId` into the store this opens.
 *
 * Per PROCEDURE rather than per HTTP request: a batched call runs several
 * procedures over one request and each gets its own store. They are built from
 * the same `req`, so `requestId` is shared and correlation is unaffected, while
 * per-procedure `userId`/`tenantId` writes cannot bleed across a batch.
 */
@Injectable()
export class TrpcRequestContextMiddleware implements TRPCMiddleware {
  async use(opts: MiddlewareOptions): Promise<Awaited<MiddlewareResponse>> {
    const req = (opts.ctx as { req?: Request } | undefined)?.req;
    const existing = requestContext.getStore();

    /*
     * Always open a CHILD scope, never adopt the parent store by reference.
     *
     * If an outer scope ever exists (a future express mount ahead of the tRPC
     * handler, or a test harness), sharing one object across a batch would let
     * every procedure in that batch write `userId`/`tenantId` into the same
     * store. A procedure that runs without AuthMiddleware would then observe a
     * sibling's tenantId, flipping the Prisma extension from fail-closed to
     * fail-open on scheduling order. Copying keeps `requestId` correlation
     * identical while making per-procedure isolation unconditional.
     */
    const path = `trpc/${opts.path ?? 'unknown'}`;

    /*
     * `path` is re-derived even when inheriting. An outer express scope would
     * have set it from `req.originalUrl`, and `httpBatchLink` serializes query
     * inputs into that URL, so inheriting it verbatim would re-open the
     * exposure `buildRequestContextStore`'s `pathOverride` exists to close.
     */
    let store: IRequestContext;
    if (existing !== undefined) {
      store = { ...existing, path };
    } else if (req !== undefined) {
      store = buildRequestContextStore(req, path);
    } else {
      /*
       * No express request behind this call (a future WS/subscription driver,
       * or a server-side caller). Open a synthetic scope rather than passing
       * through: AuthMiddleware treats a missing store as a wiring defect and
       * throws, so degrading quietly here would turn a new transport into a 500
       * on every authenticated procedure.
       */
      store = { requestId: `trpc-${randomUUID()}`, path };
    }

    /*
     * Publish `requestId` onto the tRPC context OBJECT, not only onto the
     * downstream ctx that `next({ ctx })` builds.
     *
     * tRPC catches a procedure throw above every middleware and calls its
     * `onError` from `resolveResponse`'s own catch, by which point the
     * `requestContext.run` below has already returned and the ALS store is gone
     * so AppErrorHandler would report the `getRequestId()` 'no-context'
     * sentinel for exactly the failures worth correlating. What `onError` DOES
     * receive as `opts.ctx` is the object `AppContext.create` returned, which is
     * the same object reference handed to this middleware. `next({ ctx })` alone
     * cannot fix it: tRPC spreads that into a FRESH object for downstream and
     * never touches the original, so the write below is the load-bearing half
     * and the `next({ ctx })` is the typed surface for procedures.
     *
     * Only `requestId` is published. It is derived from the HTTP request, so
     * every procedure of a batch writes the same value into the ctx they share.
     * Publishing anything per-procedure (`userId`/`tenantId`) would let one
     * procedure's write be read as another's: the bleed the copy-on-inherit
     * above exists to prevent.
     */
    if (opts.ctx !== null && typeof opts.ctx === 'object') {
      (opts.ctx as { requestId?: string }).requestId = store.requestId;
    }

    // The `async` is load bearing: `run(store, () => opts.next())` would return
    // a promise Prisma has not started yet, and this repo's Prisma extension
    // reads the ALS when the promise is finally awaited, outside the scope,
    // where it fails closed. Awaiting inside keeps the resolution in scope.
    return requestContext.run(
      store,
      async () => await opts.next({ ctx: { requestId: store.requestId } }),
    );
  }
}
