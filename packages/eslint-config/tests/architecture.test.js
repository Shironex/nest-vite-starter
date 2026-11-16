import architecture from '@noctcore/eslint-plugin-architecture';
import { ruleTester } from './rule-tester.js';

/*
 * Wiring check for @noctcore/eslint-plugin-architecture/no-cross-feature-imports
 * as enabled through @repo/eslint-config/react-architecture. Options mirror
 * react-architecture.js (`featureRoot: 'src/features'`, `alias: '@/features'`,
 * `sharedFeatures: ['shared']`). Also pins the superset behavior the deleted
 * local rule lacked: `export ... from` re-export laundering is now caught.
 */
const crossFeatureOptions = [
  { featureRoot: 'src/features', alias: '@/features', sharedFeatures: ['shared'] },
];

const currentFile = '/repo/apps/web/src/features/billing/components/Invoice/Invoice.tsx';

ruleTester.run('no-cross-feature-imports', architecture.rules['no-cross-feature-imports'], {
  valid: [
    // Same feature.
    {
      code: "import { total } from '@/features/billing/lib';",
      filename: currentFile,
      options: crossFeatureOptions,
    },
    // Designated shared feature.
    {
      code: "import { Button } from '@/features/shared';",
      filename: currentFile,
      options: crossFeatureOptions,
    },
    // Type-only imports are allowed by default.
    {
      code: "import type { Client } from '@/features/clients';",
      filename: currentFile,
      options: crossFeatureOptions,
    },
  ],
  invalid: [
    // Shared, not a free-for-all: `shared` may not reach into a domain feature.
    {
      code: "import { InvoiceForm } from '@/features/billing/components/InvoiceForm';",
      filename: '/repo/apps/web/src/features/shared/components/Picker/Picker.tsx',
      options: crossFeatureOptions,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    {
      code: "import { Client } from '@/features/clients';",
      filename: currentFile,
      options: crossFeatureOptions,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Superset over the deleted local rule: re-export laundering is caught.
    {
      code: "export { Client } from '@/features/clients';",
      filename: currentFile,
      options: crossFeatureOptions,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
  ],
});
