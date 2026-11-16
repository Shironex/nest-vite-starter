import { noHardcodedUiStringsRule } from '../../src/rules/no-hardcoded-ui-strings';
import { ruleTester } from '../test-utils/ruleTester';

const IN_SCOPE = 'apps/web/src/features/invoices/components/InvoiceList/InvoiceList.tsx';
const OTHER_FEATURE = 'apps/web/src/features/billing/components/Agenda/Agenda.tsx';
const SETTINGS = 'apps/web/src/features/settings/components/ProfileSection/ProfileSection.tsx';
const AUTH = 'apps/web/src/features/auth/components/LoginForm/LoginForm.tsx';
const LANDING = 'apps/web/src/features/landing/components/LandingHero/LandingHero.tsx';
const ROUTE = 'apps/web/src/routes/auth/login.tsx';
// A folder that does not exist yet: the default must cover it without edits.
const NEW_FEATURE = 'apps/web/src/features/reports/components/Summary/Summary.tsx';

ruleTester.run('no-hardcoded-ui-strings', noHardcodedUiStringsRule, {
  valid: [
    {
      // Copy resolved through t() is the whole point of the rule.
      code: 'const C = () => <p>{t("invoices:title")}</p>;',
      filename: IN_SCOPE,
    },
    {
      // The one folder still carrying hardcoded copy is excluded by name.
      code: 'const C = () => <p>Invoices and payments</p>;',
      filename: LANDING,
    },
    {
      // Outside features/ and routes/: @repo/ui is not in the default.
      code: 'const C = () => <p>Home page</p>;',
      filename: 'packages/ui/src/components/empty.tsx',
    },
    {
      // A route's own test carries fixture copy like any other test.
      code: 'const C = () => <p>Sign in to continue</p>;',
      filename: 'apps/web/src/routes/auth/login.test.tsx',
    },
    {
      // A custom exclude list is honored.
      code: 'const C = () => <p>Anything</p>;',
      filename: NEW_FEATURE,
      options: [{ excludeFiles: ['**/features/reports/**'] }],
    },
    {
      // Machine-facing attributes are not copy.
      code: 'const C = () => <div className="flex gap-2" id="invoice-list" />;',
      filename: IN_SCOPE,
    },
    {
      // No letters: separators, counts and punctuation must not trip it.
      code: 'const C = () => <span>/</span>;',
      filename: IN_SCOPE,
    },
    {
      code: 'const C = () => <span>42</span>;',
      filename: IN_SCOPE,
    },
    {
      // Interpolated values are dynamic already.
      code: 'const C = () => <span>{invoice.number}</span>;',
      filename: IN_SCOPE,
    },
    {
      // Tests carry fixture copy and assertions on purpose.
      code: 'const C = () => <p>Invoice list</p>;',
      filename: 'apps/web/src/features/invoices/components/InvoiceList/InvoiceList.test.tsx',
    },
    {
      // Stories are demos, not shipped UI.
      code: 'const C = () => <p>Invoice gallery</p>;',
      filename: 'apps/web/src/features/invoices/components/InvoiceList/InvoiceList.stories.tsx',
    },
    {
      // A translated label passed through t() in an attribute.
      code: 'const C = () => <input placeholder={t("invoices:search")} />;',
      filename: IN_SCOPE,
    },
    {
      // Single character falls under minLength.
      code: 'const C = () => <span>x</span>;',
      filename: IN_SCOPE,
    },
  ],
  invalid: [
    {
      // The case the rule exists for: a literal with no catalog entry behind it.
      code: 'const C = () => <p>Invoices</p>;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      // Non-ASCII letters count as copy too: a heading with an accented word
      // is as untranslatable as a plain one.
      code: 'const C = () => <h1>Café receipts</h1>;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      code: 'const C = () => <p>Upcoming deadlines</p>;',
      filename: OTHER_FEATURE,
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      code: 'const C = () => <input placeholder="Search invoices" />;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedAttribute' }],
    },
    {
      code: 'const C = () => <button aria-label="Delete invoice" />;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedAttribute' }],
    },
    {
      // Braces around the literal change nothing.
      code: 'const C = () => <Field label={"Job title"} />;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedAttribute' }],
    },
    {
      code: 'const C = () => <img alt="Invoice photo" src={url} />;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedAttribute' }],
    },
    {
      // Text and attribute in one component, both reported.
      code: 'const C = () => <div title="Contracts"><span>Active</span></div>;',
      filename: IN_SCOPE,
      errors: [{ messageId: 'hardcodedAttribute' }, { messageId: 'hardcodedText' }],
    },
    {
      // A folder that predates the widening is policed now, not exempt.
      code: 'const C = () => <p>Profile settings</p>;',
      filename: SETTINGS,
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      // A brand-new feature folder is covered by default: nobody has to
      // remember to add it.
      code: 'const C = () => <p>Report list</p>;',
      filename: NEW_FEATURE,
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      // Auth has its catalog now, so it is policed by default like any feature.
      code: 'const C = () => <p>Sign in to continue</p>;',
      filename: AUTH,
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      // Route files render copy too (page headings), so they are in scope.
      code: 'const C = () => <AuthLayout title="Welcome back" />;',
      filename: ROUTE,
      errors: [{ messageId: 'hardcodedAttribute' }],
    },
    {
      // A custom exclude list REPLACES the default, so landing is back in scope.
      code: 'const C = () => <p>Invoices and payments</p>;',
      filename: LANDING,
      options: [{ excludeFiles: ['**/features/reports/**'] }],
      errors: [{ messageId: 'hardcodedText' }],
    },
    {
      // A custom include list is honored.
      code: 'const C = () => <p>Anything</p>;',
      filename: 'apps/web/src/features/reports/components/Summary/Summary.tsx',
      options: [{ includeFiles: ['**/features/reports/**/*.tsx'] }],
      errors: [{ messageId: 'hardcodedText' }],
    },
  ],
});
