import type { Workspace } from '@repo/shared/schemas';

export type WorkspaceFormMode = 'create' | 'edit';

export interface IWorkspaceFormDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: WorkspaceFormMode;
  /** The row being edited. Ignored (and optional) when mode is 'create'. */
  readonly workspace?: Workspace | undefined;
  /** Called with the saved row after a successful create or update. */
  readonly onSaved?: (workspace: Workspace) => void;
}

/** DOM-shaped form state: every field a string, blank meaning "not given". */
export interface IWorkspaceFormFields {
  readonly name: string;
  readonly legalName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

export type IWorkspaceFormErrors = Partial<Record<keyof IWorkspaceFormFields, string>>;

export interface IWorkspaceFormDialogView {
  readonly title: string;
  readonly description: string;
  readonly values: IWorkspaceFormFields;
  readonly errors: IWorkspaceFormErrors;
  readonly isSubmitting: boolean;
  readonly isEdit: boolean;
  readonly labels: IWorkspaceFormLabels;
  readonly onFieldChange: (field: keyof IWorkspaceFormFields, value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/** Translated copy, resolved in the hook so the shell stays free of `t()`. */
export interface IWorkspaceFormLabels {
  readonly name: string;
  readonly legalName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly registrationHint: string;
  readonly submit: string;
  readonly cancel: string;
}
