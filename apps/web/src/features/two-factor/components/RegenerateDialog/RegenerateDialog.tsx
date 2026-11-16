import { Loader2 } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { RecoveryCodesPanel } from '../RecoveryCodesPanel';
import { useRegenerateDialog } from './RegenerateDialog.hooks';
import type { IRegenerateDialogProps } from './RegenerateDialog.types';
import { twoFactorStrings } from '@/features/two-factor/TwoFactor.strings';
import { commonStrings } from '@/lib/strings';

export default function RegenerateDialog(props: IRegenerateDialogProps) {
  const { form, onSubmit, isPending, codes, onDone } = useRegenerateDialog(props);
  const description = codes
    ? twoFactorStrings.regenerate.descriptionCodes
    : twoFactorStrings.regenerate.descriptionForm;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{twoFactorStrings.regenerate.title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {codes ? (
          <div className="space-y-4">
            <RecoveryCodesPanel codes={codes} />
            <DialogFooter>
              <Button type="button" onClick={onDone}>
                {twoFactorStrings.regenerate.done}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem required>
                    <FormLabel>{twoFactorStrings.regenerate.passwordLabel}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        placeholder={twoFactorStrings.regenerate.passwordPlaceholder}
                        {...field}
                      />
                    </FormControl>
                    {/*
                      Reserved row. `mode: 'onBlur'` renders "Password is
                      required" when this field loses focus, which is what
                      pressing Cancel or Regenerate does; an unreserved row
                      would push both footer buttons down between mousedown and
                      mouseup and the press would land on the form instead.
                    */}
                    <div className="min-h-5">
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => props.onOpenChange(false)}
                >
                  {commonStrings.actions.cancel}
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending && <Loader2 className="animate-spin" />}
                  {twoFactorStrings.regenerate.confirm}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
