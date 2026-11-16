import { z } from 'zod';
import { userProfileOutput } from './user.js';

/** One password complexity rule: regex plus its UI/validation copy. */
export interface IPasswordRequirement {
  /** Checklist label shown by the web strength meter. */
  label: string;
  /** Validation error message raised by passwordSchema. */
  message: string;
  regex: RegExp;
}

/**
 * Password complexity rules: the single source of truth for BOTH the zod
 * passwordSchema below and the web strength meter
 * (apps/web/src/features/shared/components/PasswordStrength). Order matters:
 * issues surface in this order, so the length rule stays the first error.
 */
export const PASSWORD_REQUIREMENTS: readonly IPasswordRequirement[] = [
  {
    label: 'At least 8 characters',
    message: 'Password must be at least 8 characters',
    // [\s\S] instead of . so a (pathological) newline still counts as a char.
    regex: /^[\s\S]{8,}$/,
  },
  {
    label: 'Uppercase letter',
    message: 'Password must contain an uppercase letter',
    regex: /[A-Z]/,
  },
  {
    label: 'Lowercase letter',
    message: 'Password must contain a lowercase letter',
    regex: /[a-z]/,
  },
  {
    label: 'Number',
    message: 'Password must contain a number',
    regex: /[0-9]/,
  },
  {
    label: 'Special character',
    message: 'Password must contain a special character',
    regex: /[^A-Za-z0-9]/,
  },
];

/**
 * Password schema built from PASSWORD_REQUIREMENTS.
 * Must contain: uppercase, lowercase, number, and special character.
 * Minimum 8 characters.
 */
export const passwordSchema = PASSWORD_REQUIREMENTS.reduce<z.ZodString>(
  (schema, requirement) => schema.refine((val) => requirement.regex.test(val), requirement.message),
  z.string(),
);

/** Email schema with normalization (trim + lowercase). */
export const emailSchema = z
  .string()
  .email('Invalid email address')
  .transform((val) => val.trim().toLowerCase());

/** Cloudflare Turnstile response token. */
export const turnstileTokenSchema = z.string().min(1, 'Turnstile token is required');

/** Registration input. */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().max(100).optional(),
  turnstileToken: turnstileTokenSchema,
});

/** Login input. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
  turnstileToken: turnstileTokenSchema,
});

/** Forgot password input. */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
  turnstileToken: turnstileTokenSchema,
});

/** Reset password input (from email link). */
export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
  // Required only when the account has an active second factor (see
  // resetPasswordTokenState): the mailbox alone must not be enough to change a
  // credential on a 2FA-protected account. Accepts a TOTP or recovery code.
  factorCode: z.string().max(64).optional(),
});

/**
 * Reset-token pre-check the reset form calls on load. A mutation (not a query)
 * so the secret token rides the request body, not a cacheable GET URL.
 * `requiresTwoFactor` tells the form whether to show the code field.
 */
export const resetPasswordTokenStateSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
});

export const resetPasswordTokenStateOutput = z.object({
  valid: z.boolean(),
  requiresTwoFactor: z.boolean(),
});

/** Change password input (authenticated user). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

/**
 * Delete account input (authenticated user). The current password re-confirms
 * intent; complexity rules do not apply to an existing credential, so this is
 * a bare non-empty string like loginSchema.password.
 */
export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

/**
 * Output for the account-deletion mutations (self-service `auth.deleteAccount`
 * and admin `user.adminDeleteUser`). A literal `true` keeps the wire contract
 * explicit and lets the server zod-strip anything wider.
 */
export const accountDeletedOutput = z.object({
  deleted: z.literal(true),
});

/** Email verification input. */
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

/**
 * `auth.requestEmailChange` input (authenticated + sudo-gated). The new
 * address only becomes the login identity after `auth.confirmEmailChange`
 * consumes the link sent to it; until then the old address stays
 * authoritative. `factorCode` is required only when the account has an active
 * second factor (same contract as resetPasswordSchema): a TOTP or recovery
 * code, so a stolen session plus the password alone cannot move the account
 * off a 2FA-protected mailbox.
 */
export const requestEmailChangeSchema = z.object({
  newEmail: emailSchema,
  // Bounded like verifyTwoFactorSchema.code: 6-digit TOTP or ~19-char
  // recovery code, so 64 is generous.
  factorCode: z.string().max(64).optional(),
});

/** `auth.confirmEmailChange` input (from the link mailed to the NEW address). */
export const confirmEmailChangeSchema = z.object({
  token: z.string().min(1, 'Confirmation token is required'),
});

/** Resend verification email input. */
export const resendVerificationSchema = z.object({
  turnstileToken: turnstileTokenSchema,
});

/**
 * Acknowledgment output for the ack-shaped auth mutations (logout, logoutAll,
 * verifyEmail, resetPassword, forgotPassword). Set as the procedure `output:`
 * so the server zod-strips the wire response to exactly `{ success: true }` and
 * nothing internal can leak through a wider return value. A literal `true`
 * makes the contract explicit on both ends.
 */
