import { useCallback, useState } from 'react';
import type { ILandingNavLink, ILandingNavView } from './LandingNav.types';

const NAV_LINKS: ILandingNavLink[] = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function useLandingNav(): ILandingNavView {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => setIsMenuOpen((open) => !open), []);
  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  return { links: NAV_LINKS, isMenuOpen, toggleMenu, closeMenu };
}
