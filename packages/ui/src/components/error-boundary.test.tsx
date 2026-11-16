import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@repo/ui/error-boundary';

/**
 * The boundary the three app shells wrap around `<Outlet/>`.
 *
 * Its fallback used to be hard-coded English and used to print `error.message`
 * as the description, so a render throw anywhere in a `<html lang="pl">`
 * product read "Something went wrong / Cannot read properties of undefined
 * (reading 'x') / Try again" to a non-technical user.
 */
function Boom(): never {
  throw new Error("Cannot read properties of undefined (reading 'x')");
}

// React logs the caught error; silence it so the suite output stays readable.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('ErrorBoundary', () => {
  it('renders the copy the app hands it', () => {
    render(
      <ErrorBoundary
        title="Something went wrong"
        description="An unexpected error occurred"
        retryLabel="Try again"
      >
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not print the raw error message by default', () => {
    render(
      <ErrorBoundary title="Something went wrong" description="An unexpected error occurred">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.queryByText(/Cannot read properties/u)).not.toBeInTheDocument();
  });

  it('prints it when the consumer explicitly asks (a DEV build)', () => {
    render(
      <ErrorBoundary title="Something went wrong" description="An error occurred" showErrorDetail>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Cannot read properties/u)).toBeInTheDocument();
  });

  it('keeps English defaults for a consumer that passes no copy', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>ok</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
