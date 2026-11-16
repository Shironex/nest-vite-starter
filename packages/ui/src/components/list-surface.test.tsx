import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ListSurface, ListSurfaceFooter } from './list-surface';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

function Rows() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Avery Nolan</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

const footer = <ListSurfaceFooter>Showing 1-1 of 1</ListSurfaceFooter>;

describe('ListSurface', () => {
  it('renders the table when ready', () => {
    render(
      <ListSurface>
        <Rows />
      </ListSurface>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  /*
   * The defect this component exists to kill: three surfaces left a bare column
   * header row visible above an empty message, so an empty board showed five
   * headings over nothing.
   */
  it.each([
    ['loading', 'Loading'],
    ['empty', 'No people'],
    ['error', 'Could not load'],
  ] as const)('replaces the table entirely while %s', (state, message) => {
    render(
      <ListSurface state={state} loading="Loading" empty="No people" error="Could not load">
        <Rows />
      </ListSurface>,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('announces the placeholder rather than leaving it silent', () => {
    render(
      <ListSurface state="loading" loading="Loading">
        <Rows />
      </ListSurface>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  /*
   * A consumer that forgets a slot should get the table, not a blank card: an
   * invisible list is a worse failure than an unstyled one.
   */
  it('falls back to the table when the state has no slot', () => {
    render(
      <ListSurface state="empty">
        <Rows />
      </ListSurface>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders the footer while ready', () => {
    render(
      <ListSurface footer={footer}>
        <Rows />
      </ListSurface>,
    );

    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument();
  });

  // A pager over a skeleton is a control that cannot be honored yet.
  it('hides the footer while not ready', () => {
    render(
      <ListSurface state="loading" loading="Loading" footer={footer}>
        <Rows />
      </ListSurface>,
    );

    expect(screen.queryByText('Showing 1-1 of 1')).not.toBeInTheDocument();
  });

  it('publishes its state for tests and E2E to target', () => {
    render(
      <ListSurface state="empty" empty="No people">
        <Rows />
      </ListSurface>,
    );

    expect(document.querySelector('[data-slot="list-surface"]')).toHaveAttribute(
      'data-state',
      'empty',
    );
  });
});

describe('Table primitives', () => {
  /*
   * The head treatment is the primitive's job. Two surfaces overriding it to
   * reach the design and ten inheriting something else is how one column
   * heading ended up with two sizes, two weights and two token families.
   */
  it('gives every column head the overline by default', () => {
    render(<Rows />);

    const head = screen.getByRole('columnheader');
    expect(head).toHaveClass('type-label-overline');
    expect(head).toHaveClass('text-text-muted');
  });
});
