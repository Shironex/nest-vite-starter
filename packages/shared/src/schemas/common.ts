import { z } from 'zod';

export const pingInputSchema = z.object({
  message: z.optional(z.string()),
});

export const pingOutputSchema = z.object({
  pong: z.string(),
  timestamp: z.number(),
});

/**
 * Domain-neutral acknowledgment output for mutations whose only meaningful
 * result is "it worked" (storage.deleteFile, user.updateAvatar, unlockUser,
 * updateUserRole). Set as the procedure `output:` so the server zod-strips the
 * wire response to exactly `{ success: true }` and nothing internal can leak
 * through a wider return value.
 *
 * Deliberately separate from auth.ts's `authAckOutput` despite the identical
 * shape: these are independent wire contracts that merely agree today, and
 * sharing one schema would let a future change to the auth ack silently
 * rewrite the storage and user contracts too.
 */
export const ackOutput = z.object({
  success: z.literal(true),
});

export type PingInput = z.infer<typeof pingInputSchema>;
export type PingOutput = z.infer<typeof pingOutputSchema>;
export type AckOutput = z.infer<typeof ackOutput>;
