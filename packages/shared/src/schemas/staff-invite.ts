import { z } from 'zod';
import { ROLES } from '../permissions/index.js';
import { emailSchema, passwordSchema } from './auth.js';

/**
 * Staff invitations into an EXISTING organization.
 */

/**
 * Invite a colleague by address.
 *
 * THE ADDRESS IS AN INPUT: there is no row to derive it from. A colleague who
 * has never had an account is not in the database at all, so the inviting
 * ADMIN types the address. What holds the line is the ADMIN guard on the
 * procedure, the idempotency key, and an audit row naming the account the
 * access was granted to.
 *
 * `role` is the member role enum only. Any other role is unrepresentable here
 * rather than merely refused: an invite is the one place a mistyped role would
 * mint a brand new account holding it, and `ROLES` is the const that makes the
 * mistake not type-check.
 */
export const staffInviteSendSchema = z.object({
  email: emailSchema,
  role: z.enum([ROLES.USER, ROLES.ADMIN]),
});

export const staffInviteSendOutput = z.object({
  /**
   * Always true on a successful call, and present so the shape is a record of
   * what happened rather than a bare ack: the invitee now exists as a PENDING
   * row, which is a state the members list has to render.
   */
  pending: z.literal(true),
  /**
   * Whether the invite mail reached the queue. False means the account and the
   * token exist but nothing was sent, which is a re-invitable state rather than
   * a broken one, and the admin has to be TOLD: there is no self-service resend
   * for someone who cannot log in yet. Reported truthfully for that reason.
   */
  emailSent: z.boolean(),
});

/**
 * Withdraw an invitation that was never accepted.
 *
 * Keyed on the pending `userId` rather than the address: by the time an admin
 * can click this, the row exists and the list they clicked it from is already
 * showing them its id. Taking an address instead would make the procedure
 * usable against accounts the caller never saw.
 */
export const staffInviteRevokeSchema = z.object({
  userId: z.string().min(1, 'User is required'),
});

/**
 * Withdraw an invitation that would MOVE an account from another organization.
 *
 * Keyed on the address, unlike `staffInviteRevokeSchema`, because there is no
 * row in the caller's organization to click: the invitation lives only as a token
 * against somebody else's account. Taking the address is safe here because the
 * procedure answers identically whether or not anything was open, so it cannot
 * tell the caller that the address exists anywhere. A listing of these
 * invitations was deliberately NOT added, for the same reason: it would
 * separate staff-elsewhere addresses from deleted ones, which
 * `staffInvite.send` is built never to reveal.
 */
export const staffInviteWithdrawByEmailSchema = z.object({
  email: emailSchema,
});

/**
 * Accept an invitation: set the password the account has never had.
 *
 * `factorCode` is required only when the account already carries an active,
 * non-recovery second factor, which is possible on the collision path where the
 * invite lands on an EXISTING account. Same contract as `resetPasswordSchema`,
 * and for the stronger version of its reason: acceptance can overwrite the
 * credential, move the account between organizations and change its role, so mailbox
 * proof alone must not be enough.
 */
export const staffInviteAcceptSchema = z.object({
  token: z.string().min(1, 'Invite token is required'),
  password: passwordSchema,
  factorCode: z.string().max(64).optional(),
});

/**
 * Pre-check the set-password screen calls on load. A mutation, not a query, so
 * the secret token rides the request body rather than a cacheable GET URL, the
 * same reason the password-reset pre-check is one.
 */
export const staffInviteStateSchema = z.object({
  token: z.string().min(1, 'Invite token is required'),
});

/**
 * What the acceptance screen is allowed to know before a password is set.
 *
 * `valid` alone would make the form unbuildable: the collision path needs a 2FA
 * field, and asking every invitee for a code they do not have is worse than
 * asking the one who does. So `requiresTwoFactor` is here for the same reason
 * `resetPasswordTokenState` carries it.
 *
 * `movesExistingAccount` is the one addition, and it is a disclosure decision
 * rather than a convenience: accepting on that path CLOSES the reader's current
 * organization, and a screen that takes a password without saying so is a phishing
 * page we wrote ourselves. It reveals only that the token's holder already has
 * an account, which the holder of a single-use token minted FOR that account
 * necessarily already knows.
 *
 * Deliberately absent: the address, the inviting organization's name, the inviter, and
 * the role. A guessed token must not be a disclosure even when it is rejected,
 * and every one of those is answered by the mail the real invitee is holding.
 */
export const staffInviteStateOutput = z.object({
  valid: z.boolean(),
  requiresTwoFactor: z.boolean(),
  movesExistingAccount: z.boolean(),
});

/**
 * Remove a member from the organization, or put a removed one back.
 *
 * Removal is NOT deletion and the two are separate procedures on purpose: this one is reversible, stamps `membershipEndedAt`, and
 * leaves the account and its audit trail standing. `adminDeleteUser` remains
 * the destructive one.
 */
export const memberActionSchema = z.object({
  userId: z.string().min(1, 'User is required'),
});

export type StaffInviteSendInput = z.infer<typeof staffInviteSendSchema>;
export type StaffInviteSendOutput = z.infer<typeof staffInviteSendOutput>;
export type StaffInviteRevokeInput = z.infer<typeof staffInviteRevokeSchema>;
export type StaffInviteWithdrawByEmailInput = z.infer<typeof staffInviteWithdrawByEmailSchema>;
export type StaffInviteAcceptInput = z.infer<typeof staffInviteAcceptSchema>;
export type StaffInviteStateInput = z.infer<typeof staffInviteStateSchema>;
export type StaffInviteStateOutput = z.infer<typeof staffInviteStateOutput>;
export type MemberActionInput = z.infer<typeof memberActionSchema>;