export const authAckOutput = z.object({
  success: z.literal(true),
});

/**
 * `auth.login` output: a discriminated union on `status`. `ok` is the existing
 * success shape; `twofa_required` means password verified but a second factor
 * is needed, and the SPA must route to the 2FA challenge (the `__Host-2fa`
 * pending cookie is already set). `methods` is what makes adding WebAuthn later
 * additive. The explicit `output:` schema still zod-strips the wire response so
 * credential fields cannot leak, and the client narrows on `status`.
 */
export const loginOutput = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    user: userProfileOutput,
    requiresVerification: z.boolean(),
  }),
  z.object({
    status: z.literal('twofa_required'),
    methods: z.array(z.string()),
  }),
]);

/**
 * `auth.verifyTwoFactor` input. One field serves both variants: 6 digits = TOTP,
 * the 16-char grouped format = recovery code. `trustDevice` remembers the
 * browser for 30 days so subsequent logins skip the challenge.
 */
export const verifyTwoFactorSchema = z.object({
  // Bounded so an unbounded string never flows into regex-normalize + sha256. A
  // TOTP is 6 digits and a recovery code ~19 chars, so 64 is generous.
  code: z.string().min(1, 'Code is required').max(64),
  trustDevice: z.boolean().optional(),
});

/**
 * `auth.register` output. `emailSent: false` means the account was created but
 * the verification email could not be enqueued: the web verify-email screen
 * branches on it, so it must stay a typed part of the contract.
 */
export const registerOutput = z.object({
  user: userProfileOutput,
  requiresVerification: z.boolean(),
  emailSent: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/* Sudo (step-up for sensitive account changes)                               */
/* -------------------------------------------------------------------------- */

/**
 * `auth.confirmPassword` input: re-prove the current password to grant this
 * SESSION a 300 s sudo window (required by email change). A
 * bare non-empty string like loginSchema.password: complexity rules never
 * apply to an existing credential.
 */
export const confirmPasswordSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export type ConfirmPasswordInput = z.infer<typeof confirmPasswordSchema>;

/* -------------------------------------------------------------------------- */
/* Two-factor authentication (protected `twoFactor` router)                   */
/* -------------------------------------------------------------------------- */

/** Password sudo gate shared by begin-enrollment and regenerate. */
export const twoFactorBeginEnrollmentSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

/** `twoFactor.beginEnrollment` output: the otpauth URI (QR) + base32 (manual). */
export const twoFactorSetupOutput = z.object({
  otpauthUri: z.string(),
  secretBase32: z.string(),
});

/** `twoFactor.activate` input: the first confirming TOTP code. */
export const twoFactorActivateSchema = z.object({
  code: z.string().min(1, 'Code is required').max(64),
});

/**
 * Shared output for the two procedures that reveal recovery codes exactly once
 * (`activate`, `regenerateRecoveryCodes`). The api never returns them again.
 */
export const twoFactorRecoveryCodesOutput = z.object({
  recoveryCodes: z.array(z.string()),
});

/** `twoFactor.disable` input: password AND a current TOTP or recovery code. */
export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().min(1, 'Code is required').max(64),
});

/** `twoFactor.regenerateRecoveryCodes` input: password sudo gate. */
export const twoFactorRegenerateSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

/** `twoFactor.resetMemberTwoFactor` input (tenant admin). */
export const resetMemberTwoFactorSchema = z.object({
  userId: z.string().min(1, 'User id is required'),
});

/** `twoFactor.status` output backing the settings security card. */
export const twoFactorStatusOutput = z.object({
  enabled: z.boolean(),
  methods: z.array(z.string()),
  recoveryCodesRemaining: z.number().int(),
  lowRecoveryCodes: z.boolean(),
  pendingEnrollment: z.boolean(),
  trustedDeviceCount: z.number().int(),
});

export type TwoFactorBeginEnrollmentInput = z.infer<typeof twoFactorBeginEnrollmentSchema>;
export type TwoFactorSetupOutput = z.infer<typeof twoFactorSetupOutput>;
export type TwoFactorActivateInput = z.infer<typeof twoFactorActivateSchema>;
export type TwoFactorRecoveryCodesOutput = z.infer<typeof twoFactorRecoveryCodesOutput>;
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;
export type TwoFactorRegenerateInput = z.infer<typeof twoFactorRegenerateSchema>;
export type TwoFactorStatusOutput = z.infer<typeof twoFactorStatusOutput>;
export type ResetMemberTwoFactorInput = z.infer<typeof resetMemberTwoFactorSchema>;
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;
export type ResetPasswordTokenStateInput = z.infer<typeof resetPasswordTokenStateSchema>;
export type ResetPasswordTokenStateOutput = z.infer<typeof resetPasswordTokenStateOutput>;

export type AuthAckOutput = z.infer<typeof authAckOutput>;
export type LoginOutput = z.infer<typeof loginOutput>;
export type RegisterOutput = z.infer<typeof registerOutput>;
export type AccountDeletedOutput = z.infer<typeof accountDeletedOutput>;

// Inferred types
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;
