import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * The web features inventory must name every domain that exists.
 *
 * It drifted badly once already: nine feature directories shipped while the
 * page still described the template's original seven. Prose has no
 * compiler, so the only thing that keeps an inventory honest is a check that
 * reads the directory listing.
 *
 * The assertion is a table ROW (`| \`name\``), not a bare mention. A page can
 * name a feature while saying it is undocumented (that is exactly what the
 * stale version did in its coverage warning), and such a mention must not
 * satisfy the rule.
 *
 * Depth is deliberately not checked. A domain documented on its own
 * backend page needs a row here pointing at it, not a duplicate walkthrough.
 */
const FEATURES_DIR = join('apps', 'web', 'src', 'features');
const INVENTORY_DOC = join(
  'apps',
  'docs',
  'src',
  'content',
  'docs',
  'frontend',
  'features-inventory.md',
);

export function checkFeatureInventoryComplete(root: string): IViolation[] {
  const featuresPath = join(root, FEATURES_DIR);
  const docPath = join(root, INVENTORY_DOC);

  if (!existsSync(featuresPath)) {
    return [];
  }

  if (!existsSync(docPath)) {
    return [
      {
        file: INVENTORY_DOC,
        rule: 'docs-feature-inventory-complete',
        message: `Missing inventory page. Every directory in ${FEATURES_DIR} must be listed there.`,
      },
    ];
  }

  const doc = readFileSync(docPath, 'utf8');
  const features = readdirSync(featuresPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const violations: IViolation[] = [];
  for (const feature of features) {
    if (doc.includes(`| \`${feature}\``)) {
      continue;
    }

    violations.push({
      file: INVENTORY_DOC,
      rule: 'docs-feature-inventory-complete',
      message: `Feature \`${feature}\` exists in ${FEATURES_DIR} but has no row in the inventory table. Add \`| \`${feature}\` | <what it covers> | <link to its backend page, or "Below"> |\`.`,
    });
  }

  return violations;
}

/** Every apps/web/src/features/* directory must have a row in the inventory page. */
export const docsFeatureInventoryCompleteRule: IMetaRule = {
  id: 'docs-feature-inventory-complete',
  category: 'config',
  ciCritical: true,
  description:
    'Every directory under apps/web/src/features must have a table row in the web features inventory doc.',
  run({ root }: IMetaContext): IViolation[] {
    return checkFeatureInventoryComplete(root);
  },
};
