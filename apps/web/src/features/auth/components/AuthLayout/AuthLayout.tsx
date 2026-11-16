import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AUTH_NS } from '@/features/auth/Auth.i18n';
import { BrandPanel } from '@/features/auth/components/BrandPanel';
import { useAuthLayout } from './AuthLayout.hooks';
import type { IAuthLayoutProps } from './AuthLayout.types';

/**
 * Two-column shell shared by every auth screen: the blue brand panel on the
 * left and a 400px form column on the right.
 *
 * The "back to home" link has no counterpart in the design, but it is the only
 * way out of the auth area for a keyboard or screen-reader user, so it is kept
 * and moved into the form column's own header rather than dropped.
 */
export default function AuthLayout({
  title,
  description,
  icon,
  align = 'start',
  children,
}: IAuthLayoutProps) {
  const { t } = useTranslation(AUTH_NS);
  const { hasHeader, headerClass, badgeClass } = useAuthLayout({
    title,
    description,
    icon,
    align,
  });

  return (
    <div className="flex min-h-screen bg-bg">
      <BrandPanel />

      <div className="flex w-full flex-col">
        <header className="flex h-16 shrink-0 items-center px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-sm type-body-small text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('layout.backToHome')}
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-100">
            {hasHeader && (
              <div className={headerClass}>
                {icon && <span className={badgeClass}>{icon}</span>}
                {title && <h1 className="type-display-large text-text">{title}</h1>}
                {description && (
                  <p className="mt-1.5 type-body-regular text-text-muted">{description}</p>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
