import { cn } from '@repo/ui/lib/utils';
import type { IFormErrorProps } from './FormError.types';

// Destructive server-error alert shared by the auth forms, styled as the
// sign-in error banner of the design. Purely presentational: the
// caller owns the error state and copy. `className` is PREPENDED so a caller
// adding a width utility (VerifyEmail's `w-full`) still wins over the defaults.
export default function FormError({ className, children }: IFormErrorProps) {
  const alertClass = cn(
    className,
    'rounded-lg bg-danger-bg px-3.5 py-3 type-body-small text-danger-strong',
  );

  return (
    <div role="alert" className={alertClass}>
      {children}
    </div>
  );
}
