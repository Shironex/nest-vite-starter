import { cn } from '@repo/ui/lib/utils';
import type { IFormSuccessProps } from './FormSuccess.types';

// Green status banner shared by the auth forms (twin of FormError). Purely
// presentational: the caller owns the state and copy. `className` is
// PREPENDED so a caller adding a width utility (VerifyEmail's `w-full`)
// renders the exact class string the inline div used to have.
export default function FormSuccess({ className, children }: IFormSuccessProps) {
  const statusClass = cn(
    className,
    'rounded-lg bg-success-bg px-3.5 py-3 type-body-small text-success',
  );

  return (
    <div role="status" className={statusClass}>
      {children}
    </div>
  );
}
