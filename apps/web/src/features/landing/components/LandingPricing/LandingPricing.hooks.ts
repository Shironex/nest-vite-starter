import type { ILandingPricingView, IPricingPlan } from './LandingPricing.types';

/**
 * Placeholder tiers with no prices. Naming a price is a commercial decision the
 * starter cannot make for you: set real figures here once you have them, and
 * keep anything not built yet marked as planned.
 *
 * Every CTA points at self-serve signup, because there is no sales address to
 * send anyone to.
 */
const PRICE_TBD = 'Coming soon';
const PRICE_TBD_SUFFIX = 'pricing to be announced';

const PLANS: IPricingPlan[] = [
  {
    name: 'Starter',
    price: PRICE_TBD,
    priceSuffix: PRICE_TBD_SUFFIX,
    audience: 'For individuals and small teams',
    features: ['Accounts and two-factor sign-in', 'One organization', 'Email support'],
    ctaLabel: 'Create an account',
    ctaKind: 'register',
  },
  {
    name: 'Team',
    price: PRICE_TBD,
    priceSuffix: PRICE_TBD_SUFFIX,
    audience: 'For growing teams',
    features: [
      'Everything in Starter',
      'Multiple organizations',
      'Roles and access',
      'Audit log',
      'Priority support',
    ],
    ctaLabel: 'Create an account',
    ctaKind: 'register',
    featured: true,
    badge: 'Recommended',
  },
  {
    name: 'Enterprise',
    price: PRICE_TBD,
    priceSuffix: 'custom quote',
    audience: 'For larger organizations',
    features: ['Everything in Team', 'Dedicated support', 'SSO / SAML (planned)'],
    ctaLabel: 'Create an account',
    ctaKind: 'register',
  },
];

export function useLandingPricing(): ILandingPricingView {
  return { plans: PLANS };
}
