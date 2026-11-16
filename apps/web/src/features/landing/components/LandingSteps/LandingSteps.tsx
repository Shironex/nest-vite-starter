import { Container } from '@repo/ui/container';
import { sectionOverline } from '../../landing.styles';
import { useLandingSteps } from './LandingSteps.hooks';
import type { ILandingStep } from './LandingSteps.types';

function StepRow({ step }: { step: ILandingStep }) {
  return (
    <li className="flex gap-5 border-b border-border py-6 last:border-b-0">
      <span aria-hidden="true" className="w-12 shrink-0 type-display-large text-brand-200">
        {step.number}
      </span>
      <span className="min-w-0 flex-1">
        <h3 className="type-display-wordmark text-text">{step.title}</h3>
        <p className="mt-1.5 type-body-regular text-text-muted">{step.description}</p>
      </span>
    </li>
  );
}

export default function LandingSteps() {
  const { steps } = useLandingSteps();

  const rows = steps.map((step) => <StepRow key={step.number} step={step} />);

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="scroll-mt-16 border-b border-border bg-surface"
    >
      <Container>
        <div className="grid gap-12 py-20 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-16">
          <div>
            <p className={sectionOverline}>How it works</p>
            <h2 id="how-it-works-heading" className="mt-3 type-display-large text-text">
              From sign-up to a working team in minutes.
            </h2>
            <p className="mt-4 type-body-regular text-text-muted">
              No onboarding project and no training. Sign up, invite people and get to work.
            </p>
          </div>

          <ol className="min-w-0">{rows}</ol>
        </div>
      </Container>
    </section>
  );
}
