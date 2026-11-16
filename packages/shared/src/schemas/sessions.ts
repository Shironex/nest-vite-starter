import { z } from 'zod';

/**
 * `sessions.list` output: the caller's own active sessions, one row per live
 * device. Timestamps are epoch milliseconds, matching the Redis
 * session blob. Deliberately carries ONLY what the self-service screen needs
 * to identify a session to a human plus an opaque revoke handle; identity
 * claims from the blob (email, role, epoch, tenantId) never cross the wire.
 *
 * `id` is an opaque public handle, NOT the server-side session id: the api
 * derives it by hashing the session id again, so a value seen in devtools,
 * logs, or the React Query cache can never name a Redis key.
 */
export const activeSessionsOutput = z.array(
  z.object({
    id: z.string(),
    ip: z.string(),
    userAgent: z.string(),
    createdAt: z.number(),
    lastActive: z.number(),
    /** True for the session that made this request (the device you are on). */
    isCurrent: z.boolean(),
  }),
);

export type ActiveSessionsOutput = z.infer<typeof activeSessionsOutput>;
export type ActiveSessionItem = ActiveSessionsOutput[number];

/**
 * `sessions.revoke` input: the opaque `id` from `sessions.list`. Shape-pinned
 * to a sha256 hex digest so garbage never reaches the lookup.
 */
export const revokeSessionSchema = z.object({
  sessionId: z.string().regex(/^[0-9a-f]{64}$/u),
});

export type RevokeSessionInput = z.infer<typeof revokeSessionSchema>;
