import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoginForm } from './LoginForm.hooks';

/**
 * Where a successful sign-in lands: the app home, unless the visitor arrived
 * with an explicit redirect, and the challenge screen when 2FA is required.
 */
const { navigate, search, mutation, invalidate } = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { current: {} as { redirect?: string } },
  mutation: {
    onSuccess: (_data: unknown) => {},
    isPending: false,
    isSuccess: false,
    mutate: vi.fn(),
  },
  invalidate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => search.current,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useMutation: (options: { onSuccess: (data: unknown) => void }) => {
    mutation.onSuccess = options.onSuccess;
    return mutation;
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { login: { mutationOptions: () => ({}) } },
    user: { me: { queryOptions: () => ({ queryKey: ['user.me'] }) } },
  },
  resetCsrfToken: vi.fn(),
}));

vi.mock('@/features/auth/AuthForm.hooks', () => ({
  useAuthForm: () => ({
    form: { handleSubmit: vi.fn() },
    serverError: null,
    setServerError: vi.fn(),
    handleServerError: vi.fn(),
    turnstileRef: { current: null },
  }),
}));

const signIn = () => {
  renderHook(() => useLoginForm());
  act(() => mutation.onSuccess({ status: 'ok', user: {}, requiresVerification: false }));
};

beforeEach(() => {
  search.current = {};
  navigate.mockClear();
});

describe('useLoginForm landing', () => {
  it('lands an account on the app home', () => {
    signIn();

    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' });
  });

  it('honors an explicit redirect over the account default', () => {
    search.current = { redirect: '/settings' };
    signIn();

    expect(navigate).toHaveBeenCalledWith({ to: '/settings' });
  });

  it('sends a 2FA challenge to the challenge screen whatever the account is', () => {
    renderHook(() => useLoginForm());
    act(() => mutation.onSuccess({ status: 'twofa_required', methods: ['totp'] }));

    expect(navigate).toHaveBeenCalledWith({ to: '/auth/two-factor', search: {} });
  });
});
