import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../lint-meta/test-support';
import {
  MANIFEST_PATH,
  configSurfaceCompleteRule,
  parseJoiSchema,
  readComposeServices,
  readEnvExampleKeys,
  readProcessEnvKeys,
} from './config-surface';

const JOI = 'apps/api/src/config/configuration.config.ts';

const JOI_SOURCE = `
export const validationSchema = Joi.object({
  // DATABASE_URL is always required; this comment says .required() and must not count.
  DATABASE_URL: Joi.string().uri().required(),
  API_PUBLIC_URL: Joi.string()
    .uri()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().uri().default('http://localhost:3000'),
    }),
  EMAIL_PROVIDER: Joi.string().valid('smtp', 'resend').default('smtp'),
  RESEND_API_KEY: Joi.string().optional().allow(''),
  OAUTH_ID: Joi.string().empty('').optional(),
  OAUTH_SECRET: Joi.string().empty('').optional(),
}).and('OAUTH_ID', 'OAUTH_SECRET');
`;

const ENV_EXAMPLE = [
  'DATABASE_URL=postgres://x',
  'API_PUBLIC_URL=http://localhost:3000',
  'EMAIL_PROVIDER=smtp',
  'RESEND_API_KEY=',
  'OAUTH_ID=',
  'OAUTH_SECRET=',
  '# VITE_PROXY=http://localhost:3000',
  'POSTGRES_PASSWORD=',
  '',
].join('\n');

const COMPOSE = `services:
  postgres:
    image: postgres
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
  mailpit:
    image: mailpit
volumes:
  data:
`;

interface IManifestOverrides {
  readonly groups?: Record<string, unknown>;
  readonly crossRules?: unknown[];
  readonly waived?: Record<string, string>;
}

const BASE_GROUPS = {
  server: {
    kind: 'core',
    description: 'server',
    keys: ['API_PUBLIC_URL', 'VITE_PROXY'],
    secrets: [],
    required: [],
    prodRequired: ['API_PUBLIC_URL'],
    services: [],
  },
  database: {
    kind: 'core',
    description: 'db',
    keys: ['DATABASE_URL', 'POSTGRES_PASSWORD'],
    secrets: ['POSTGRES_PASSWORD'],
    required: ['DATABASE_URL'],
    prodRequired: [],
    services: ['postgres'],
  },
  email: {
    kind: 'select',
    toggle: 'EMAIL_PROVIDER',
    description: 'mail',
    keys: ['EMAIL_PROVIDER', 'RESEND_API_KEY'],
    secrets: ['RESEND_API_KEY'],
    required: [],
    prodRequired: [],
    services: ['mailpit'],
  },
  oauth: {
    kind: 'presence',
    toggle: 'OAUTH_ID',
    description: 'oauth',
    keys: ['OAUTH_ID', 'OAUTH_SECRET'],
    secrets: ['OAUTH_SECRET'],
    required: [],
    prodRequired: [],
    services: [],
  },
};

const BASE_CROSS_RULES = [
  { id: 'oauth-pair', kind: 'and', keys: ['OAUTH_ID', 'OAUTH_SECRET'] },
  {
    id: 'resend-key',
    kind: 'requiredWhen',
    key: 'RESEND_API_KEY',
    when: { key: 'EMAIL_PROVIDER', is: 'resend' },
    enforcedAtBoot: false,
  },
];

function manifest(overrides: IManifestOverrides = {}): string {
  return JSON.stringify({
    groups: overrides.groups ?? BASE_GROUPS,
    crossRules: overrides.crossRules ?? BASE_CROSS_RULES,
    waived: overrides.waived ?? { SEED_ONLY: 'read by a test seam, not configuration' },
  });
}

function tree(files: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    [JOI]: JOI_SOURCE,
    '.env.example': ENV_EXAMPLE,
    'docker-compose.yml': COMPOSE,
    'apps/web/vite.config.ts': "const target = readEnv('VITE_PROXY');\n",
    'packages/database/prisma/seed.ts': 'const x = process.env.SEED_ONLY;\n',
    [MANIFEST_PATH]: manifest(),
    ...files,
  };
}

function run(files: Readonly<Record<string, string>> = {}) {
  const fixture = createFixture(tree(files));
  return runSync(configSurfaceCompleteRule, fixture.context());
}

function messages(files: Readonly<Record<string, string>> = {}): string[] {
  return run(files).map((violation) => violation.message);
}

