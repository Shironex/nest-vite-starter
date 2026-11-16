import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@repo/ui/dialog';
import { Spinner } from '@repo/ui/spinner';
import { UiLabelsProvider } from '@repo/ui/ui-labels';

/**
 * The one place this package reads copy from a context rather than a prop.
 *
 * `DialogContent` renders its close button at 23 call sites in the app and the
 * mobile sidebar renders three strings from inside `Sidebar`, which no caller
 * passes through, so as props these would be the same literal in two dozen
 * files. The failure they guard is a screen-reader name on the most-used
 * controls that bypasses the app's catalog and drifts from the rest of the copy.
 */
function openDialog(labels?: Record<string, string>) {
  return render(
    <UiLabelsProvider labels={labels}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Tytul</DialogTitle>
          <DialogDescription>Opis</DialogDescription>
        </DialogContent>
      </Dialog>
    </UiLabelsProvider>,
  );
}

describe('UiLabelsProvider', () => {
  it('names the dialog close button from the provider', () => {
    openDialog({ close: 'Close' });
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('names a captionless spinner from the provider', () => {
    render(
      <UiLabelsProvider labels={{ loading: 'Loading...' }}>
        <Spinner />
      </UiLabelsProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('merges a partial override over the defaults rather than replacing them', () => {
    render(
      <UiLabelsProvider labels={{ close: 'Close' }}>
        <Spinner />
      </UiLabelsProvider>,
    );
    // `loading` was not overridden, so the English default still names it.
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  // A consumer with no catalog (a test, a story, apps/docs) must still get a
  // name rather than an unnamed control.
  it('falls back to the English defaults with no provider mounted', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
