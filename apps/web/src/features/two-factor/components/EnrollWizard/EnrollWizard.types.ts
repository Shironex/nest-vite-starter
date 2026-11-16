import type { UseFormReturn } from 'react-hook-form';
import type { TwoFactorBeginEnrollmentInput, TwoFactorActivateInput } from '@repo/shared/schemas';

export type TwoFactorEnrollStep = 'password' | 'confirm' | 'codes';

export interface IEnrollWizardProps {
  /** Called after the recovery codes are shown and the user finishes. */
  readonly onComplete?: () => void;
}

export interface IEnrollWizardView {
  readonly step: TwoFactorEnrollStep;
  readonly passwordForm: UseFormReturn<TwoFactorBeginEnrollmentInput>;
  readonly onBeginEnrollment: (data: TwoFactorBeginEnrollmentInput) => void;
  readonly isBeginning: boolean;
  readonly confirmForm: UseFormReturn<TwoFactorActivateInput>;
  readonly onActivate: (data: TwoFactorActivateInput) => void;
  readonly isActivating: boolean;
  /** SVG data URI for the otpauth QR, generated locally; null before step 2. */
  readonly qrDataUri: string | null;
  /** Base32 secret for manual entry; null before step 2. */
  readonly secretBase32: string | null;
  /** One-time recovery codes revealed after activation; null before step 3. */
  readonly recoveryCodes: readonly string[] | null;
  readonly onFinish: () => void;
}
