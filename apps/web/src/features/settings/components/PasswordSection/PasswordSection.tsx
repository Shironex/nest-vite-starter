import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { Input } from '@repo/ui/input';
import { PasswordStrength } from '@/features/shared/components/PasswordStrength';
import { usePasswordSection } from './PasswordSection.hooks';

export default function PasswordSection() {
  const { t } = useTranslation();
  const { form, onSubmit, isPending, newPassword } = usePasswordSection();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.password.title')}</CardTitle>
        <CardDescription>{t('settings.password.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{t('settings.password.currentLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t('settings.password.currentPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  {/*
                    Reserved row. `mode: 'onBlur'` renders "Current password is
                    required" when this field loses focus, which is what
                    pressing Change Password does; an unreserved row would push
                    the button down between mousedown and mouseup and the press
                    would land on the form. Pinned in e2e/form-reflow.spec.ts.
                  */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{t('settings.password.newLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t('settings.password.newPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  {/* Reserved row, same reason as the current-password field above. */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                  <PasswordStrength password={newPassword} />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="animate-spin" />}
              {t('settings.password.submit')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
