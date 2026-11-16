import react from '@noctcore/eslint-plugin-react';
import { ruleTester } from './rule-tester.js';

/*
 * Wiring checks for the @noctcore/eslint-plugin-react rules this repo enables
 * through @repo/eslint-config/react-architecture. Option objects mirror
 * react-architecture.js. These pin the behavior that differs from the deleted
 * local rules: max-hooks-per-file must still count `.hooks.tsx` files (the
 * noctcore default only lists the `.ts` variants), props-must-be-visual now also
 * inspects `type XProps = {}` aliases, and no-state-in-component-body runs on any
 * `.tsx` file (a widening the local rule limited to PascalCase basenames).
 */
const HOOK_BUCKET_SUFFIXES = [
  '.hooks.ts',
  '.queries.ts',
  '.mutations.ts',
  '.hooks.tsx',
  '.queries.tsx',
  '.mutations.tsx',
];

const NON_VISUAL_PROP_NAMES = [
  '^userId$',
  '^userIds$',
  '^currentUser',
  '^sessionId$',
  'token',
  'jwt',
  'secret',
  'apiKey',
  'credential',
];

const hookSuffixOptions = [{ fileSuffixes: HOOK_BUCKET_SUFFIXES }];
const denyPropOptions = [{ denyPropNames: NON_VISUAL_PROP_NAMES }];

const fiveHooks = [
  'export const useA = () => 1;',
  'export const useB = () => 2;',
  'export const useC = () => 3;',
  'export const useD = () => 4;',
  'export const useE = () => 5;',
].join('\n');

ruleTester.run('max-hooks-per-file', react.rules['max-hooks-per-file'], {
  valid: [
    // A `.tsx` component file is not a hook-bucket file, so its hooks are ignored.
    {
      code: fiveHooks,
      filename: 'src/features/billing/Billing.tsx',
      options: hookSuffixOptions,
    },
    {
      code: 'export const useA = () => 1;\nexport const useB = () => 2;',
      filename: 'src/features/billing/billing.hooks.tsx',
      options: hookSuffixOptions,
    },
  ],
  invalid: [
    // `.hooks.tsx` must be policed just like `.hooks.ts` (the added suffix).
    {
      code: fiveHooks,
      filename: 'src/features/billing/billing.hooks.tsx',
      options: hookSuffixOptions,
      errors: [{ messageId: 'tooManyHooks' }],
    },
  ],
});

ruleTester.run('no-state-in-component-body', react.rules['no-state-in-component-body'], {
  valid: [
    { code: 'const id = useId();', filename: 'src/features/billing/Billing.tsx' },
    // The colocated hook file is where state belongs.
    { code: 'const [n, setN] = useState(0);', filename: 'src/features/billing/billing.hooks.ts' },
  ],
  invalid: [
    {
      code: 'const [n, setN] = useState(0);',
      filename: 'src/features/billing/Billing.tsx',
      errors: [{ messageId: 'stateInBody' }],
    },
    // Widening over the local rule: a non-PascalCase `.tsx` is now checked too.
    {
      code: 'const [n, setN] = useState(0);',
      filename: 'src/features/billing/route.tsx',
      errors: [{ messageId: 'stateInBody' }],
    },
  ],
});

ruleTester.run('props-must-be-visual', react.rules['props-must-be-visual'], {
  valid: [
    {
      code: 'interface InvoiceProps { title: string; amount: number; }',
      options: denyPropOptions,
    },
  ],
  invalid: [
    {
      code: 'interface InvoiceProps { token: string; }',
      options: denyPropOptions,
      errors: [{ messageId: 'nonVisualProp' }],
    },
    // Widening over the local rule: `type XProps = {}` aliases are inspected.
    {
      code: 'type InvoiceProps = { userId: string; };',
      options: denyPropOptions,
      errors: [{ messageId: 'nonVisualProp' }],
    },
  ],
});
