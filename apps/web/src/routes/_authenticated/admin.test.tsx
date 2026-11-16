import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Route } from './admin';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate }),
}));

const { ensureQueryData } = vi.hoisted(() => ({ ensureQueryData: vi.fn() }));

vi.mock('@/features/admin/components/UsersSection', () => ({
  UsersSection: () => <div data-testid="users-section" />,
}));

vi.mock('@/features/admin/components/AuditLogSection', () => ({
  AuditLogSection: () => <div data-testid="audit-log-section" />,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { user: { me: { queryOptions: () => ({ queryKey: ['user', 'me'] }) } } },
}));

const beforeLoad = () => Route.options.beforeLoad as (opts: unknown) => Promise<void>;
const context = { queryClient: { ensureQueryData } };

describe('/_authenticated/admin route', () => {
  it('mounts the users table and the audit list', () => {
    const Component = Route.options.component as () => React.ReactElement;
    render(<Component />);

    expect(screen.getByTestId('users-section')).toBeInTheDocument();
    expect(screen.getByTestId('audit-log-section')).toBeInTheDocument();
  });

  it('lets an ADMIN through', async () => {
    ensureQueryData.mockResolvedValue({ role: 'ADMIN' });
    await expect(beforeLoad()({ context })).resolves.toBeUndefined();
  });

  it('bounces a USER to the dashboard instead of a 403 screen', async () => {
    ensureQueryData.mockResolvedValue({ role: 'USER' });

    // The guard throws TanStack's redirect, which is a Response carrying the
    // target on `options`. The server is still the real control: every admin
    // procedure carries AdminMiddleware.
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

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the admin page');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
