/**
 * Thrown by `BaseRepository.updateWithVersion` when the row's `version`
 * column doesn't match the version the caller passed in. Means another
 * writer updated the row since the caller read it. The caller should
 * re-fetch and retry, or surface a "stale data" error to the user.
 *
 * Routers should map this to TRPCError code `CONFLICT` (HTTP 409).
 */
export class ConcurrencyError extends Error {
  readonly name = 'ConcurrencyError';

  constructor(
    public readonly model: string,
    public readonly id: string,
    public readonly expectedVersion: number,
  ) {
    super(
      `Concurrent update detected on ${model}#${id} (expected version ${expectedVersion}). ` +
        `Another writer modified this row since it was read.`,
    );
  }
}
