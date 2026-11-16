import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { ROLES } from '@repo/shared/permissions';
import { staffInviteSendSchema } from '@repo/shared/schemas';
import type { StaffInviteSendInput } from '@repo/shared/schemas';
import { trpc } from '@/lib/trpc';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { translateAppError } from '@/lib/trpc-errors';
import type { IInviteMemberDialogProps, IInviteMemberDialogView } from './InviteMemberDialog.types';

export function useInviteMemberDialog({
  onOpenChange,
}: IInviteMemberDialogProps): IInviteMemberDialogView {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [undeliveredEmail, setUndeliveredEmail] = useState<string | null>(null);

  const form = useForm<StaffInviteSendInput>({
    resolver: zodResolver(staffInviteSendSchema),
    mode: 'onBlur',
    // USER, not ADMIN. The default on a form that grants access should be the
    // narrower of the two, so making somebody an admin is always a deliberate
    // click rather than the path of least resistance.
    defaultValues: { email: '', role: ROLES.USER },
  });

  const { idempotencyKey, reset: resetIdempotencyKey } = useIdempotencyKey();

  const inviteMutation = useMutation({
    ...trpc.staffInvite.send.mutationOptions({ trpc: { context: { idempotencyKey } } }),
    onSuccess: (result, variables) => {
      resetIdempotencyKey();
      // Every cursor page carries a distinct query key, so invalidate the whole
      // listUsers family: the invitee appears as a new pending row.
      void queryClient.invalidateQueries(trpc.user.listUsers.pathFilter());
      if (result.emailSent) {
        toast.success(t('admin.inviteDialog.success', { email: variables.email }));
        form.reset();
        onOpenChange(false);
        return;
      }
      // Deliberately keeps the dialog OPEN. The account and the link exist but
      // nothing was sent, and the invitee has no way to ask for another, so a
      // toast that disappears is not enough to carry it.
      setUndeliveredEmail(variables.email);
    },
    onError: (error) => toast.error(translateAppError(error) ?? t('admin.inviteDialog.error')),
  });

  function onSubmit(data: StaffInviteSendInput) {
    setUndeliveredEmail(null);
    inviteMutation.mutate(data);
  }

  return { form, onSubmit, isPending: inviteMutation.isPending, undeliveredEmail };
}
