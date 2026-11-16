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
import { useDisableDialog } from './DisableDialog.hooks';
import type { IDisableDialogProps } from './DisableDialog.types';
import { twoFactorStrings } from '@/features/two-factor/TwoFactor.strings';
import { commonStrings } from '@/lib/strings';

/**
 * The disable confirmation, built to the design's modal: title, the three consequences, and
 * a Secondary plus Danger footer.
 *
 * THE CREDENTIAL FIELDS ARE NOT IN THE MOCKUP AND STAY ANYWAY. The design draws
 * a plain confirm with nothing to fill in. Turning off the second factor is a
 * step-up action; the procedure behind it requires a password and a current
 * code, and dropping the fields to match the drawing would either break the
 * call or push the re-authentication somewhere less obvious. Only the chrome
 * and the copy follow the design.
 */
export default function DisableDialog(props: IDisableDialogProps) {
  const { form, onSubmit, isPending } = useDisableDialog(props);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{twoFactorStrings.disable.title}</DialogTitle>
          <DialogDescription>{twoFactorStrings.disable.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{twoFactorStrings.disable.passwordLabel}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      placeholder={twoFactorStrings.disable.passwordPlaceholder}
                      {...field}
                    />
                  </FormControl>
                  {/*
                    Reserved row. `mode: 'onBlur'` renders "Password is
                    required" when this field loses focus, which is what
                    pressing Cancel or Disable does; an unreserved row would
                    push both footer buttons down between mousedown and mouseup
                    and the press would land on the form instead.
                  */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{twoFactorStrings.disable.codeLabel}</FormLabel>
                  <FormControl>
                    <Input autoComplete="one-time-code" placeholder="123456" {...field} />
                  </FormControl>
                  {/* Reserved row, same reason as the password field above. */}
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
              <Button type="submit" variant="destructive" disabled={isPending}>
                {isPending && <Loader2 className="animate-spin" />}
                {twoFactorStrings.disable.confirm}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
