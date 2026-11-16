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

const incMock = jest.fn();
const labelsMock = jest.fn(() => ({ inc: incMock }));
jest.mock('./metrics.registry', () => ({
  authOutcomesTotal: { labels: (...args: unknown[]) => labelsMock(...(args as [])) },
}));

import { recordAuthOutcome } from './auth-outcome.recorder';

describe('recordAuthOutcome', () => {
  beforeEach(() => {
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();
    labelsMock.mockClear();
    incMock.mockClear();
  });

  it('counts a refusal and logs it at warn with the account that hit it', () => {
    recordAuthOutcome({ flow: 'login', outcome: 'locked', kind: 'refusal', userId: 'u-1' });

    expect(labelsMock).toHaveBeenCalledWith('login', 'locked');
    expect(incMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith('auth outcome refused', {
      op: 'auth.login',
      outcome: 'locked',
      userId: 'u-1',
    });
    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it('counts a success and logs it at info', () => {
    recordAuthOutcome({
      flow: 'twofa_challenge',
      outcome: 'success',
      kind: 'success',
      userId: 'u-2',
    });

    expect(labelsMock).toHaveBeenCalledWith('twofa_challenge', 'success');
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

  it('still counts the outcome even when nothing else about it is known', () => {
    recordAuthOutcome({ flow: 'session_mint', outcome: 'fence', kind: 'refusal', userId: 'u-3' });

    expect(labelsMock).toHaveBeenCalledWith('session_mint', 'fence');
    expect(incMock).toHaveBeenCalledTimes(1);
  });
});
