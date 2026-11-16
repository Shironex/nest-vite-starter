import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { AppErrorCode } from '@repo/shared/errors';
import type { Workspace } from '@repo/shared/schemas';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import { useCreateWorkspace, useUpdateWorkspace } from '../../Workspaces.mutations';
import { WORKSPACE_NS } from '../../Workspace.i18n';
import type {
  IWorkspaceFormDialogProps,
  IWorkspaceFormDialogView,
  IWorkspaceFormErrors,
  IWorkspaceFormFields,
} from './WorkspaceFormDialog.types';

/** Blank form state for a brand-new workspace. */
function emptyFields(): IWorkspaceFormFields {
  return {
    name: '',
    legalName: '',
    street: '',
    postalCode: '',
    city: '',
  };
}

/** An existing row as DOM-shaped strings; NULL columns become blanks. */
function fieldsFromWorkspace(workspace: Workspace): IWorkspaceFormFields {
  return {
    name: workspace.name,
    legalName: workspace.legalName ?? '',
    street: workspace.street ?? '',
    postalCode: workspace.postalCode ?? '',
    city: workspace.city ?? '',
  };
}

/**
 * The workspace create/edit dialog.
 *
 * The address fields are free-form; the wire schema bounds them on the server.
 *
 * `legalName` (the statutory registered name) is validated no more strictly
 * than any other free-form field; there is nothing to check a registered name
 * against. It stays optional, because an organization records clients before their
 * paperwork arrives.
 *
 * On edit, a blanked field sends an explicit `null` (clear the column) while
 * create simply omits it: the workspaceUpdateInput absent-vs-null convention.
 */
export function useWorkspaceFormDialog({
  open,
  onOpenChange,
  mode,
  workspace,
  onSaved,
}: IWorkspaceFormDialogProps): IWorkspaceFormDialogView {
  const { t } = useTranslation(WORKSPACE_NS);
  const [fields, setFields] = useState<IWorkspaceFormFields>(emptyFields);
  const [errors, setErrors] = useState<IWorkspaceFormErrors>({});
  // Re-seed when the dialog opens, or when it is pointed at a different
  // workspace, without an effect: rendering with a changed identity is the
  // signal, so the reset happens inline (the React "derive state" pattern).
  const [seededFor, setSeededFor] = useState<string | null>(null);

  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace();

  const seedKey = open ? `${mode}:${workspace?.id ?? 'new'}` : null;
  if (seedKey !== seededFor) {
    setSeededFor(seedKey);
    setErrors({});
    setFields(
      workspace === undefined || mode === 'create' ? emptyFields() : fieldsFromWorkspace(workspace),
    );
  }

  const isEdit = mode === 'edit';
  const isSubmitting = createWorkspace.isPending || updateWorkspace.isPending;

  function onFieldChange(field: keyof IWorkspaceFormFields, value: string) {
    setFields((previous) => ({ ...previous, [field]: value }));
  }

  function validate(): IWorkspaceFormErrors {
    const next: IWorkspaceFormErrors = {};
    if (fields.name.trim() === '') next.name = t('validation.required');
    return next;
  }

  /** ALREADY_EXISTS lands on the name field; anything else toasts. */
  function onServerError(error: unknown) {
    const code = getAppErrorCode(error);
    if (code === AppErrorCode.ALREADY_EXISTS) {
      setErrors({ name: t('duplicate') });
      return;
    }
    toast.error(translateAppError(error) ?? t('errors.unexpected', { ns: 'common' }));
  }

  function onSubmit() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const onSuccess = (saved: Workspace, message: string) => {
      toast.success(message);
      onOpenChange(false);
      onSaved?.(saved);
    };

    // The trimmed DOM values.
    const trimmed = {
      name: fields.name.trim(),
      legalName: fields.legalName.trim(),
      street: fields.street.trim(),
      postalCode: fields.postalCode.trim(),
      city: fields.city.trim(),
    };

    if (isEdit && workspace !== undefined) {
      updateWorkspace.mutate(
        {
          workspaceId: workspace.id,
          name: trimmed.name,
          // null CLEARS a column the user blanked; omitting it would silently
          // leave the old value in place.
          legalName: trimmed.legalName === '' ? null : trimmed.legalName,
          street: trimmed.street === '' ? null : trimmed.street,
          postalCode: trimmed.postalCode === '' ? null : trimmed.postalCode,
          city: trimmed.city === '' ? null : trimmed.city,
        },
        {
          onSuccess: (saved) => onSuccess(saved, t('updated')),
          onError: onServerError,
        },
      );
      return;
    }

    createWorkspace.mutate(
      {
        name: trimmed.name,
        ...(trimmed.legalName === '' ? {} : { legalName: trimmed.legalName }),
        ...(trimmed.street === '' ? {} : { street: trimmed.street }),
        ...(trimmed.postalCode === '' ? {} : { postalCode: trimmed.postalCode }),
        ...(trimmed.city === '' ? {} : { city: trimmed.city }),
      },
      {
        onSuccess: (saved) => onSuccess(saved, t('success')),
        onError: onServerError,
      },
    );
  }

  return {
    title: isEdit ? t('editTitle') : t('addTitle'),
    description: isEdit ? t('editHint') : t('emptyHint'),
    values: fields,
    errors,
    isSubmitting,
    isEdit,
    labels: {
      name: t('name'),
      legalName: t('legalName'),
      street: t('street'),
      postalCode: t('postalCode'),
      city: t('city'),
      registrationHint: t('registrationHint'),
      submit: isEdit ? t('submitEdit') : t('submit'),
      cancel: t('actions.cancel', { ns: 'common' }),
    },
    onFieldChange,
    onSubmit,
    onCancel: () => onOpenChange(false),
  };
}
