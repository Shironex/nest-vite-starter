import type { IHeroMockRow, ILandingHeroView } from './LandingHero.types';

/**
 * Sample rows behind the hero illustration: generic team names, not people and
 * not customers, so the mock cannot be mistaken for social proof.
 *
 * Each entry is a TINT plate plus its matching ink, not a solid fill under white.
 * White initials on `bg-success` and friends measured 1.84:1 to 3.05:1 in Dark,
 * and no token value fixes that: a Dark tone value is a bright tint chosen to be
 * ink on a dark plate, so it cannot also carry white text. The tint-plus-ink
 * pairs below are the ones `pnpm check:contrast` already enforces and they clear
 * AA in both modes.
 */
const MOCK_ROWS: IHeroMockRow[] = [
  {
    initials: 'PR',
    name: 'Product',
    role: 'Team workspace',
    avatarClassName: 'bg-brand-100 text-brand-ink',
  },
  {
    initials: 'DE',
    name: 'Design',
    role: 'Team workspace',
    avatarClassName: 'bg-success-bg text-success',
  },
  {
    initials: 'EN',
    name: 'Engineering',
    role: 'Team workspace',
    avatarClassName: 'bg-warning-bg text-warning',
  },
  {
    initials: 'OP',
    name: 'Operations',
    role: 'Team workspace',
    avatarClassName: 'bg-purple-bg text-purple',
  },
  {
    initials: 'SU',
    name: 'Support',
    role: 'Team workspace',
    avatarClassName: 'bg-danger-bg text-danger',
    desktopOnly: true,
  },
];

export function useLandingHero(): ILandingHeroView {
  return { rows: MOCK_ROWS };
}
