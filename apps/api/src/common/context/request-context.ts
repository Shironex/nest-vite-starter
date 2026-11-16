import { AsyncLocalStorage } from 'node:async_hooks';

export interface IRequestContext {
  requestId: string;
  /**
   * Server-minted, per-HTTP-request nonce for anything that uses the request as
   * a deduplication KEY rather than a label.
   *
   * Separate from `requestId` because that one may be caller-supplied (a
   * `traceparent` or `x-request-id` header). A caller who can choose the key of
   * a BullMQ job can suppress the job, which for the security-notification mails
   * means silencing their own "two-factor disabled" alert. Undefined outside an
   * HTTP request (queue workers, crons), where there is no request to scope to.
   */
  dedupeNonce?: string | undefined;
  userId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  method?: string | undefined;
  path?: string | undefined;
  /**
   * W3C trace-id (lowercase hex, 32 chars) when an OTel active span exists for
   * the request. When OTel is disabled or no span is active, this is undefined
   * and `requestId` becomes the only correlation identifier.
   */
  traceId?: string | undefined;
  /**
   * W3C span-id (lowercase hex, 16 chars) of the request's root span.
   */
  spanId?: string | undefined;
  /**
   * Active Tenant (organization) id for the request. Read by the Prisma tenant-scope
   * extension to fail-closed and to inject `where: { tenantId }` on every
   * tenant-scoped model. Undefined for system/seed/CLI contexts running outside
   * a request, which is why those paths must use the unscoped client.
   */
  tenantId?: string | undefined;
  /**
   * Active Workspace id for the request. Reserved for the 3-tier scope (Workspace is
   * nested under Tenant); not yet enforced by the tenant-scope extension.
   */
  workspaceId?: string | undefined;
}

export const requestContext = new AsyncLocalStorage<IRequestContext>();

export function getRequestContext(): IRequestContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string {
  return requestContext.getStore()?.requestId ?? 'no-context';
}

export function getTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}

export function getSpanId(): string | undefined {
  return requestContext.getStore()?.spanId;
}

export function getTenantId(): string | undefined {
  return requestContext.getStore()?.tenantId;
}

export function getWorkspaceId(): string | undefined {
  return requestContext.getStore()?.workspaceId;
}
