import { Check, ShieldCheck } from 'lucide-react';
import { APP_NAME } from '@/lib/env';
import { useBrandPanel } from './BrandPanel.hooks';
import { authStrings } from '@/features/auth/Auth.strings';

/**
 * The gradient brand column shared by every auth screen. Hidden below `lg`
 * because it only ever sits beside the 720px form column.
 *
 * Everything above the headline is a decorative illustration of the product, so
 * `ProductScene` is `aria-hidden`: its cards are sample content, not the
 * viewer's data. The foot line below the headline stays exposed, since that
 * sentence is a real claim about the product.
 */
export default function BrandPanel() {
  const { headline, subheadline, trustCopy } = useBrandPanel();

  // The gradient stays on the fill token, not the ink one: it is a plate that
  // carries white text, which is the fill role by definition. When the Dark fill
  // darkened to clear AA the ramp stayed just as visible, going from a 1.322 to a
  // 1.370 luminance ratio end to end, and it now runs dark-to-darker in both
  // modes instead of inverting between them. White on the far end improved from
  // 3.51:1 to 6.36:1.
  //
  // The subheadline and trust line are full-opacity white, not the `text-white/75`
  // they shipped with, and softening them again is not available: Dark `brand` has a
  // luminance of 0.176, so its ceiling against any ink at all is 4.64:1, and clearing
  // 4.5:1 needs an ink luminance of 0.968, which is alpha 0.985 or higher. `/75`
  // measured 3.33:1 at the light end of the Dark ramp and `/85` only 3.82:1. Their
  // secondary status is carried by the type ramp instead: a 44px/700 Bricolage hero
  // against 14px and 13px Instrument body. Only the `aria-hidden` decoration below
  // still uses an alpha.
  return (
    <aside className="relative hidden w-120 shrink-0 flex-col justify-between overflow-hidden bg-linear-to-br from-brand to-brand-hover p-11 lg:flex">
      {/* Soft radial glow bottom-right, matching the ellipse in the design's panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -bottom-24 size-105 rounded-full bg-white/10 blur-3xl"
      />

      <div className="relative flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-white/20 type-display-wordmark text-white">
          {APP_NAME.charAt(0)}
        </span>
        <span className="type-display-wordmark text-white">{APP_NAME}</span>
      </div>

      <div className="relative">
        <ProductScene />

        <p className="mt-14 type-display-hero text-balance text-white">{headline}</p>
        <p className="mt-5 type-body-regular text-white">{subheadline}</p>
      </div>

      <div className="relative flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-white/20"
        >
          <ShieldCheck className="size-4 text-white" />
        </span>
        <p className="type-body-small text-white">{trustCopy}</p>
      </div>
    </aside>
  );
}

/**
 * The floating sample cards and the dashed connector between them. Purely
 * decorative, so it is hidden from assistive tech and carries no interactive
 * affordances.
 */
function ProductScene() {
  return (
    <div aria-hidden="true" className="relative h-50 w-full">
      <svg
        className="absolute inset-0 size-full text-white/40"
        viewBox="0 0 360 200"
        fill="none"
        preserveAspectRatio="none"
      >
        <path
          d="M56 158 L172 58 L306 118"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />
        <circle cx="52" cy="158" r="4" fill="currentColor" />
        <circle cx="172" cy="58" r="4" fill="currentColor" />
        <circle cx="306" cy="118" r="4" fill="currentColor" />
      </svg>

      <div className="absolute top-0 left-30 w-38 rounded-xl bg-surface p-3 shadow-lg">
        <p className="type-label-overline text-text-tertiary">
          {authStrings.brandPanel.scene.summaryTitle}
        </p>
        <dl className="mt-3 space-y-1">
          <div className="flex justify-between">
            <dt className="type-body-small text-text-muted">
              {authStrings.brandPanel.scene.summaryFirstLabel}
            </dt>
            <dd className="type-mono-small text-text">
              {authStrings.brandPanel.scene.summaryFirstValue}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="type-body-small text-text-muted">
              {authStrings.brandPanel.scene.summarySecondLabel}
            </dt>
            <dd className="type-mono-small font-medium text-text">
              {authStrings.brandPanel.scene.summarySecondValue}
            </dd>
          </div>
        </dl>
      </div>

      <div className="absolute top-24 left-0 w-38 rounded-xl bg-surface p-3 shadow-lg">
        <p className="type-label-overline text-text-tertiary">
          {authStrings.brandPanel.scene.personTitle}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-brand-100 type-label-overline text-brand-ink-hover">
            {authStrings.brandPanel.scene.personInitials}
          </span>
          <p className="type-body-small text-text">{authStrings.brandPanel.scene.personName}</p>
        </div>
        <div className="mt-3 h-1 rounded-full bg-subtle">
          <div className="h-1 w-8/12 rounded-full bg-brand" />
        </div>
      </div>

      <div className="absolute top-32 right-0 flex items-center gap-2 rounded-full bg-surface px-3 py-2 shadow-lg">
        <span className="flex size-4 items-center justify-center rounded-full bg-success">
          <Check className="size-2.5 text-white" strokeWidth={3} />
        </span>
        <p className="type-body-small text-text">{authStrings.brandPanel.scene.status}</p>
      </div>
    </div>
  );
}
