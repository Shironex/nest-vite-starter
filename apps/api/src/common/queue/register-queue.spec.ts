import { getQueueOptionsToken } from '@nestjs/bullmq';
import type { FactoryProvider, Provider } from '@nestjs/common';

import { QUEUE_NAMES, type IQueueDefaults, type QueueJobDefaults } from './queue.constants';
import { registerQueueWithDefaults } from './register-queue';

const DEFAULTS: IQueueDefaults = {
  jobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 100 },
    removeOnFail: { age: 604_800 },
  },
  concurrency: 5,
};

/*
 * The compile-time half of the contract, written as conditional-type
 * assertions. A "this must NOT compile" case cannot be written as a value here
 * (the suppression comment that would be needed is banned repo-wide), so
 * assignability is asserted through a type instead. If any of these stops
 * holding, `check-types` fails on this file.
 */
type Assignable<TCandidate, TTarget> = TCandidate extends TTarget ? true : false;
type Rejected<TCandidate, TTarget> = Assignable<TCandidate, TTarget> extends false ? true : false;
type Assert<TCondition extends true> = TCondition;

type Bounded = { readonly age: 3_600 };
type Backoff = { readonly type: 'exponential'; readonly delay: 5_000 };

export type QueueDefaultsAreEnforced = [
  // The shape all four queues use is accepted.
  Assert<
    Assignable<
      { attempts: 3; backoff: Backoff; removeOnComplete: Bounded; removeOnFail: Bounded },
      QueueJobDefaults
    >
  >,
  // An unbounded failed set is rejected: unbounded Redis growth, and for
  // email-delivery unbounded PII at rest.
  Assert<Rejected<{ attempts: 3; backoff: Backoff; removeOnComplete: Bounded }, QueueJobDefaults>>,
  // Retries with no backoff are rejected: they hammer a dependency that is
  // already failing.
  Assert<
    Rejected<{ attempts: 3; removeOnComplete: Bounded; removeOnFail: Bounded }, QueueJobDefaults>
  >,
  // A retention window with only a `count` is rejected: `age` is the bound that
  // still holds once the queue goes quiet.
  Assert<
    Rejected<
      { attempts: 1; removeOnComplete: { readonly count: 100 }; removeOnFail: Bounded },
      QueueJobDefaults
    >
  >,
  // A worker that never picks anything up is rejected.
  Assert<Rejected<0, IQueueDefaults['concurrency']>>,
];

/** The `useFactory` provider Bull registers for a queue's resolved options. */
function queueOptionsProvider(providers: readonly Provider[], name: string): FactoryProvider {
  const token = getQueueOptionsToken(name);
  const found = providers.find(
    (provider): provider is FactoryProvider =>
      typeof provider === 'object' && 'provide' in provider && provider.provide === token,
  );

  if (found === undefined) {
    throw new Error(`No options provider registered for queue "${name}"`);
  }

  return found;
}

describe('registerQueueWithDefaults', () => {
  it('registers the queue with the defaults object job options', () => {
    const module = registerQueueWithDefaults(QUEUE_NAMES.EMAIL_DELIVERY, DEFAULTS);
    const provider = queueOptionsProvider(module.providers ?? [], QUEUE_NAMES.EMAIL_DELIVERY);

    // Bull merges the shared root config into the per-queue options inside the
    // factory, so the resolved options are read the way Nest reads them rather
    // than by re-implementing the merge here. No shared config in this unit.
    const resolved: unknown = provider.useFactory({ getDependencyRef: () => ({}) });

    expect(resolved).toMatchObject({
      name: QUEUE_NAMES.EMAIL_DELIVERY,
      defaultJobOptions: DEFAULTS.jobOptions,
    });
  });

  it('is the same registration for every queue name, so a second queue cannot drift', () => {
    const module = registerQueueWithDefaults(QUEUE_NAMES.NOTIFICATION_DISPATCH, DEFAULTS);
    const provider = queueOptionsProvider(
      module.providers ?? [],
      QUEUE_NAMES.NOTIFICATION_DISPATCH,
    );
    const resolved: unknown = provider.useFactory({ getDependencyRef: () => ({}) });

    expect(resolved).toMatchObject({
      name: QUEUE_NAMES.NOTIFICATION_DISPATCH,
      defaultJobOptions: DEFAULTS.jobOptions,
    });
  });
});
