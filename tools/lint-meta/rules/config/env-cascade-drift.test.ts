import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { envCascadeDriftRule, readConfigKeys } from './env-cascade-drift';

const SCHEMA = 'apps/api/src/config/configuration.config.ts';

const SCHEMA_SOURCE = `
  export const validationSchema = Joi.object({
    DATABASE_URL: Joi.string().required(),
    REDIS_URL: Joi.string().required(),
    port: Joi.number(),
    SESSION_SECRET: Joi.string().min(32),
  });
`;

describe('env-cascade-drift', () => {
  it('reports a schema key that .env.example does not document', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': 'DATABASE_URL=postgres://x\nSESSION_SECRET=changeme\n',
    });

    const violations = runSync(envCascadeDriftRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'env-cascade-drift');
    assert.match(violations[0]?.message ?? '', /`REDIS_URL` is validated by the Joi schema/u);
  });

  it('passes when every upper-case schema key is documented', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': 'DATABASE_URL=a\nREDIS_URL=b\nSESSION_SECRET=c\n',
    });

    assert.deepEqual(runSync(envCascadeDriftRule, fixture.context()), []);
  });

  it('does not count a commented-out or blank line as documentation', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': '# REDIS_URL=b\n\nDATABASE_URL=a\nSESSION_SECRET=c\n',
    });

    const violations = runSync(envCascadeDriftRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /`REDIS_URL`/u);
  });

  it('does not require .env.example keys the schema never reads (the reverse direction)', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example':
        'DATABASE_URL=a\nREDIS_URL=b\nSESSION_SECRET=c\nVITE_API_URL=x\nPOSTGRES_PASSWORD=y\n',
    });

    assert.deepEqual(runSync(envCascadeDriftRule, fixture.context()), []);
  });

  it('is dormant when either the schema or .env.example is missing', () => {
    const noExample = createFixture({ [SCHEMA]: SCHEMA_SOURCE });
    const noSchema = createFixture({ '.env.example': 'A=1\n' });

    assert.deepEqual(runSync(envCascadeDriftRule, noExample.context()), []);
    assert.deepEqual(runSync(envCascadeDriftRule, noSchema.context()), []);
  });

  it('reports a ConfigService read the Joi schema never declares', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': 'DATABASE_URL=a\nREDIS_URL=b\nSESSION_SECRET=c\n',
      'apps/api/src/modules/mail/mail.service.ts':
        "const host = this.configService.getOrThrow<string>('SMTP_HOST');\nexport { host };\n",
    });

    const violations = runSync(envCascadeDriftRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'env-cascade-drift');
    assert.equal(violations[0]?.file, 'apps/api/src/modules/mail/mail.service.ts');
    assert.match(
      violations[0]?.message ?? '',
      /`SMTP_HOST` is read from the ConfigService but is not declared in the Joi schema/u,
    );
  });

  it('passes a read the schema declares, in every accessor and receiver shape', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': 'DATABASE_URL=a\nREDIS_URL=b\nSESSION_SECRET=c\n',
      'apps/api/src/a.ts': [
        "const a = configService.get<string>('DATABASE_URL');",
        "const b = this.configService.getOrThrow<string>('REDIS_URL');",
        "const c = config.get('SESSION_SECRET');",
        'export { a, b, c };',
        '',
      ].join('\n'),
    });

    assert.deepEqual(runSync(envCascadeDriftRule, fixture.context()), []);
  });

  it('resolves a read given a constant declared in the same file', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': 'DATABASE_URL=a\nREDIS_URL=b\nSESSION_SECRET=c\n',
      'apps/api/src/armed.ts': [
        "export const ARM_KEY = 'PURGE_SWEEP_ENABLED';",
        'export const armed = configService.get(ARM_KEY);',
        '',
      ].join('\n'),
    });

    const violations = runSync(envCascadeDriftRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /`PURGE_SWEEP_ENABLED` is read/u);
  });

  it('ignores api specs, which mock the ConfigService with keys production never reads', () => {
    const fixture = createFixture({
      [SCHEMA]: SCHEMA_SOURCE,
      '.env.example': 'DATABASE_URL=a\nREDIS_URL=b\nSESSION_SECRET=c\n',
      'apps/api/src/a.spec.ts': "configService.get('MADE_UP_FOR_THE_MOCK');\n",
    });

    assert.deepEqual(runSync(envCascadeDriftRule, fixture.context()), []);
  });
});

describe('readConfigKeys', () => {
  it('reads every accessor and quoting shape, deduplicated and sorted', () => {
    const keys = readConfigKeys(
      [
        "configService.get<string>('NODE_ENV');",
        "this.configService.getOrThrow<number>('SMTP_PORT');",
        'config.get("EMAIL_PROVIDER");',
        "configService.get<string>('NODE_ENV', 'development');",
        '',
      ].join('\n'),
    );

    assert.deepEqual(keys, ['EMAIL_PROVIDER', 'NODE_ENV', 'SMTP_PORT']);
  });

  it('leaves every other .get() alone, and never invents a key it cannot resolve', () => {
    const keys = readConfigKeys(
      [
        'const service = app.get(ConfigService);',
        "const handler = this.handlers.get('SOME_EVENT');",
        "const meta = reflector.get<string>('ROLES', context.getHandler());",
        'const armed = configService.get(IMPORTED_FROM_ANOTHER_MODULE);',
        '',
      ].join('\n'),
    );

    assert.deepEqual(keys, []);
  });
});
