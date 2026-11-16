import type { ILandingCtaView } from './LandingCta.types';

/**
 * States only what is true of the starter: signup is self-serve. There is no
 * billing, so the band promises no trial and no cancellation terms.
 */
export function useLandingCta(): ILandingCtaView {
  return {
    heading: 'Start building today.',
    subheading: 'Create an account in a minute, with no sales call.',
    ctaLabel: 'Create an account',
  };
}
