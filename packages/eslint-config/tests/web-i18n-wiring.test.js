import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/*
 * `contracts/translation-key-exists` is inert without its `catalogs` option,
 * and a catalog path that stops resolving is inert too: the rule then reports a
 * missing namespace or nothing, never a wrong key. Both happen in one careless
 * edit of apps/web/eslint.config.js with lint still green. So this lints probe
 * source through the web app's REAL config and asserts the rule resolves keys
 * against the real English catalogs, in the default namespace and through an
 * imported `*_NS` constant.
 */
const WEB_DIR = join(import.meta.dirname, '../../../apps/web');
const RULE = 'contracts/translation-key-exists';

let eslint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: WEB_DIR });
  // Loading the web app's config and parser is the slow part (seconds under a
  // full turbo run), so it is paid here once rather than by the first case.
  await eslint.lintText('export {};\n', {
    filePath: join(WEB_DIR, 'src/features/audit/components/Probe/Warmup.ts'),
  });
}, 60_000);

async function keyReports(body) {
  const [result] = await eslint.lintText(`${body}\n`, {
    filePath: join(WEB_DIR, 'src/features/audit/components/Probe/Probe.hooks.ts'),
  });
  expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  return result.messages.filter((m) => m.ruleId === RULE).map((m) => m.message);
}

const header = [
  "import { useTranslation } from 'react-i18next';",
  "import { AUDIT_NS } from '../../Audit.i18n';",
].join('\n');

describe('translation-key-exists on apps/web', () => {
  it('accepts real keys in the default namespace and in a feature namespace', async () => {
    const reports = await keyReports(
      `${header}\nexport function useProbe() {\n  const { t } = useTranslation();\n  const { t: tp } = useTranslation(AUDIT_NS);\n  return [t('actions.cancel'), tp('list.empty')];\n}`,
    );
    expect(reports).toEqual([]);
  });

  it('reports the namespace used as a key segment in the default namespace', async () => {
    const reports = await keyReports(
      `${header}\nexport function useProbe() {\n  const { t } = useTranslation();\n  return t('common.cancel');\n}`,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('`common.cancel`');
  });

  it('resolves an imported *_NS constant, so a key missing from that feature is reported', async () => {
    const reports = await keyReports(
      `${header}\nexport function useProbe() {\n  const { t } = useTranslation(AUDIT_NS);\n  return t('actions.cancel');\n}`,
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('namespace `audit`');
  });
});
