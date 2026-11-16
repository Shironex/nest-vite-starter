/**
 * Shared fixtures and helpers for apps/api specs.
 *
 * `userFixture` keeps test data in one place so a schema field rename doesn't
 * require touching every spec. `expressMocks` is an opinionated stand-in for
 * `Request`/`Response` shaped just well enough for the auth flows (cookies,
 * headers, method, `res.cookie`).
 */
import type { Request, Response } from 'express';
import type { IUserProfile } from '../src/modules/user/user.service';

/**
 * User row as returned by Prisma findFirst/findById/findByEmail (the full
 * User record, NOT the trimmed `IUserProfile` returned by `userService.getProfile`).
 *
 * Keep optional fields on the type as `?` so callers can omit them; tests get
 * the same shape Prisma would return at runtime.
 */
export interface UserFixture {
  id: string;
  email: string;
  /**
   * Null models an account with no password set. Every credential-verifying
   * path must treat that as a FAILED verification, so specs build one with
   * `userFixture({ passwordHash: null })`.
   */
  passwordHash: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  emailVerified: boolean;
  failedAttempts: number;
  lockoutCount: number;
  lockedUntil: Date | null;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /**
   * Set when somebody is removed from their organization without their account being
   * deleted. Distinct from `deletedAt`: the row stays live and visible, and
   * every credential path has to refuse it separately.
   */
  membershipEndedAt: Date | null;
}

/*
 * One frozen timestamp for every fixture row. Named rather than inlined so the
 * date says what it is and there is one place to move it
 * (`no-hardcoded-dates-in-fixtures`).
 */
const FIXTURE_TIMESTAMP = new Date('2026-01-01T00:00:00Z');

export const userFixture = (overrides: Partial<UserFixture> = {}): UserFixture => ({
  id: 'user-1',
  email: 'test@example.com',
  passwordHash:
    '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA',
  displayName: null,
  avatarUrl: null,
  role: 'USER',
  emailVerified: false,
  failedAttempts: 0,
  lockoutCount: 0,
  lockedUntil: null,
  tenantId: null,
  createdAt: FIXTURE_TIMESTAMP,
  updatedAt: FIXTURE_TIMESTAMP,
  deletedAt: null,
  membershipEndedAt: null,
  ...overrides,
});

/** Trimmed shape returned by `userService.getProfile`. */
export const userProfileFixture = (overrides: Partial<UserFixture> = {}): IUserProfile => {
  const u = userFixture(overrides);
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
  };
};

/**
 * Minimal Express req/res mocks shaped for the auth-flow services.
 * `res.cookie` is a jest fn so callers can assert on cookie writes.
 */
export interface ExpressMocks {
  req: Request;
  res: Response;
  cookieMock: jest.Mock;
}

export const expressMocks = (
  init: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): ExpressMocks => {
  const cookieMock = jest.fn();
  const req = {
    cookies: { ...(init.cookies ?? {}) },
    headers: { ...(init.headers ?? {}) },
    method: init.method ?? 'POST',
    // getClientIp reads req.ip with a req.socket fallback; give the mocks the
    // shape express guarantees so controller handlers can attribute requests.
    ip: '203.0.113.9',
    socket: { remoteAddress: '203.0.113.9' },
  } as unknown as Request;
  const res = {
    cookie: cookieMock,
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res, cookieMock };
};
