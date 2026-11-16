import { Link } from '@tanstack/react-router';
import { Container } from '@repo/ui/container';
import { cn } from '@repo/ui/lib/utils';
import { ctaPrimary, ctaSecondary } from '../../landing.styles';
import { useLandingHero } from './LandingHero.hooks';
import type { IHeroMockRow } from './LandingHero.types';

function MockRow({ row }: { row: IHeroMockRow }) {
  const rowClassName = cn(
    'flex items-center gap-3 border-b border-border py-2.5 last:border-b-0',
    row.desktopOnly && 'hidden sm:flex',
  );
  // Geometry only. The plate and its ink both come from the row, because a tone
  // tint and the ink that clears AA on it are one decision, not two: pinning a
  // single `text-*` here is what let white sit on four solid fills at 1.84:1 in
  // Dark.
  const avatarClassName = cn(
    'flex size-8 shrink-0 items-center justify-center rounded-full type-label-caption',
    row.avatarClassName,
  );

  return (
    <div className={rowClassName}>
      <span className={avatarClassName}>{row.initials}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate type-body-small text-text">{row.name}</span>
        <span className="block truncate type-label-caption text-text-tertiary">{row.role}</span>
      </span>
      <span className="shrink-0 rounded-full bg-success-bg px-2.5 py-0.5 type-label-caption text-success">
        Active
      </span>
    </div>
  );
}

export default function LandingHero() {
  const { rows } = useLandingHero();

  const mockRows = rows.map((row) => <MockRow key={row.initials} row={row} />);

  return (
    <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-bg to-surface">
      <Container>
        <div className="grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 type-label-caption text-brand-ink">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />A starting point
              for your SaaS
            </p>

            <h1 className="mt-5 type-display-large text-text sm:type-display-hero">
              Ship the product.
              <br />
              Skip the <span className="text-brand-ink">plumbing.</span>
            </h1>

            <p className="mt-5 max-w-md type-body-regular text-text-secondary">
              Accounts, two-factor sign-in, organizations, an audit log and a typed API are already
              in place, so you can start on the part only you can build.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/auth/register" className={ctaPrimary}>
                Create an account
              </Link>
              <a href="#features" className={ctaSecondary}>
                See features
              </a>
            </div>
          </div>

          {/*
            Product illustration, not content: the rows are sample data, so they
            are hidden from assistive tech rather than announced as real records.
          */}
          <div aria-hidden="true" className="relative">
            <div className="pointer-events-none absolute -top-16 right-0 size-72 rounded-full bg-brand/10 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
              <div className="flex items-center gap-2 border-b border-border bg-bg px-4 py-3">
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="size-2.5 rounded-full bg-border-strong" />
                <span className="flex-1 text-center type-mono-small text-text-tertiary">
                  app.example.com
                </span>
                <span className="w-11" />
              </div>

              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between pb-2">
                  <span className="type-display-wordmark text-text">Teams</span>
                  <span className="rounded-lg bg-brand px-2.5 py-1 type-label-caption text-brand-fg">
                    + New
                  </span>
                </div>
                {mockRows}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
