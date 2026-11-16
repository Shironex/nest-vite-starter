import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Route } from './audit';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate }),
}));

const { ensureQueryData } = vi.hoisted(() => ({ ensureQueryData: vi.fn() }));

vi.mock('@/features/audit/components/AuditLogPage', () => ({
  AuditLogPage: () => <div data-testid="audit-log-page" />,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { user: { me: { queryOptions: () => ({ queryKey: ['user', 'me'] }) } } },
}));

const beforeLoad = () => Route.options.beforeLoad as (opts: unknown) => Promise<void>;
const context = { queryClient: { ensureQueryData } };

describe('/_authenticated/audit route', () => {
  it('mounts the audit screen', () => {
    const Component = Route.options.component as () => React.ReactElement;
    render(<Component />);
    expect(screen.getByTestId('audit-log-page')).toBeInTheDocument();
  });

  it('lets an ADMIN through', async () => {
    ensureQueryData.mockResolvedValue({ role: 'ADMIN' });
    await expect(beforeLoad()({ context })).resolves.toBeUndefined();
  });

  it('bounces a USER to the dashboard instead of a 403 screen', async () => {
    ensureQueryData.mockResolvedValue({ role: 'USER' });

    // The guard throws TanStack's redirect, which is a Response carrying the
    // target on `options`. The server is still the real control here: the
    // audit.list procedure carries AdminMiddleware.
    const thrown = await beforeLoad()({ context }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).not.toBeNull();
    expect((thrown as { options?: { to?: string } }).options?.to).toBe('/dashboard');
  });

  it('renders a skeleton rather than a blank frame while loading', () => {
    const Pending = Route.options.pendingComponent as () => React.ReactElement;
    const { container } = render(<Pending />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('announces a load failure and offers a retry', () => {
    const ErrorComponent = Route.options.errorComponent as (props: {
      reset: () => void;
    }) => React.ReactElement;
    const reset = vi.fn();
    render(<ErrorComponent reset={reset} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the audit log');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // reset alone leaves the match in status 'error', so it rethrows on the
    // next render and the button visibly does nothing for any load-phase
    // failure. The invalidate is what makes the retry real.
    expect(reset).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