describe('config-surface-complete', () => {
  it('passes a tree whose every key is modeled once and agrees with Joi', () => {
    assert.deepEqual(run(), []);
  });

  describe('completeness', () => {
    it('reds a new .env.example key no group models', () => {
      const found = run({ '.env.example': `${ENV_EXAMPLE}NEW_FEATURE_TOKEN=\n` });
      assert.equal(found.length, 1);
      assert.equal(found[0]?.file, '.env.example');
      assert.match(found[0]?.message ?? '', /`NEW_FEATURE_TOKEN` is part of the config surface/u);
    });

    it('reds a new Joi key, a new VITE_ read, a new compose ref and a new process.env read', () => {
      const found = messages({
        [JOI]: JOI_SOURCE.replace('}).and(', '  JOI_ONLY: Joi.string().optional(),\n}).and('),
        'apps/web/src/lib/env.ts': 'export const X = import.meta.env.VITE_NEW_THING;\n',
        'docker-compose.yml': COMPOSE.replace('image: mailpit', 'image: mailpit:${MAILPIT_TAG}'),
        'apps/desktop/src/main/index.ts': "const url = process.env['DESKTOP_ONLY'];\n",
      });
      for (const key of ['JOI_ONLY', 'VITE_NEW_THING', 'MAILPIT_TAG', 'DESKTOP_ONLY']) {
        assert.ok(
          found.some((message) => message.includes(`\`${key}\` is part of the config surface`)),
          `${key} was not reported: ${found.join(' | ')}`,
        );
      }
    });

    it('does not count a process.env read in a spec, or in a directory named like a .ts file', () => {
      assert.deepEqual(
        run({
          'apps/api/src/thing.spec.ts': 'process.env.SPEC_ONLY = "1";\n',
          'apps/api/src/snapshots.ts/keep.txt': 'process.env.NOT_A_FILE\n',
        }),
        [],
      );
    });

    it('reds a stale modeled key that nothing reads or documents', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: {
            ...BASE_GROUPS,
            email: { ...BASE_GROUPS.email, keys: [...BASE_GROUPS.email.keys, 'SMTP_GONE'] },
          },
        }),
      });
      assert.equal(found.length, 1);
      assert.match(found[0] ?? '', /`SMTP_GONE` is listed .* nothing reads or documents it/u);
    });

    it('reds a stale waiver', () => {
      const found = messages({ 'packages/database/prisma/seed.ts': 'export {};\n' });
      assert.equal(found.length, 1);
      assert.match(found[0] ?? '', /`SEED_ONLY` is listed/u);
    });
  });

  describe('manifest shape', () => {
    it('reds a key listed in two groups', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: {
            ...BASE_GROUPS,
            oauth: { ...BASE_GROUPS.oauth, keys: [...BASE_GROUPS.oauth.keys, 'DATABASE_URL'] },
          },
        }),
      });
      assert.ok(
        found.some((m) => /`DATABASE_URL` is listed in both `database` and `oauth`/u.test(m)),
      );
    });

    it('reds a key both modeled and waived, and a waiver with no reason', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({ waived: { SEED_ONLY: ' ', DATABASE_URL: 'dup' } }),
      });
      assert.ok(
        found.some((m) => /`DATABASE_URL` is both modeled in `database` and waived/u.test(m)),
      );
      assert.ok(found.some((m) => /waiver for `SEED_ONLY` gives no reason/u.test(m)));
    });

    it('reds a toggle that is not one of the group keys, and a secret outside keys', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: {
            ...BASE_GROUPS,
            oauth: { ...BASE_GROUPS.oauth, toggle: 'NOPE', secrets: ['OAUTH_SECRET', 'ELSEWHERE'] },
          },
        }),
      });
      assert.ok(found.some((m) => /`oauth` is kind `presence`, so its `toggle`/u.test(m)));
      assert.ok(
        found.some((m) => /`ELSEWHERE` is in `oauth.secrets` but not in `oauth.keys`/u.test(m)),
      );
    });

    it('reds a VITE_ key marked secret', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: { ...BASE_GROUPS, server: { ...BASE_GROUPS.server, secrets: ['VITE_PROXY'] } },
        }),
      });
      assert.ok(found.some((m) => /`VITE_PROXY` is marked secret/u.test(m)));
    });

    it('reds a service no compose file defines', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: { ...BASE_GROUPS, email: { ...BASE_GROUPS.email, services: ['smtp-relay'] } },
        }),
      });
      assert.deepEqual(found.length, 1);
      assert.match(found[0] ?? '', /compose service `smtp-relay`/u);
    });

    it('fails closed on a missing or malformed manifest', () => {
      const fixture = createFixture(tree());
      fixture.write({ [MANIFEST_PATH]: '{ not json' });
      const found = runSync(configSurfaceCompleteRule, fixture.context());
      assert.equal(found.length, 1);
      assert.match(found[0]?.message ?? '', /not valid JSON/u);

      fixture.write({ [MANIFEST_PATH]: '{"groups": {}}' });
      assert.match(
        runSync(configSurfaceCompleteRule, fixture.context())[0]?.message ?? '',
        /must hold `groups`/u,
      );
    });
  });

  describe('agreement with Joi', () => {
    it('reds a Joi-required key the manifest does not list, and the reverse', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: {
            ...BASE_GROUPS,
            database: { ...BASE_GROUPS.database, required: ['POSTGRES_PASSWORD'] },
          },
        }),
      });
      assert.ok(found.some((m) => /Joi requires, in every environment, `DATABASE_URL`/u.test(m)));
      assert.ok(
        found.some((m) => /`POSTGRES_PASSWORD` is in `required`, but Joi does not/u.test(m)),
      );
    });

    it('reds a production-only requirement the manifest lost', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          groups: { ...BASE_GROUPS, server: { ...BASE_GROUPS.server, prodRequired: [] } },
        }),
      });
      assert.equal(found.length, 1);
      assert.match(found[0] ?? '', /in production only, `API_PUBLIC_URL`/u);
    });

    it('reds an .and() the manifest does not model, and an and-rule Joi does not enforce', () => {
      const dropped = messages({
        [MANIFEST_PATH]: manifest({ crossRules: [BASE_CROSS_RULES[1]] }),
      });
      assert.ok(dropped.some((m) => /Joi enforces `.and\(OAUTH_ID, OAUTH_SECRET\)`/u.test(m)));

      const unenforced = messages({
        [JOI]: JOI_SOURCE.replace(".and('OAUTH_ID', 'OAUTH_SECRET')", ''),
      });
      assert.ok(unenforced.some((m) => /Cross-rule `oauth-pair` .* no matching `.and/u.test(m)));
    });

    it('reds a requiredWhen rule claimed enforced while Joi leaves the key optional', () => {
      const found = messages({
        [MANIFEST_PATH]: manifest({
          crossRules: [BASE_CROSS_RULES[0], { ...BASE_CROSS_RULES[1], enforcedAtBoot: true }],
        }),
      });
      assert.equal(found.length, 1);
      assert.match(found[0] ?? '', /`resend-key` says `RESEND_API_KEY` is required when/u);
    });

    it('reds Joi enforcing a conditional requirement the manifest still calls unenforced', () => {
      const found = messages({
        [JOI]: JOI_SOURCE.replace(
          "RESEND_API_KEY: Joi.string().optional().allow(''),",
          "RESEND_API_KEY: Joi.string().when('EMAIL_PROVIDER', { is: 'resend', then: Joi.required(), otherwise: Joi.optional().allow('') }),",
        ),
      });
      assert.equal(found.length, 1);
      assert.match(found[0] ?? '', /set `enforcedAtBoot: true` on cross-rule `resend-key`/u);
    });

    it('reds a conditional Joi requirement with no cross-rule at all', () => {
      const found = messages({
        [JOI]: JOI_SOURCE.replace(
          "OAUTH_SECRET: Joi.string().empty('').optional(),",
          "OAUTH_SECRET: Joi.string().when('OAUTH_ID', { is: 'x', then: Joi.required() }),",
        ),
      });
      assert.ok(
        found.some((m) =>
          /requires `OAUTH_SECRET` when OAUTH_ID=x, but .* no `requiredWhen`/u.test(m),
        ),
      );
    });
  });
});

describe('config-surface parsers', () => {
  it('reads Joi declarations, their whens and the object-level .and(), ignoring comments', () => {
    const joi = parseJoiSchema(JOI_SOURCE);
    assert.deepEqual(
      joi.declarations.map((d) => [d.key, d.required]),
      [
        ['DATABASE_URL', true],
        ['API_PUBLIC_URL', false],
        ['EMAIL_PROVIDER', false],
        ['RESEND_API_KEY', false],
        ['OAUTH_ID', false],
        ['OAUTH_SECRET', false],
      ],
    );
    assert.deepEqual(joi.declarations[1]?.whens, [
      { key: 'NODE_ENV', is: 'production', thenRequires: true },
    ]);
    assert.deepEqual(joi.andGroups, [['OAUTH_ID', 'OAUTH_SECRET']]);
  });

  it('reads active and commented .env.example assignments, not prose', () => {
    assert.deepEqual(readEnvExampleKeys('A=1\n# B=2\n# just words\nC =3\n'), ['A', 'B']);
  });

  it('reads dotted and bracketed process.env reads', () => {
    assert.deepEqual(readProcessEnvKeys("process.env.A; process.env['B']; process.env[x];"), [
      'A',
      'B',
    ]);
  });

  it('reads top-level compose services only', () => {
    assert.deepEqual(readComposeServices(COMPOSE), ['postgres', 'mailpit']);
  });
});
