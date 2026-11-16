import { Container } from '@repo/ui/container';
import { sectionOverline } from '../../landing.styles';
import { useLandingFeatures } from './LandingFeatures.hooks';
import type { FeatureCellVariant, IFeatureCell } from './LandingFeatures.types';

/**
 * The signature cell is the inverted surface: `bg-text` is near-black in light
 * mode and near-white under `.dark`, so the cell stays the maximum-contrast
 * anchor of the grid in both themes without a single hardcoded color.
 */
const CELL_STYLES: Record<FeatureCellVariant, string> = {
  default: 'border-border bg-surface',
  tint: 'border-border bg-brand-50',
  signature: 'border-text bg-text',
};

const CHIP_STYLES: Record<FeatureCellVariant, string> = {
  default: 'bg-brand-50 text-brand-ink',
  tint: 'bg-brand text-brand-fg',
  signature: 'bg-bg/10 text-bg',
};

const TITLE_STYLES: Record<FeatureCellVariant, string> = {
  default: 'text-text',
  tint: 'text-text',
  signature: 'text-bg',
};

const BODY_STYLES: Record<FeatureCellVariant, string> = {
  default: 'text-text-muted',
  tint: 'text-text-muted',
  signature: 'text-text-placeholder',
};

const PLANNED_BADGE_STYLES: Record<FeatureCellVariant, string> = {
  default: 'bg-warning-bg text-warning',
  tint: 'bg-warning-bg text-warning',
  signature: 'bg-bg/10 text-bg',
};

function FeatureCell({ cell }: { cell: IFeatureCell }) {
  const Icon = cell.icon;
  const cellClassName = `flex flex-col gap-3 rounded-2xl border p-6 ${CELL_STYLES[cell.variant]}`;
  const chipClassName = `flex size-10 items-center justify-center rounded-xl ${CHIP_STYLES[cell.variant]}`;
  const titleClassName = `type-display-wordmark ${TITLE_STYLES[cell.variant]}`;
  const bodyClassName = `type-body-small ${BODY_STYLES[cell.variant]}`;

  const plannedBadge = cell.planned ? (
    <span
      className={`rounded-full px-2 py-0.5 type-label-caption ${PLANNED_BADGE_STYLES[cell.variant]}`}
    >
      Coming soon
    </span>
  ) : null;

  return (
    <li className={cellClassName}>
      <span className={chipClassName}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={titleClassName}>{cell.title}</h3>
        {plannedBadge}
      </div>
      <p className={bodyClassName}>{cell.description}</p>
    </li>
  );
}

export default function LandingFeatures() {
  const { cells } = useLandingFeatures();

  const items = cells.map((cell) => <FeatureCell key={cell.title} cell={cell} />);

  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="scroll-mt-16 border-b border-border bg-bg"
    >
      <Container>
        <div className="py-20">
          <p className={sectionOverline}>Features</p>
          <h2 id="features-heading" className="mt-3 max-w-xl type-display-large text-text">
            Everything a SaaS needs before its first feature.
          </h2>

          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items}</ul>
        </div>
      </Container>
    </section>
  );
}
