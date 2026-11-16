import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OAuthButtons from './OAuthButtons';
import type { IOAuthButtonsView } from './OAuthButtons.types';

const { view } = vi.hoisted(() => ({
  view: { current: null as IOAuthButtonsView | null },
}));

// The discovery query, the Electron gate and the navigation all live in the
// hook and are proven in OAuthButtons.hooks.test.tsx; this file owns what the
// component draws for a given view.
vi.mock('./OAuthButtons.hooks', () => ({
  useOAuthButtons: () => view.current,
}));

const googleView = (onSelect = vi.fn()): IOAuthButtonsView => ({
  providers: [{ key: 'google', label: 'Continue with Google' }],
  dividerLabel: 'or',
  onSelect,
});

/**
 * WCAG 2.1 SC 1.4.3 on the two color pairs Google's branding guidelines make
 * normative for a custom button. `pnpm check:contrast` cannot cover them: it
 * measures design tokens parsed out of globals.css, and these are third-party
 * brand constants that deliberately are not tokens. Asserted here so the claim
 * in OAuthButtons.tsx is executable instead of a comment nobody rechecks.
 */
const contrastRatio = (fg: string, bg: string): number => {
  const channel = (hex: string, offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) =>
    0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe('OAuthButtons', () => {
  it('renders a Google button carrying the unaltered four-colour mark', () => {
    view.current = googleView();
    const { container } = render(<OAuthButtons />);

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
    // Google forbids monochrome or recolored versions of the "G", so assert all
    // four brand fills are present rather than just that an svg rendered.
    const fills = [...container.querySelectorAll('path')].map((path) => path.getAttribute('fill'));
    expect(fills).toEqual(['#EA4335', '#4285F4', '#FBBC05', '#34A853']);
  });

  it('renders nothing when the provider list is empty', () => {
    view.current = { providers: [], dividerLabel: 'or', onSelect: vi.fn() };
    const { container } = render(<OAuthButtons />);

    // Nothing at all, so an api with no OAuth configured shows no orphan divider.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('or')).not.toBeInTheDocument();
  });

  it('starts the flow for the clicked provider', () => {
    const onSelect = vi.fn();
    view.current = googleView(onSelect);
    render(<OAuthButtons />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(onSelect).toHaveBeenCalledWith('google');
  });

  it('does not submit the form it is embedded in', () => {
    view.current = googleView();
    render(<OAuthButtons />);

    // It sits inside <form> in both auth forms and navigates away rather than
    // submitting, so the default `type="submit"` would post the login form.
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it("keeps Google's normative color pairs above WCAG AA in both modes", () => {
    expect(contrastRatio('#1f1f1f', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#e3e3e3', '#131314')).toBeGreaterThanOrEqual(4.5);
    // The hover fills too, both themselves Google-published values.
    expect(contrastRatio('#1f1f1f', '#f2f2f2')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#e3e3e3', '#1f1f1f')).toBeGreaterThanOrEqual(4.5);
  });
});
