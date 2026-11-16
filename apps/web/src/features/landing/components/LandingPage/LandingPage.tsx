import { Link } from '@tanstack/react-router';
import { Container } from '@repo/ui/container';
import { cn } from '@repo/ui/lib/utils';
import { ctaNav, ctaPrimary, ctaSecondary, navLink } from '../../landing.styles';
import { landingStrings } from '../../Landing.strings';
import { useLandingPage } from './LandingPage.hooks';
import type { ILandingPageProps } from './LandingPage.types';

/**
 * The one public page: the product name, one line about it, and the way in.
 *
 * Deliberately small. A starter has no customers, prices or testimonials, and
 * a marketing page full of invented ones is the first thing a real launch has
 * to take back out. Build the real one when there is something to say.
 */
export default function LandingPage({ className }: ILandingPageProps) {
  const v = useLandingPage();

  return (
    <div className={cn('flex min-h-screen flex-col bg-surface', className)}>
      <header className="border-b border-border">
        <Container>
          <div className="flex h-16 items-center justify-between gap-6">
            <Link
              to="/"
              className="flex items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              <span
                aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-lg bg-brand type-heading-h3 text-brand-fg"
              >
                {v.productMark}
              </span>
              <span className="type-display-wordmark text-text">{v.productName}</span>
            </Link>

            <nav aria-label={landingStrings.nav.label} className="flex items-center gap-4">
              <Link to="/auth/login" className={navLink}>
                {landingStrings.nav.signIn}
              </Link>
              <Link to="/auth/register" className={ctaNav}>
                {landingStrings.nav.createAccount}
              </Link>
            </nav>
          </div>
        </Container>
      </header>

      <main id="main-content" className="flex flex-1 items-center">
        <Container>
          <div className="max-w-2xl py-20">
            <h1 className="type-display-large text-text sm:type-display-hero">{v.productName}</h1>
            <p className="mt-5 type-body-regular text-text-secondary">{landingStrings.hero.lead}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/auth/register" className={ctaPrimary}>
                {landingStrings.hero.createAccount}
              </Link>
              <Link to="/auth/login" className={ctaSecondary}>
                {landingStrings.hero.signIn}
              </Link>
            </div>
          </div>
        </Container>
      </main>

      <footer className="border-t border-border">
        <Container>
          <p className="py-8 type-body-small text-text-tertiary">{v.copyright}</p>
        </Container>
      </footer>
    </div>
  );
}
