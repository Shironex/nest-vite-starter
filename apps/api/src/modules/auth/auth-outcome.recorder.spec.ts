const loggerInfoMock = jest.fn();
const loggerWarnMock = jest.fn();
jest.mock('../logger/logger.service', () => ({
  createAppLogger: () => ({
    error: jest.fn(),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    info: (...args: unknown[]) => loggerInfoMock(...args),
    debug: jest.fn(),
    log: jest.fn(),
  }),
}));

import { recordAuthOutcome } from './auth-outcome.recorder';

describe('recordAuthOutcome', () => {
  beforeEach(() => {
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();
  });

  it('logs a refusal at warn with the account that hit it', () => {
    recordAuthOutcome({ flow: 'login', outcome: 'locked', kind: 'refusal', userId: 'u-1' });

    expect(loggerWarnMock).toHaveBeenCalledWith('auth outcome refused', {
      op: 'auth.login',
      outcome: 'locked',
      userId: 'u-1',
    });
    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it('logs a success at info', () => {
    recordAuthOutcome({
      flow: 'twofa_challenge',
      outcome: 'success',
      kind: 'success',
      userId: 'u-2',
    });

    expect(loggerInfoMock).toHaveBeenCalledWith('auth outcome', {
      op: 'auth.twofa_challenge',
      outcome: 'success',
      userId: 'u-2',
    });
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('omits userId entirely on the pre-authentication branches', () => {
    // An unknown email resolves no user on purpose: that IS the
    // account-enumeration defense, so the field must be absent, not undefined.
    recordAuthOutcome({ flow: 'login', outcome: 'unknown_email', kind: 'refusal' });

    const [, details] = loggerWarnMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(details)).toEqual(['op', 'outcome']);
  });
});
