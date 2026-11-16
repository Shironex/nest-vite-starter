import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAUTH_ERROR_CODES } from '@/features/auth/Auth.constants';
import OAuthErrorAlert from './OAuthErrorAlert';
import { OAUTH_ERROR_MESSAGE_KEYS } from './OAuthErrorAlert.hooks';

const { routerSearch } = vi.hoisted(() => ({
  routerSearch: { current: {} as Record<string, unknown> },
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => routerSearch.current,
}));

beforeEach(() => {
  routerSearch.current = {};
});

afterEach(() => {
  cleanup();
});

describe('OAuthErrorAlert', () => {
  it.each(OAUTH_ERROR_CODES)('renders the alert banner for %s', (code) => {
    routerSearch.current = { error: code };
    render(<OAuthErrorAlert />);

    // Through FormError, so an OAuth failure reads exactly like a failed
    // password login rather than inventing a second error treatment.
    expect(screen.getByRole('alert')).toHaveClass('bg-danger-bg', 'text-danger-strong');
  });

  it('has a real English sentence for every code', () => {
    for (const code of OAUTH_ERROR_CODES) {
      routerSearch.current = { error: code };
      const { unmount } = render(<OAuthErrorAlert />);
      const text = screen.getByRole('alert').textContent ?? '';

      // A missing key makes i18next echo the key back, which would otherwise
      // sail through as a rendered string.
      expect(text).not.toBe(OAUTH_ERROR_MESSAGE_KEYS[code]);
      expect(text.length).toBeGreaterThan(20);
      unmount();
    }
  });

  it('tells the user the flow expired rather than that it failed', () => {
    routerSearch.current = { error: 'oauth_state_expired' };
    render(<OAuthErrorAlert />);

    // SPEC section 9 item 3 asks for "took too long, try again" specifically:
    // a one-time state blob simply aging out is not the same message as a
    // token exchange that was rejected.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'That took too long and expired. Please try again.',
    );
  });

  it.each([
    ['no error param at all', {}],
    ['an unknown code', { error: 'oauth_teapot' }],
    ['a non-string value', { error: 42 }],
  ])('renders nothing for %s', (_label, search) => {
    routerSearch.current = search;
    const { container } = render(<OAuthErrorAlert />);

    // Unknown codes are dropped by the route's validateSearch; this proves the
    // component is the second half of that guard and never echoes raw input.
    expect(container).toBeEmptyDOMElement();
  });
});
