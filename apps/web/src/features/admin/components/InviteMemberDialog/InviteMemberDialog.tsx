import { Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { Input } from '@repo/ui/input';
import { RadioGroup, RadioGroupItem } from '@repo/ui/radio-group';
import { ROLES } from '@repo/shared/permissions';
import { useInviteMemberDialog } from './InviteMemberDialog.hooks';
import type { IInviteMemberDialogProps } from './InviteMemberDialog.types';

export default function InviteMemberDialog(props: IInviteMemberDialogProps) {
  const { t } = useTranslation();
  const { form, onSubmit, isPending, undeliveredEmail } = useInviteMemberDialog(props);

  const undelivered =
    undeliveredEmail === null ? null : (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-md bg-warning-bg p-3 type-body-small text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        {t('admin.inviteDialog.undelivered', { email: undeliveredEmail })}
      </p>
    );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-slot="invite-member-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.inviteDialog.title')}</DialogTitle>
          <DialogDescription>{t('admin.inviteDialog.description')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{t('admin.inviteDialog.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      placeholder={t('admin.inviteDialog.emailPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  {/* Reserved row, so a validation message cannot move the
                      submit button between mousedown and mouseup. */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{t('admin.inviteDialog.roleLabel')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="gap-3"
                    >
                      <FormItem className="flex items-start gap-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value={ROLES.USER} id="invite-role-user" />
                        </FormControl>
                        <div className="space-y-1">
                          <FormLabel htmlFor="invite-role-user" className="font-normal">
                            {t('admin.roles.USER')}
                          </FormLabel>
                          <p className="type-body-small text-text-muted">
                            {t('admin.inviteDialog.roleUserHint')}
                          </p>
                        </div>
                      </FormItem>
                      <FormItem className="flex items-start gap-3 space-y-0">
                        <FormControl>
                          <RadioGroupItem value={ROLES.ADMIN} id="invite-role-admin" />
                        </FormControl>
                        <div className="space-y-1">
                          <FormLabel htmlFor="invite-role-admin" className="font-normal">
                            {t('admin.roles.ADMIN')}
                          </FormLabel>
                          <p className="type-body-small text-text-muted">
                            {t('admin.inviteDialog.roleAdminHint')}
                          </p>
                        </div>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {undelivered}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => props.onOpenChange(false)}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {t('admin.inviteDialog.confirm')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
