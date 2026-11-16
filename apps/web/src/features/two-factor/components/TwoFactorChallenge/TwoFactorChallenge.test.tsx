import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import TwoFactorChallenge from './TwoFactorChallenge';

// The hook reads route search and navigates; stub the router so the form renders
// without a RouterProvider.
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({}) }),
  useNavigate: () => vi.fn(),
}));

// Stub the tRPC proxy so useMutation gets a plain mutationFn (no network).
vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { verifyTwoFactor: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
    user: { me: { queryOptions: () => ({ queryKey: ['user.me'] }) } },
  },
  resetCsrfToken: vi.fn(),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('TwoFactorChallenge', () => {
  it('renders the authentication-code field and verify button', () => {
    renderWithClient(<TwoFactorChallenge />);
    expect(screen.getByLabelText('Code from the app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByLabelText('Remember this browser for 30 days')).toBeInTheDocument();
  });

  it('toggles to the backup-code variant', () => {
    renderWithClient(<TwoFactorChallenge />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
  });

  it('drops the previous mode validation message when toggling', async () => {
    renderWithClient(<TwoFactorChallenge />);

    // `mode: 'onBlur'` renders "Code is required" for the empty TOTP field. That
    // message is what reflowed the toggle out from under the cursor, and it is
    // meaningless once the field is asking for a backup code.
    fireEvent.blur(screen.getByLabelText('Code from the app'));
    expect(await screen.findByText('Code is required')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));

    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    expect(screen.queryByText('Code is required')).not.toBeInTheDocument();
  });

  /*
   * The six boxes in the design are a decoration painted behind ONE real input,
   * not six inputs. These pin the properties that choice exists to protect;
   * a naive six-input build breaks every one of them.
   */
  describe('the segmented code field', () => {
    it('is a single labeled input, not six anonymous boxes', () => {
      renderWithClient(<TwoFactorChallenge />);

      // One textbox in the whole form: a screen reader hears one field.
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByLabelText('Code from the app').tagName).toBe('INPUT');
    });

    it('carries the attributes SMS and authenticator autofill rely on', () => {
      renderWithClient(<TwoFactorChallenge />);

      const input = screen.getByLabelText('Code from the app');
      expect(input).toHaveAttribute('autocomplete', 'one-time-code');
      expect(input).toHaveAttribute('inputmode', 'numeric');
    });

    it('fills every segment when a whole code arrives at once', () => {
      renderWithClient(<TwoFactorChallenge />);

      // One change event carrying all six characters is what a paste and an
      // autofill both look like; per-keystroke handling would drop five of them.
      fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '482913' } });

      expect(screen.getByLabelText('Code from the app')).toHaveValue('482913');
      for (const character of ['4', '8', '2', '9', '1', '3']) {
        expect(screen.getByText(character)).toBeInTheDocument();
      }
    });

    it('hides the decorative strip from assistive technology', () => {
      renderWithClient(<TwoFactorChallenge />);
      fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '4' } });

      // The painted character is inside the aria-hidden strip, so it is never
      // announced a second time alongside the input's own value.
      expect(screen.getByText('4').closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('drops the strip in backup-code mode, where codes are not six digits', () => {
      renderWithClient(<TwoFactorChallenge />);
      fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));

      const input = screen.getByLabelText('Recovery code');
      expect(input).toHaveAttribute('inputmode', 'text');
      expect(input).toHaveAttribute('placeholder', 'XXXX-XXXX-XXXX-XXXX');
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
    });
  });
});
