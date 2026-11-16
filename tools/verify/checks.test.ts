import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CHECKS, checksFor } from './checks';
import { LANES } from './lanes';

function manifestCommands(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'scripts', 'ci', 'pre-push.manifest.json'), 'utf8'),
  ) as { requiredCommands: string[] };
  return manifest.requiredCommands;
}

describe('verify profiles', () => {
  it('nests the profiles: static is part of feature, feature is part of release', () => {
    const ids = (profile: 'static' | 'feature' | 'release'): string[] =>
      checksFor(profile).map((check) => check.id);

    for (const id of ids('static')) {
      assert.ok(ids('feature').includes(id), `${id} is in static but not in feature`);
    }
    for (const id of ids('feature')) {
      assert.ok(ids('release').includes(id), `${id} is in feature but not in release`);
    }
    assert.ok(ids('release').length > ids('feature').length);
  });

  it('gives every check a unique id', () => {
    const ids = CHECKS.map((check) => check.id);

    assert.equal(new Set(ids).size, ids.length);
  });

  it('runs every pre-push manifest command in the release profile', () => {
    const covered = new Set(
      checksFor('release')
        .map((check) => check.manifestCommand)
        .filter((command): command is string => command !== undefined),
    );

    for (const command of manifestCommands()) {
      assert.ok(
        covered.has(command),
        `pre-push runs \`${command}\` but \`verify release\` does not`,
      );
    }
  });

  it('claims no manifest command the manifest does not list', () => {
    const commands = manifestCommands();

    for (const check of CHECKS) {
      if (check.manifestCommand !== undefined) {
        assert.ok(
          commands.includes(check.manifestCommand),
          `check ${check.id} claims \`${check.manifestCommand}\`, which pre-push.manifest.json does not list`,
        );
      }
    }
  });

  it('spells a manifest-bound check the same way the manifest does', () => {
    for (const check of CHECKS) {
      if (check.manifestCommand !== undefined) {
        assert.equal(check.command.join(' '), check.manifestCommand, `check ${check.id}`);
      }
    }
  });

  it('names a known lane on every check that needs a database', () => {
    const laneIds = LANES.map((lane) => lane.id);

    for (const check of CHECKS) {
      if (check.lane !== undefined) {
        assert.ok(laneIds.includes(check.lane), `check ${check.id} names an unknown lane`);
      }
    }
  });

  it('gives every check that is judged by a report the arguments that produce one', () => {
    for (const check of CHECKS) {
      if (check.report !== undefined && check.e2eLane !== true) {
        // Either spelled out, or the `{{reportPath}}` placeholder the runner
        // swaps for the absolute path (a lane command's cwd is its package, so
        // a relative path would land inside apps/api).
        assert.ok(
          check.report.args.some(
            (arg) => arg.includes(check.report?.file ?? '') || arg.includes('{{reportPath}}'),
          ),
          `check ${check.id} reads a report nothing tells its runner to write`,
        );
      }
    }
  });
});

describe('sandbox lanes', () => {
  it('gives each lane its own database and redis index', () => {
    assert.equal(new Set(LANES.map((lane) => lane.database)).size, LANES.length);
    assert.equal(new Set(LANES.map((lane) => lane.redisDb)).size, LANES.length);
  });

  it('never uses redis db 0, which is what an unconfigured URL selects', () => {
    assert.ok(LANES.every((lane) => lane.redisDb > 0));
  });
});
