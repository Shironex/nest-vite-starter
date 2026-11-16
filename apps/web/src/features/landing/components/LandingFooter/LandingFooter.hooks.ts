import type { ILandingFooterLink, ILandingFooterView } from './LandingFooter.types';

/**
 * No Terms or Privacy links yet: neither page exists, and a link to a 404 is
 * worse than no link. Add them here when those routes land.
 */
const LINKS: ILandingFooterLink[] = [
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function useLandingFooter(): ILandingFooterView {
  return { links: LINKS, copyright: '© 2026 SaaS Starter' };
}
