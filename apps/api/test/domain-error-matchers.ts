/**
 * Assert the TYPE and the `appCode` of a refusal, never only its wording.
 *
 * A fence spec that asserts `.rejects.toThrow('Workspace not found.')` passes
 * when the throw is swapped for a `ForbiddenError` carrying the same sentence,
 * because a message is the one thing the two refusals share. The property those
 * specs exist to defend is the DIFFERENCE between them: NOT_FOUND says nothing
 * about whether the id exists, FORBIDDEN confirms that it does and turns the
 * surface into an enumeration oracle over another organization's roster.
 *
 * So a refusal is asserted on three axes, in this order of importance:
 *
 *   1. the class, because that is what a future refactor swaps,
 *   2. the `appCode`, because that is what actually crosses the wire and what
 *      the web app branches on,
 *   3. the message, optionally and by substring, because it is copy and copy
 *      gets rewritten.
 *
 * The message stays available rather than being dropped: some refusals differ
 * only in wording (a FILED request versus a WITHDRAWN one both answer
 * BAD_REQUEST), and there the sentence IS the assertion.
 */
import type { AppErrorCode } from '@repo/shared/errors';
import { DomainError } from '../src/common/errors/domain-error';

/** A concrete `DomainError` subclass, as a spec names one. */
type DomainErrorClass = new (...args: never[]) => DomainError;

export interface IDomainErrorExpectation {
  readonly type: DomainErrorClass;
  readonly appCode: AppErrorCode;
  /** Matched as a SUBSTRING, so a reworded sentence does not break the fence. */
  readonly message?: string;
}

/** Assert an already-caught value is the refusal `expected` describes. */
export const expectDomainError = (
  thrown: unknown,
  expected: IDomainErrorExpectation,
): DomainError => {
  expect(thrown).toBeInstanceOf(expected.type);
  const error = thrown as DomainError;
  expect(error.appCode).toBe(expected.appCode);
  if (expected.message !== undefined) {
    expect(error.message).toContain(expected.message);
  }
  return error;
};

/** Assert a synchronous call refuses with exactly this error. */
export const expectThrowsDomainError = (
  call: () => unknown,
  expected: IDomainErrorExpectation,
): DomainError => {
  try {
    call();
  } catch (thrown) {
    return expectDomainError(thrown, expected);
  }
  throw new Error(`Expected ${expected.type.name} (${expected.appCode}), but the call returned.`);
};

/** Assert a promise refuses with exactly this error. */
export const expectRejectsDomainError = async (
  call: Promise<unknown>,
  expected: IDomainErrorExpectation,
): Promise<DomainError> =>
  call.then(
    () => {
      throw new Error(
        `Expected ${expected.type.name} (${expected.appCode}), but the call resolved.`,
      );
    },
    (thrown: unknown) => expectDomainError(thrown, expected),
  );
