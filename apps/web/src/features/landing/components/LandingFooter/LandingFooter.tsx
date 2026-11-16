import { Container } from '@repo/ui/container';
import { navLink } from '../../landing.styles';
import { useLandingFooter } from './LandingFooter.hooks';

export default function LandingFooter() {
  const { links, copyright } = useLandingFooter();

  const items = links.map((link) => (
    <li key={link.href}>
      <a href={link.href} className={navLink}>
        {link.label}
      </a>
    </li>
  ));

  return (
    <footer className="border-t border-border bg-surface">
      <Container>
        <div className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-6 items-center justify-center rounded-md bg-brand type-label-caption text-brand-fg"
            >
              A
            </span>
            <span className="type-display-wordmark text-text">SaaS Starter</span>
            <span className="type-body-small text-text-tertiary">{copyright}</span>
          </div>

          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">{items}</ul>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
