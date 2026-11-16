import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useForm, FormProvider } from 'react-hook-form';
import TurnstileField from './TurnstileField';

function Harness() {
  const form = useForm<{ turnstileToken: string }>();
  return (
    <FormProvider {...form}>
      <TurnstileField form={form} />
    </FormProvider>
  );
}

describe('TurnstileField', () => {
  it('renders without crashing', () => {
    const { container } = render(<Harness />);
    expect(container.firstChild).not.toBeNull();
  });
});
