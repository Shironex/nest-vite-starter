import { cn } from '@repo/ui/lib/utils';
import { LandingNav } from '../LandingNav';
import { LandingHero } from '../LandingHero';
import { LandingFeatures } from '../LandingFeatures';
import { LandingSteps } from '../LandingSteps';
import { LandingPricing } from '../LandingPricing';
import { LandingFaq } from '../LandingFaq';
import { LandingCta } from '../LandingCta';
import { LandingFooter } from '../LandingFooter';
import type { ILandingPageProps } from './LandingPage.types';

/**
 * The starter's placeholder marketing page. It carries no customer logos and no
 * testimonial on purpose: a new product has neither, and inventing them is the
 * first thing a real launch would have to take back out.
 */
export default function LandingPage({ className }: ILandingPageProps) {
  return (
    <div className={cn('bg-surface', className)}>
      <LandingNav />
      <main id="main-content">
        <LandingHero />
        <LandingFeatures />
        <LandingSteps />
        <LandingPricing />
        <LandingFaq />
        <LandingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
