import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import BrandPanel from './BrandPanel';

/**
 * The copy comes from the `auth` catalog, so the expectations read the English
 * catalog rather than repeating its sentences here.
 */
describe('BrandPanel', () => {
  it('renders the wordmark and the marketing headline', () => {
    render(<BrandPanel />);

    expect(screen.getByText('SaaS Starter')).toBeInTheDocument();
    expect(screen.getByText(en.brandPanel.headline)).toBeInTheDocument();
  });

  it('keeps the foot line audible and makes no customer-count claim', () => {
    render(<BrandPanel />);

    const trustCopy = screen.getByText(en.brandPanel.trustCopy);
    expect(trustCopy.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByText(/\d+\s/)).not.toBeInTheDocument();
  });

  it('hides the decorative product scene from assistive technology', () => {
    render(<BrandPanel />);

    // The cards are sample content, so the whole scene sits behind aria-hidden
    // rather than being announced as if it were the viewer's data.
    expect(
      screen.getByText(en.brandPanel.scene.summaryFirstValue).closest('[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(
      screen.getByText(en.brandPanel.scene.status).closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  });

  it('exposes no headings, so the form column owns the page h1', () => {
    render(<BrandPanel />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
