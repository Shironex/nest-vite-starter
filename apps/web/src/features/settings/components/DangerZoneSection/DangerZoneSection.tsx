import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@repo/ui/alert-dialog';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { Input } from '@repo/ui/input';
import { useDangerZoneSection } from './DangerZoneSection.hooks';
import { settingsStrings } from '@/features/settings/Settings.strings';
import { commonStrings } from '@/lib/strings';

export default function DangerZoneSection() {
  const { form, onSubmit, isPending, isDialogOpen, onDialogOpenChange } = useDangerZoneSection();

  return (
    <Card className="border-destructive/50" data-slot="danger-zone-section">
      <CardHeader>
        <CardTitle className="text-destructive">{settingsStrings.dangerZone.title}</CardTitle>
        <CardDescription>{settingsStrings.dangerZone.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={isDialogOpen} onOpenChange={onDialogOpenChange}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">{settingsStrings.dangerZone.cta}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{settingsStrings.dangerZone.dialogTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {settingsStrings.dangerZone.dialogDescription}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem required>
                      <FormLabel>{settingsStrings.dangerZone.passwordLabel}</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          placeholder={settingsStrings.dangerZone.passwordPlaceholder}
                          {...field}
                        />
                      </FormControl>
                      {/*
                        Reserved row. `mode: 'onBlur'` renders "Password is
                        required" when this field loses focus, which is what
                        pressing Cancel does; an unreserved row would push the
                        footer down between mousedown and mouseup and the press
                        would land on the form. Pinned in e2e/form-reflow.spec.ts.
                      */}
                      <div className="min-h-5">
                        <FormMessage />
                      </div>
                    </FormItem>
                  )}
                />
                <AlertDialogFooter>
                  {/* Explicit type="button": inside a form the browser default
                      is "submit", which would fire the deletion on Cancel. */}
                  <AlertDialogCancel type="button" disabled={isPending}>
                    {commonStrings.actions.cancel}
                  </AlertDialogCancel>
                  <Button type="submit" variant="destructive" disabled={isPending}>
                    {isPending && <Loader2 className="animate-spin" />}
                    {settingsStrings.dangerZone.confirm}
                  </Button>
                </AlertDialogFooter>
              </form>
            </Form>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
