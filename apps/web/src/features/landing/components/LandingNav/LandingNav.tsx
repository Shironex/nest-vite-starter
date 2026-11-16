import { Menu, X } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Container } from '@repo/ui/container';
import { ctaNav, navLink } from '../../landing.styles';
import { useLandingNav } from './LandingNav.hooks';
import type { ILandingNavLink } from './LandingNav.types';

const MOBILE_MENU_ID = 'landing-mobile-menu';

function NavAnchor({ link, onNavigate }: { link: ILandingNavLink; onNavigate: () => void }) {
  return (
    <a href={link.href} className={navLink} onClick={onNavigate}>
      {link.label}
    </a>
  );
}

export default function LandingNav() {
  const { links, isMenuOpen, toggleMenu, closeMenu } = useLandingNav();

  const desktopLinks = links.map((link) => (
    <NavAnchor key={link.href} link={link} onNavigate={closeMenu} />
  ));
  const mobileLinks = links.map((link) => (
    <NavAnchor key={link.href} link={link} onNavigate={closeMenu} />
  ));

  const menuIcon = isMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />;
  const menuLabel = isMenuOpen ? 'Close menu' : 'Open menu';
  const isMenuHidden = !isMenuOpen;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/85 backdrop-blur-sm">
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
              A
            </span>
            <span className="type-display-wordmark text-text">SaaS Starter</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
            {desktopLinks}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Link to="/auth/login" className={navLink}>
              Log in
            </Link>
            <Link to="/auth/register" className={ctaNav}>
              Sign up
            </Link>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <Link to="/auth/register" className={ctaNav}>
              Sign up
            </Link>
            <button
              type="button"
              onClick={toggleMenu}
              aria-expanded={isMenuOpen}
              aria-controls={MOBILE_MENU_ID}
              aria-label={menuLabel}
              className="flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {menuIcon}
            </button>
          </div>
        </div>

        <div id={MOBILE_MENU_ID} hidden={isMenuHidden} className="border-t border-border md:hidden">
          <nav aria-label="Main (mobile)" className="flex flex-col gap-1 py-3">
            {mobileLinks}
            <Link to="/auth/login" className={navLink} onClick={closeMenu}>
              Log in
            </Link>
          </nav>
        </div>
      </Container>
    </header>
  );
}
