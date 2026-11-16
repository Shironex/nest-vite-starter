import { Check } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Container } from '@repo/ui/container';
import { sectionOverline } from '../../landing.styles';
import { useLandingPricing } from './LandingPricing.hooks';
import type { IPricingPlan } from './LandingPricing.types';

const CTA_BASE =
  'mt-6 block rounded-lg py-2.5 text-center type-body-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
const CTA_SOLID = `${CTA_BASE} bg-brand text-brand-fg hover:bg-brand-hover`;
const CTA_OUTLINE = `${CTA_BASE} border border-brand-200 bg-surface text-brand-ink hover:bg-brand-50`;

function PlanCard({ plan }: { plan: IPricingPlan }) {
  const cardClassName = plan.featured
    ? 'relative flex flex-col rounded-2xl border-2 border-brand bg-surface p-6 shadow-lg'
    : 'relative flex flex-col rounded-2xl border border-border bg-surface p-6';
  const ctaClassName = plan.featured ? CTA_SOLID : CTA_OUTLINE;

  const featureItems = plan.features.map((feature) => (
    <li key={feature} className="flex items-start gap-2.5">
      <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
      <span className="type-body-small text-text-secondary">{feature}</span>
    </li>
  ));

  const badge = plan.badge ? (
    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 type-label-caption text-brand-fg">
      {plan.badge}
    </span>
  ) : null;

  const cta = (
    <Link to="/auth/register" className={ctaClassName}>
      {plan.ctaLabel}
    </Link>
  );

  return (
    <li className={cardClassName}>
      {badge}
      <h3 className="type-display-wordmark text-text">{plan.name}</h3>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="type-display-large text-text">{plan.price}</span>
        <span className="type-label-caption text-text-tertiary">{plan.priceSuffix}</span>
      </p>
      <p className="mt-1 type-label-caption text-text-tertiary">{plan.audience}</p>

      <ul className="mt-6 flex flex-1 flex-col gap-2.5">{featureItems}</ul>

      {cta}
    </li>
  );
}

export default function LandingPricing() {
  const { plans } = useLandingPricing();

  const cards = plans.map((plan) => <PlanCard key={plan.name} plan={plan} />);

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="scroll-mt-16 border-b border-border bg-bg"
    >
      <Container>
        <div className="py-20">
          <div className="text-center">
            <p className={sectionOverline}>Pricing</p>
            <h2 id="pricing-heading" className="mt-3 type-display-large text-text">
              Plans that grow with your team.
            </h2>
          </div>

          <ul className="mx-auto mt-14 grid max-w-5xl items-stretch gap-4 lg:grid-cols-3">
            {cards}
          </ul>
        </div>
      </Container>
    </section>
  );
}
