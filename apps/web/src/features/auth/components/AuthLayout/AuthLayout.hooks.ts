import type { ReactNode } from 'react';
import type { AuthLayoutAlign, IAuthLayoutView } from './AuthLayout.types';

export function useAuthLayout({
  title,
  description,
  icon,
  align = 'start',
}: {
  title?: string | undefined;
  description?: ReactNode;
  icon?: ReactNode;
  align?: AuthLayoutAlign | undefined;
}): IAuthLayoutView {
  const hasHeader = Boolean(title ?? description ?? icon);

  return {
    hasHeader,
    headerClass: align === 'center' ? 'mb-7 flex flex-col items-center text-center' : 'mb-7',
    // A self-contained flex box so the centered variant centers the badge
    // without the icon inheriting the header's text alignment.
    badgeClass:
      'mb-5 flex size-12 items-center justify-center rounded-xl bg-brand-tint text-brand-ink [&_svg]:size-5',
  };
}
