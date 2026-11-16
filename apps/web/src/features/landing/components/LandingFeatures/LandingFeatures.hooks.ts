import {
  Building2,
  FileClock,
  KeyRound,
  MonitorSmartphone,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import type { IFeatureCell, ILandingFeaturesView } from './LandingFeatures.types';

/**
 * Only what the starter ships. When you add a capability that is designed but
 * not built yet, list it with `planned: true` rather than in the present tense.
 */
const CELLS: IFeatureCell[] = [
  {
    icon: KeyRound,
    title: 'Accounts and sessions',
    description:
      'Email sign-up with verification, server-side sessions and Argon2id password hashing.',
    variant: 'tint',
  },
  {
    icon: ShieldCheck,
    title: 'Two-factor sign-in',
    description:
      'Authenticator-app codes with recovery codes, and a fresh check before sensitive account changes.',
    variant: 'default',
  },
  {
    icon: Building2,
    title: 'Organizations',
    description:
      'Multi-tenant by default: every record belongs to an organization, enforced in the data layer, not only in the UI.',
    variant: 'default',
  },
  {
    icon: FileClock,
    title: 'Audit log',
    description:
      'Sign-ins, role changes and data changes are recorded with who, when and what, and can be filtered.',
    variant: 'default',
  },
  {
    icon: Workflow,
    title: 'Typed end to end',
    description:
      'One contract between the API and the client, so a breaking change fails the build instead of a page.',
    variant: 'default',
  },
  {
    icon: MonitorSmartphone,
    title: 'Session control',
    description: 'See every device signed in to your account and sign the others out in one step.',
    variant: 'signature',
  },
];

export function useLandingFeatures(): ILandingFeaturesView {
  return { cells: CELLS };
}
