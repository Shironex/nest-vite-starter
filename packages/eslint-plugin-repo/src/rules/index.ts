import { jobNameMustBeConstantRule } from './job-name-must-be-constant';
import { processorMustExtendTracedWorkerHostRule } from './processor-must-extend-traced-worker-host';
import { queueAddMustWrapJobContextRule } from './queue-add-must-wrap-job-context';
import { noNativeDateInputRule } from './no-native-date-input';
import { effectFiredMutationMustBindCallbacksRule } from './effect-fired-mutation-must-bind-callbacks';
import { trpcInvalidateWithPathKeyRule } from './trpc-invalidate-with-path-key';

/*
 * @repo/eslint-plugin-repo now holds only the rules with no published
 * @noctcore/* home yet: the NestJS/BullMQ queue-discipline trio and the rules
 * below. Every other former rule, the Prisma
 * tenancy/transaction family included, was swapped for its published
 * @noctcore/eslint-plugin-* equivalent and wired in @repo/eslint-config with
 * options reproducing the prior defaults.
 */
export const rules = {
  'processor-must-extend-traced-worker-host': processorMustExtendTracedWorkerHostRule,
  'queue-add-must-wrap-job-context': queueAddMustWrapJobContextRule,
  'job-name-must-be-constant': jobNameMustBeConstantRule,
  'no-native-date-input': noNativeDateInputRule,
  'effect-fired-mutation-must-bind-callbacks': effectFiredMutationMustBindCallbacksRule,
  // Zod wire-contract rule, framework-agnostic; a candidate for
  // @noctcore/eslint-plugin-contracts.
  'trpc-invalidate-with-path-key': trpcInvalidateWithPathKeyRule,
};
