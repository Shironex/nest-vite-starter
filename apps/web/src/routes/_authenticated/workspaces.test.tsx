import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Route } from './workspaces';
// Side effect: registers the feature catalog the route's errorComponent reads.
// In the browser it arrives with the screen component the route's split chunk
// imports; this suite MOCKS that component away, so the registration has to be
// stated here instead of silently rendering bare keys.

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate }),
}));

vi.mock('@/features/workspace/components/WorkspaceListPage', () => ({
  WorkspaceListPage: () => <div data-testid="workspace-list-page" />,
}));

describe('/_authenticated/workspaces route', () => {
  it('mounts the Workspaces screen', () => {
    const Component = Route.options.component as () => React.ReactElement;
    render(<Component />);
    expect(screen.getByTestId('workspace-list-page')).toBeInTheDocument();
  });

  // workspaces.list is open to every staff account; only the writes are ADMIN-only,
  // and the screen hides those itself. A role redirect here would lock a USER
  // out of a list the server lets them read.
  it('carries no role guard', () => {
    expect(Route.options.beforeLoad).toBeUndefined();
  });

  it('titles the document with its own page title', () => {
    const head = Route.options.head as () => { meta: { title: string }[] };
    expect(head().meta[0]?.title).toContain('Workspaces');
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

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the workspaces');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // reset alone leaves the match in status 'error', so it rethrows on the
    // next render and the button visibly does nothing. The invalidate is what
    // makes the retry real.
    expect(reset).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });
});
