import { describe, expect, it } from 'vitest';
import { AppErrorCode } from '@repo/shared/errors';
import { getAppErrorCode, translateAppError } from './trpc-errors';
import { commonStrings, errorStrings } from './strings';

describe('getAppErrorCode', () => {
  it('returns the AppErrorCode carried on error.data.appCode', () => {
    const error = {
      message: 'Account locked',
      data: { code: 'FORBIDDEN', httpStatus: 403, appCode: 'ACCOUNT_LOCKED' },
    };
    expect(getAppErrorCode(error)).toBe(AppErrorCode.ACCOUNT_LOCKED);
  });

  it('returns INVALID_CREDENTIALS for the change-password wrong-current-password error', () => {
    const error = {
      message: 'Current password is incorrect',
      data: { code: 'UNAUTHORIZED', httpStatus: 401, appCode: 'INVALID_CREDENTIALS' },
    };
    expect(getAppErrorCode(error)).toBe(AppErrorCode.INVALID_CREDENTIALS);
  });

  it('returns undefined for an appCode that is not a known AppErrorCode member', () => {
    const error = { message: 'x', data: { appCode: 'NOT_A_REAL_CODE' } };
    expect(getAppErrorCode(error)).toBeUndefined();
  });

  it('returns undefined when data or appCode is missing', () => {
    expect(getAppErrorCode({ message: 'x' })).toBeUndefined();
    expect(getAppErrorCode({ message: 'x', data: {} })).toBeUndefined();
    expect(getAppErrorCode({ message: 'x', data: null })).toBeUndefined();
  });

  it('returns undefined for non-object errors', () => {
    expect(getAppErrorCode(undefined)).toBeUndefined();
    expect(getAppErrorCode(null)).toBeUndefined();
    expect(getAppErrorCode('ACCOUNT_LOCKED')).toBeUndefined();
    expect(getAppErrorCode(new Error('ACCOUNT_LOCKED'))).toBeUndefined();
  });
});

describe('translateAppError', () => {
  // The plain-function path queryCache.onError uses outside React.
  it('maps a known appCode to its translated sentence', () => {
    const error = {
      message: 'Account locked',
      data: { code: 'FORBIDDEN', httpStatus: 403, appCode: 'ACCOUNT_LOCKED' },
    };
    expect(translateAppError(error)).toBe(errorStrings.ACCOUNT_LOCKED);
  });

  // `data` present means the api answered; the message on that path is the
  // api's own sentence for a failure `errorStrings` has no code for.
  it('falls back to the raw message when a real response carries no mapped code', () => {
    expect(
      translateAppError({
        message: 'Something server-specific',
        data: { code: 'BAD_REQUEST', httpStatus: 400 },
      }),
    ).toBe('Something server-specific');
  });

  // The api stamps appCode on every tRPC error response, so a TRPCClientError
  // with no `data` never reached the api: "Failed to fetch", "Load failed",
  // "Unexpected token '<'" from a proxy HTML 502.
  it('returns the network sentence for a TRPCClientError with no data', () => {
    const transport = Object.assign(new Error('Failed to fetch'), {
      name: 'TRPCClientError',
    });
    expect(translateAppError(transport)).toBe(commonStrings.errors.network);

    const proxyHtml = Object.assign(new Error("Unexpected token '<'"), {
      name: 'TRPCClientError',
    });
    expect(translateAppError(proxyHtml)).toBe(commonStrings.errors.network);
  });

  it('never returns a browser-internal transport message', () => {
    const transport = Object.assign(new Error('Failed to fetch'), {
      name: 'TRPCClientError',
    });
    expect(translateAppError(transport)).not.toContain('fetch');
  });

  it('returns undefined for an error that is neither a response nor a tRPC failure', () => {
    expect(translateAppError(undefined)).toBeUndefined();
    expect(translateAppError(null)).toBeUndefined();
    expect(translateAppError({})).toBeUndefined();
    expect(translateAppError({ message: '' })).toBeUndefined();
    // A plain Error: the caller's own generic copy is better than its message.
    expect(translateAppError(new Error('boom'))).toBeUndefined();
    expect(translateAppError({ message: 'Something server-specific' })).toBeUndefined();
  });
});
