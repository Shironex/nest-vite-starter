import { forwardRef } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Combobox } from '@repo/ui/combobox';
import { Label } from '@repo/ui/label';
import { WorkspaceFormDialog } from '../WorkspaceFormDialog';
import { useWorkspaceSelect } from './WorkspaceSelect.hooks';
import type { IWorkspaceSelectProps } from './WorkspaceSelect.types';

/**
 * A `Combobox` rather than a `Select`: an organization's client list is unbounded by
 * construction, and this one picker sits on several list screens, so it is
 * the most-used unsearchable dropdown in the product. Client-side filtering is enough: the whole list is already in
 * memory from `workspaces.list`, so there is nothing for a server round trip to add.
 *
 * "Every workspace" is the ABSENCE of a value rather than a sentinel: `Combobox`
 * models that with `clearLabel`, so the `__all__` string a Radix `Select`
 * needed (it rejects an empty item value) has no reason to exist here.
 *
 * IT IS A FORM CONTROL, so it forwards a ref to the trigger and passes the
 * `aria-invalid` / `aria-describedby` a `FormControl` Slot injects straight
 * through to `Combobox`. Without the ref react-hook-form cannot focus the field
 * it rejected; without the aria props the error message beside it is rendered
 * and never associated.
 *
 * `hasError` reaches the control itself. `Combobox` now takes `hasError` and
 * renders `aria-invalid`, so the programmatic invalid state a `SelectTrigger`
 * used to carry survived the swap: a screen reader is told by the CONTROL, not
 * only by the message a sighted user reads beside it. The border comes from
 * `Button`'s own `aria-invalid:` styling, so there is no class to hand-roll.
 */
const WorkspaceSelect = forwardRef<HTMLButtonElement, IWorkspaceSelectProps>(
  function WorkspaceSelect(props, ref) {
    const v = useWorkspaceSelect(props);

    const options = v.workspaces.map((workspace) => ({
      value: workspace.id,
      label: workspace.name,
    }));

    const isDisabled = props.disabled === true || v.isLoading;
    const canCreate = props.allowCreate === true;
    const canEdit = canCreate && v.selectedWorkspace !== undefined;
    const showEmptyHint = v.isEmpty && canCreate;

    return (
      <div data-slot="workspace-select" className="space-y-2">
        {props.showLabel !== false && <Label htmlFor={v.fieldId}>{v.labels.select}</Label>}

        <div className="flex items-center gap-2">
          <Combobox
            ref={ref}
            id={v.fieldId}
            hasError={props.hasError === true}
            aria-required={props.required === true || undefined}
            describedBy={props.describedBy}
            aria-describedby={props['aria-describedby']}
            aria-invalid={props['aria-invalid']}
            options={options}
            value={props.value === '' ? null : props.value}
            onValueChange={(next) => props.onChange(next ?? '')}
            placeholder={v.labels.placeholder}
            searchPlaceholder={v.labels.search}
            emptyText={v.labels.noMatch}
            {...(props.allowEmpty === true ? { clearLabel: v.labels.all } : {})}
            isLoading={v.isLoading}
            loadingText={v.labels.loading}
            disabled={isDisabled}
          />

          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={v.labels.edit}
              onClick={v.onOpenEdit}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          )}

          {canCreate && (
            <Button type="button" variant="outline" size="sm" onClick={v.onOpenCreate}>
              <Plus className="size-4" aria-hidden="true" />
              <span>{v.labels.add}</span>
            </Button>
          )}
        </div>

        {/*
        `role="alert"` because a disabled picker with no explanation is what a
        screen-reader user is otherwise left with, and every other load error in
        the app announces itself. The retry is the only way back: the query
        cache toasts a failed refetch and says nothing about a failed first load.
      */}
        {v.hasError && (
          <div role="alert" className="space-y-2">
            <p className="type-body-small text-danger">{v.labels.loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={v.onRetry}>
              {v.labels.retry}
            </Button>
          </div>
        )}

        {showEmptyHint && <p className="type-body-small text-text-muted">{v.labels.emptyHint}</p>}

        {v.dialogMode !== null && (
          <WorkspaceFormDialog
            open
            mode={v.dialogMode}
            workspace={v.dialogMode === 'edit' ? v.selectedWorkspace : undefined}
            onOpenChange={v.onDialogOpenChange}
            onSaved={v.onSaved}
          />
        )}
      </div>
    );
  },
);

export default WorkspaceSelect;
