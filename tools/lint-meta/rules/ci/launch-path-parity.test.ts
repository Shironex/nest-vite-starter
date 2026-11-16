import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, type IFixture } from '../../test-support';
import { checkLaunchPathParity, launchPathParityRule } from './launch-path-parity';

const ENTRY = 'dist/src/main.js';

function apiPackage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: '@repo/api',
    main: ENTRY,
    exports: { '.': { default: `./${ENTRY}` } },
    scripts: { start: 'node dist/src/main', 'start:prod': 'node dist/src/main' },
    ...overrides,
  });
}

/** A fixture whose launch references all agree, plus per-test extra files. */
function fixtureWith(extra: Record<string, string> = {}): IFixture {
  return createFixture({
    'apps/api/nest-cli.json': JSON.stringify({ sourceRoot: 'src' }),
    'apps/api/package.json': apiPackage(),
    'apps/api/Dockerfile': `FROM node:22\nCMD ["node", "apps/api/${ENTRY}"]\n`,
    '.github/workflows/ci.yml': `jobs:\n  boot:\n    steps:\n      - run: node apps/api/${ENTRY}\n`,
    ...extra,
  });
}

function run(fixture: IFixture) {
  return checkLaunchPathParity(fixture.context());
}

describe('launch-path-parity', () => {
  it('passes when package.json, the Dockerfile and CI all name the emitted entrypoint', () => {
    assert.deepEqual(run(fixtureWith()), []);
  });

  it('reports a package.json main that drifted from the emitted path', () => {
    const fixture = fixtureWith({ 'apps/api/package.json': apiPackage({ main: 'dist/main.js' }) });

    const violations = run(fixture);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'launch-path-parity');
    assert.match(
      violations[0]?.message ?? '',
      /"main" is "dist\/main\.js", expected "dist\/src\/main\.js"/u,
    );
  });

  it('reports a wrong exports default and a start script that launches the wrong file', () => {
    const fixture = fixtureWith({
      'apps/api/package.json': apiPackage({
        exports: { '.': { default: './dist/main.js' } },
        scripts: { start: 'node dist/main', 'start:prod': 'node dist/src/main' },
      }),
    });

    const messages = run(fixture).map((violation) => violation.message);

    assert.equal(messages.length, 2);
    assert.match(messages.join('\n'), /exports\["\."\]\.default is "\.\/dist\/main\.js"/u);
    assert.match(messages.join('\n'), /script "start" is "node dist\/main"/u);
  });

  it('reports a Dockerfile that launches a different path', () => {
    const fixture = fixtureWith({
      'apps/api/Dockerfile': 'FROM node:22\nCMD ["node", "apps/api/dist/main.js"]\n',
    });

    const violations = run(fixture);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /Dockerfile launches "apps\/api\/dist\/main\.js"/u);
  });

  it('reports a Dockerfile that has no node main.js command at all', () => {
    const fixture = fixtureWith({ 'apps/api/Dockerfile': 'FROM node:22\nCMD ["pnpm", "start"]\n' });

    assert.match(run(fixture)[0]?.message ?? '', /No `node \.\.\.\/main\.js` CMD found/u);
  });

  it('allows a missing Dockerfile', () => {
    const fixture = createFixture({
      'apps/api/nest-cli.json': JSON.stringify({ sourceRoot: 'src' }),
      'apps/api/package.json': apiPackage(),
    });

    assert.deepEqual(run(fixture), []);
  });

  it('reports a CI boot step that starts the API from a drifted path', () => {
    const fixture = fixtureWith({
      '.github/workflows/ci.yml': 'steps:\n  - run: node apps/api/dist/main.js\n',
    });

    const violations = run(fixture);

    assert.equal(violations.length, 1);
    assert.match(
      violations[0]?.message ?? '',
      /CI boots the API with "apps\/api\/dist\/main\.js"/u,
    );
  });

  it('follows the sourceRoot in nest-cli.json rather than assuming src', () => {
    const fixture = fixtureWith({
      'apps/api/nest-cli.json': JSON.stringify({ sourceRoot: 'app' }),
    });

    // Every reference still says dist/src, which is now the drift.
    assert.ok(run(fixture).length >= 3);
    assert.match(run(fixture)[0]?.message ?? '', /expected "dist\/app\/main\.js"/u);
  });

  it('reports a missing or unparseable apps/api/package.json', () => {
    const missing = createFixture();
    const broken = createFixture({ 'apps/api/package.json': '{ nope' });

    for (const fixture of [missing, broken]) {
      assert.match(
        run(fixture)[0]?.message ?? '',
        /apps\/api\/package\.json is missing or unparseable/u,
      );
    }
  });

  it('is what the registered rule runs', () => {
    const fixture = fixtureWith({ 'apps/api/package.json': apiPackage({ main: 'nope.js' }) });

    assert.equal(launchPathParityRule.run?.(fixture.context()).length, 1);
  });
});
