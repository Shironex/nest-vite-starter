import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Combobox } from './combobox';

const OPTIONS = [
  { value: 'f-1', label: 'Project one' },
  { value: 'f-2', label: 'Project two' },
];

function renderCombobox(props: Partial<React.ComponentProps<typeof Combobox>> = {}) {
  return render(
    <Combobox
      options={OPTIONS}
      value={null}
      onValueChange={() => undefined}
      placeholder="Choose a project"
      searchPlaceholder="Search projects"
      emptyText="No results"
      {...props}
    />,
  );
}

function trigger() {
  return screen.getByRole('combobox');
}

/**
 * The three attributes `FormControl`'s Slot injects. A component that
 * destructures only its own named props drops all of them, which is how a
 * required picker ended up announcing itself as valid while the form refused to
 * submit.
 */
describe('Combobox form contract', () => {
  it('carries an injected aria-invalid through to the trigger', () => {
    renderCombobox({ 'aria-invalid': true });

    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
  });

  it('still honors hasError for callers outside a form', () => {
    renderCombobox({ hasError: true });

    expect(trigger()).toHaveAttribute('aria-invalid', 'true');
  });

  it('is valid when neither source says otherwise', () => {
    renderCombobox();

    expect(trigger()).not.toHaveAttribute('aria-invalid');
  });

  it('joins an injected aria-describedby with a caller-supplied describedBy', () => {
    // One comes from FormControl and one from the caller; dropping either loses
    // half of what the field says about itself.
    renderCombobox({ 'aria-describedby': 'form-message', describedBy: 'hint' });

    expect(trigger()).toHaveAttribute('aria-describedby', 'form-message hint');
  });

  it('carries either id alone', () => {
    const { unmount } = renderCombobox({ describedBy: 'hint' });
    expect(trigger()).toHaveAttribute('aria-describedby', 'hint');
    unmount();

    renderCombobox({ 'aria-describedby': 'form-message' });
    expect(trigger()).toHaveAttribute('aria-describedby', 'form-message');
  });

  it('sets no aria-describedby when there is nothing to point at', () => {
    renderCombobox();

    expect(trigger()).not.toHaveAttribute('aria-describedby');
  });

  it('forwards unnamed props such as aria-required to the trigger', () => {
    renderCombobox({ 'aria-required': true, name: 'projectId' });

    expect(trigger()).toHaveAttribute('aria-required', 'true');
    expect(trigger()).toHaveAttribute('name', 'projectId');
  });

  /**
   * react-hook-form focuses the control it rejected. Without a ref it has
   * nothing to hold and a failed submit moves focus nowhere.
   */
  it('forwards a ref to the trigger so a rejected field can be focused', () => {
    const ref = React.createRef<HTMLButtonElement>();

    renderCombobox({ ref });

    expect(ref.current).toBe(trigger());
    ref.current?.focus();
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps its own attributes when a caller spreads a conflicting one', () => {
    renderCombobox({ id: 'project-picker' });

    expect(trigger()).toHaveAttribute('id', 'project-picker');
    expect(trigger()).toHaveAttribute('type', 'button');
  });
});
