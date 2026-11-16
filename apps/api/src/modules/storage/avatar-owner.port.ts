/**
 * What storage needs from whoever owns `User.avatarUrl`, and nothing more.
 *
 * `StorageRouter.deleteFile` removes an object the caller owns. When that
 * object backed their current avatar, the profile must stop pointing at it,
 * or `User.avatarUrl` dangles on a key S3 no longer has. Storage does not own
 * the user row, so it cannot write it; it owns this contract instead, and the
 * user module implements it.
 *
 * The seam is a port rather than the repository because storage needs one
 * BEHAVIOR, not the user module's persistence. Holding UserRepository put
 * every user query in reach of a router whose whole job is object keys.
 *
 * Bound `useExisting: UserRepository` in `user/avatar-owner.module.ts`, the
 * leaf StorageModule imports. It is a leaf because UserModule already imports
 * StorageModule for avatar cleanup, so importing UserModule back would cycle.
 */
export abstract class AvatarOwnerPort {
  /**
   * Clear the avatar reference, but only while it still equals `key`.
   *
   * A compare-and-swap, soft-delete guarded: a profile that has already moved
   * on to another avatar is left alone, so deleting an old object can never
   * wipe a newer one. Resolves true when a row changed.
   *
   * Writes no audit row. The caller has already audited the delete that made
   * this necessary, and the reference clearing is a consequence of it rather
   * than a second act.
   */
  abstract clearAvatarIfCurrent(userId: string, key: string): Promise<boolean>;
}
