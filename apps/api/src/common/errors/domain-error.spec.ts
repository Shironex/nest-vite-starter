import { AppErrorCode } from '@repo/shared/errors';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from './domain-error';

describe('DomainError subclasses', () => {
  it.each([
    [new UnauthorizedError(), 'UNAUTHORIZED', AppErrorCode.UNAUTHORIZED],
    [new ForbiddenError(), 'FORBIDDEN', AppErrorCode.FORBIDDEN],
    [new NotFoundError(), 'NOT_FOUND', AppErrorCode.NOT_FOUND],
    [new ConflictError(), 'CONFLICT', AppErrorCode.CONFLICT],
    [new RateLimitError(), 'TOO_MANY_REQUESTS', AppErrorCode.RATE_LIMITED],
  ])('carries its default appCode and tRPC code', (error, code, appCode) => {
    expect(error.code).toBe(code);
    expect(error.appCode).toBe(appCode);
    // With no message the message IS the code, which is what the web reads
    // when the web strings table has no sentence for it.
    expect(error.message).toBe(appCode);
  });

  /*
   * The distinction the CONFLICT code exists to draw: a lost race reloads,
   * a duplicate value changes. A ConflictError that does not say otherwise is
   * the former, because the overwhelming majority of the throw sites are CAS
   * losers and state-machine refusals.
   */
  it('defaults ConflictError to CONFLICT, not ALREADY_EXISTS', () => {
    expect(
      new ConflictError(AppErrorCode.CONFLICT, 'Reminder settings were changed concurrently.')
        .appCode,
    ).toBe(AppErrorCode.CONFLICT);
  });

  it('keeps ALREADY_EXISTS available for a genuine duplicate', () => {
    const error = new ConflictError(AppErrorCode.ALREADY_EXISTS, 'dup');
    expect(error.appCode).toBe(AppErrorCode.ALREADY_EXISTS);
    expect(error.message).toBe('dup');
  });

  it('keeps ValidationError on its own (appCode, message) shape', () => {
    const error = new ValidationError(AppErrorCode.VALIDATION_ERROR, 'bad field');
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.appCode).toBe(AppErrorCode.VALIDATION_ERROR);
    expect(error.message).toBe('bad field');
  });
});
