import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { i18n, registerFeatureNamespace } from './index';

/**
 * `react: { bindI18nStore: 'added' }` in the bootstrap.
 *
 * Route chunks are lazy, so a feature namespace can register AFTER a component
 * that reads it is already on screen. Without the binding that component keeps
 * rendering raw keys until something else re-renders it; with it, adding the
 * bundle is itself a re-render. A second language arriving through a dynamic
 * import would lean on the same binding.
 */
describe('registerFeatureNamespace', () => {
  it('re-renders a mounted component when its namespace registers after mount', () => {
    function Greeting() {
      const { t } = useTranslation('late-greeting', { i18n });
      return <p>{t('greeting')}</p>;
    }
    render(<Greeting />);
    expect(screen.getByText('greeting')).toBeInTheDocument();

    act(() => {
      registerFeatureNamespace('late-greeting', { en: { greeting: 'from the late catalog' } });
    });

    expect(screen.getByText('from the late catalog')).toBeInTheDocument();
  });
});
