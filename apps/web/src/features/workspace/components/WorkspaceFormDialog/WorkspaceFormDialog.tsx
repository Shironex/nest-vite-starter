import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Label } from '@repo/ui/label';
import '../../Workspace.i18n';
import { useWorkspaceFormDialog } from './WorkspaceFormDialog.hooks';
import type { IWorkspaceFormDialogProps, IWorkspaceFormFields } from './WorkspaceFormDialog.types';

interface IFieldRowProps {
  readonly field: keyof IWorkspaceFormFields;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  /** Standing explanatory copy. Announced with the input, unlike the error. */
  readonly hint?: string;
  readonly autoFocus?: boolean;
  readonly maxLength?: number;
  readonly onChange: (field: keyof IWorkspaceFormFields, value: string) => void;
}

/** One labeled input with its inline error, `workspace-<field>` id convention. */
function FieldRow(props: IFieldRowProps) {
  const id = `workspace-${props.field}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const hasError = props.error !== undefined;
  const hasHint = props.hint !== undefined;
  // The hint is permanent and the error transient, so both are named here and
  // in that order: a screen reader should hear what the field is for before
  // it hears what is wrong with it.
  const describedBy = [hasHint ? hintId : null, hasError ? errorId : null]
    .filter((value) => value !== null)
    .join(' ');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        value={props.value}
        autoFocus={props.autoFocus === true}
        maxLength={props.maxLength}
        aria-invalid={hasError}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => props.onChange(props.field, event.target.value)}
      />
      {hasHint && (
        <p id={hintId} className="type-body-small text-text-muted">
          {props.hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} role="alert" className="type-body-small text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

export default function WorkspaceFormDialog(props: IWorkspaceFormDialogProps) {
  const v = useWorkspaceFormDialog(props);
  const legalNameExtra = { maxLength: 300 };

  const row = (
    field: keyof IWorkspaceFormFields,
    extra: { autoFocus?: boolean; maxLength?: number; hint?: string } = {},
  ) => (
    <FieldRow
      field={field}
      label={v.labels[field]}
      value={v.values[field]}
      error={v.errors[field]}
      onChange={v.onFieldChange}
      {...extra}
    />
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="workspace-form-dialog">
        <DialogHeader>
          <DialogTitle>{v.title}</DialogTitle>
          <DialogDescription>{v.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {row('name', { autoFocus: true, maxLength: 200 })}

          <p className="type-body-small text-text-muted">{v.labels.registrationHint}</p>

          {row('legalName', legalNameExtra)}

          {row('street', { maxLength: 200 })}

          <div className="grid gap-4 sm:grid-cols-2">
            {row('postalCode', { maxLength: 12 })}
            {row('city', { maxLength: 100 })}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={v.onCancel}>
            {v.labels.cancel}
          </Button>
          <Button type="button" disabled={v.isSubmitting} onClick={v.onSubmit}>
            {v.labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
