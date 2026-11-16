import { Link } from '@tanstack/react-router';
import { Container } from '@repo/ui/container';
import { ctaOnBrand } from '../../landing.styles';
import { useLandingCta } from './LandingCta.hooks';

export default function LandingCta() {
  const { heading, subheading, ctaLabel } = useLandingCta();

  return (
    <section aria-labelledby="cta-heading" className="bg-surface">
      <Container>
        <div className="relative my-20 overflow-hidden rounded-3xl bg-brand px-8 py-14 sm:px-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 right-0 size-72 rounded-full bg-brand-fg/10"
          />
          <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 id="cta-heading" className="type-display-large text-brand-fg">
                {heading}
              </h2>
              <p className="mt-3 type-body-regular text-brand-fg/75">{subheading}</p>
            </div>

            <Link to="/auth/register" className={ctaOnBrand}>
              {ctaLabel}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
