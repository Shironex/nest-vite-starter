import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * Living reference for the design tokens.
 *
 * One variable collection with a Light and a Dark mode, defined in
 * `packages/ui/src/styles/globals.css`. Every swatch below renders the real utility, so if a token
 * stops resolving the swatch goes transparent and the story shows it.
 *
 * Switch mode with the Storybook theme toggle and palette with the
 * "Color Theme" toolbar. SaaS Starter is the default.
 */
const meta = {
  title: 'Foundations/Design Tokens',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface ISwatch {
  /** The Tailwind utility a consumer writes. */
  utility: string;
  /** The design variable it came from. */
  source: string;
}

function SwatchGrid({ title, swatches }: { title: string; swatches: ISwatch[] }) {
  return (
    <section className="mb-8">
      <h3 className="mb-3 type-label-overline text-text-muted">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {swatches.map((swatch) => (
          <div
            key={swatch.utility}
            className="flex items-center gap-3 rounded-md border border-border bg-surface p-2"
          >
            <span
              className={`size-10 shrink-0 rounded-md border border-border ${swatch.utility}`}
            />
            <span className="min-w-0">
              <span className="block truncate type-body-small text-text">
                {swatch.utility.replace(/^bg-/, '')}
              </span>
              <span className="block truncate type-mono-small text-text-tertiary">
                {swatch.source}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** All 35 color variables, grouped the way the design groups them. */
export const Colors: Story = {
  render: () => (
    <div className="min-h-screen bg-bg p-8 type-body-regular text-text">
      <h2 className="mb-1 type-heading-h1">Colors</h2>
      <p className="mb-8 type-body-small text-text-muted">
        35 variables, each with a Light and a Dark value. The label under every swatch is the design
        variable name.
      </p>

      <SwatchGrid
        title="Brand"
        swatches={[
          { utility: 'bg-brand', source: 'color/brand/primary' },
          { utility: 'bg-brand-hover', source: 'color/brand/primary-hover' },
          { utility: 'bg-brand-fg', source: 'color/brand/primary-fg' },
          { utility: 'bg-brand-ink', source: 'color/brand/ink' },
          { utility: 'bg-brand-ink-hover', source: 'color/brand/ink-hover' },
          { utility: 'bg-brand-tint', source: 'color/brand/tint' },
          { utility: 'bg-brand-50', source: 'color/brand/tint-50' },
          { utility: 'bg-brand-100', source: 'color/brand/tint-100' },
          { utility: 'bg-brand-200', source: 'color/brand/tint-200' },
        ]}
      />

      <SwatchGrid
        title="Surfaces"
        swatches={[
          { utility: 'bg-bg', source: 'color/bg/app' },
          { utility: 'bg-surface', source: 'color/bg/surface' },
          { utility: 'bg-hover', source: 'color/bg/hover' },
          { utility: 'bg-subtle', source: 'color/bg/subtle' },
        ]}
      />

      <SwatchGrid
        title="Text"
        swatches={[
          { utility: 'bg-text', source: 'color/text/primary' },
          { utility: 'bg-text-secondary', source: 'color/text/secondary' },
          { utility: 'bg-text-muted', source: 'color/text/muted' },
          { utility: 'bg-text-tertiary', source: 'color/text/tertiary' },
          { utility: 'bg-text-placeholder', source: 'color/text/placeholder' },
        ]}
      />

      <SwatchGrid
        title="Border"
        swatches={[
          { utility: 'bg-border', source: 'color/border/default' },
          { utility: 'bg-border-strong', source: 'color/border/strong' },
        ]}
      />

      <SwatchGrid
        title="Status"
        swatches={[
          { utility: 'bg-success', source: 'color/success/fg' },
          { utility: 'bg-success-bg', source: 'color/success/bg' },
          { utility: 'bg-danger', source: 'color/danger/fg' },
          { utility: 'bg-danger-strong', source: 'color/danger/strong' },
          { utility: 'bg-danger-bg', source: 'color/danger/bg' },
          { utility: 'bg-warning', source: 'color/warning/fg' },
          { utility: 'bg-warning-bg', source: 'color/warning/bg' },
          { utility: 'bg-purple', source: 'color/purple/fg' },
          { utility: 'bg-purple-bg', source: 'color/purple/bg' },
        ]}
      />

      <SwatchGrid
        title="Neutral ramp (only 100 to 700 exist)"
        swatches={[
          { utility: 'bg-neutral-100', source: 'color/neutral/100' },
          { utility: 'bg-neutral-200', source: 'color/neutral/200' },
          { utility: 'bg-neutral-300', source: 'color/neutral/300' },
          { utility: 'bg-neutral-400', source: 'color/neutral/400' },
          { utility: 'bg-neutral-500', source: 'color/neutral/500' },
          { utility: 'bg-neutral-600', source: 'color/neutral/600' },
          { utility: 'bg-neutral-700', source: 'color/neutral/700' },
        ]}
      />
    </div>
  ),
};

const TYPE_RAMP = [
  { utility: 'type-display-hero', sample: 'SaaS Starter', note: 'Bricolage Grotesque 700, 44px' },
  {
    utility: 'type-display-large',
    sample: 'Your organization in one place',
    note: 'Bricolage Grotesque 700, 32px',
  },
  {
    utility: 'type-display-wordmark',
    sample: 'SaaS Starter',
    note: 'Bricolage Grotesque 700, 18px',
  },
  {
    utility: 'type-stat-figure',
    sample: '94',
    note: 'Instrument Sans 700, 28px, not a design style',
  },
  { utility: 'type-heading-h1', sample: 'Members', note: 'Instrument Sans 600, 22px' },
  { utility: 'type-heading-h2', sample: 'Contracts', note: 'Instrument Sans 600, 18px' },
  { utility: 'type-heading-h3', sample: 'Personal details', note: 'Instrument Sans 600, 15px' },
  {
    utility: 'type-body-regular',
    sample: 'Default body text in the interface.',
    note: 'Instrument Sans 400, 14px',
  },
  { utility: 'type-body-medium', sample: 'Form label', note: 'Instrument Sans 500, 14px' },
  {
    utility: 'type-body-strong',
    sample: 'Active navigation item',
    note: 'Instrument Sans 600, 14px, not a design style',
  },
  { utility: 'type-body-small', sample: 'Helper text', note: 'Instrument Sans 400, 13px' },
  { utility: 'type-label-caption', sample: 'Updated', note: 'Instrument Sans 500, 12px' },
  {
    utility: 'type-label-overline',
    sample: 'Section',
    note: 'Instrument Sans 600, 11px, uppercase',
  },
  { utility: 'type-mono-small', sample: '1234 5678 9012 3456', note: 'Spline Sans Mono 400, 13px' },
];

/**
 * The 12 design text styles, one utility each, plus the two code side additions
 * the design uses but the published ramp has no slot for. Never hand roll a font size.
 */
export const Typography: Story = {
  render: () => (
    <div className="min-h-screen bg-bg p-8 text-text">
      <h2 className="mb-1 type-heading-h1">Type ramp</h2>
      <p className="mb-8 type-body-small text-text-muted">
        One utility per design text style, plus two the design uses that the published ramp has no
        slot for. Each carries family, weight, size, line height and tracking, so a screen never
        needs a one off font size.
      </p>
      <div className="flex flex-col gap-6">
        {TYPE_RAMP.map((style) => (
          <div key={style.utility} className="border-b border-border pb-4">
            <div className="mb-2 type-mono-small text-text-tertiary">
              .{style.utility} <span className="text-text-placeholder">{style.note}</span>
            </div>
            <div className={style.utility}>{style.sample}</div>
          </div>
        ))}
      </div>
    </div>
  ),
};

const RADIUS = ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl'];
const SHADOW = ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'];
const SPACE = [1, 2, 3, 4, 5, 6, 7, 8];

/** Radius, spacing and elevation. These are single valued, they do not change per mode. */
export const Scales: Story = {
  render: () => (
    <div className="min-h-screen bg-bg p-8 text-text">
      <h2 className="mb-8 type-heading-h1">Scales</h2>

      <section className="mb-10">
        <h3 className="mb-3 type-label-overline text-text-muted">Radius</h3>
        <div className="flex flex-wrap gap-4">
          {RADIUS.map((utility) => (
            <div key={utility} className="flex flex-col items-center gap-2">
              <span className={`size-20 border border-border bg-brand-100 ${utility}`} />
              <span className="type-mono-small text-text-tertiary">{utility}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-2">
            <span className="size-20 rounded-full border border-border bg-brand-100" />
            <span className="type-mono-small text-text-tertiary">rounded-full</span>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h3 className="mb-3 type-label-overline text-text-muted">
          Spacing (Tailwind numeric scale, 4px step)
        </h3>
        <div className="flex flex-col gap-2">
          {SPACE.map((step) => (
            <div key={step} className="flex items-center gap-3">
              <span className="w-24 shrink-0 type-mono-small text-text-tertiary">space/{step}</span>
              <span className="h-4 bg-brand" style={{ width: `var(--space-${step})` }} />
              <span className="type-body-small text-text-muted">{step * 4}px</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 type-label-overline text-text-muted">Elevation</h3>
        <div className="flex flex-wrap gap-6">
          {SHADOW.map((utility) => (
            <div key={utility} className="flex flex-col items-center gap-2">
              <span className={`size-24 rounded-lg bg-surface ${utility}`} />
              <span className="type-mono-small text-text-tertiary">{utility}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};
