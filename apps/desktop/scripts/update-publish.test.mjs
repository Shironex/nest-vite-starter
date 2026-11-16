import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPackagingCommand, readPublishPolicy, resolvePublishConfig } from './update-publish.mjs';

const CLI = ['node', 'electron-builder', '--mac', '--arm64'];
const ENV = { S3_UPDATE_BUCKET: 'test-bucket', S3_UPDATE_REGION: 'eu-central-1' };

describe('readPublishPolicy', () => {
  it('reads every flag spelling the CLI accepts', () => {
    assert.equal(readPublishPolicy([...CLI, '--publish', 'never']), 'never');
    assert.equal(readPublishPolicy([...CLI, '--publish=always']), 'always');
    assert.equal(readPublishPolicy([...CLI, '-p', 'onTag']), 'onTag');
    assert.equal(readPublishPolicy([...CLI, '-p=never']), 'never');
  });

  it('returns undefined when no policy is passed', () => {
    assert.equal(readPublishPolicy(CLI), undefined);
  });

  it('lets the last occurrence win', () => {
    assert.equal(readPublishPolicy([...CLI, '--publish', 'never', '-p', 'always']), 'always');
  });
});

describe('resolvePublishConfig', () => {
  it('builds the S3 block from the environment, not a placeholder', () => {
    assert.deepEqual(resolvePublishConfig({ env: ENV, argv: CLI }), {
      provider: 's3',
      bucket: 'test-bucket',
      region: 'eu-central-1',
      path: '/releases',
      acl: 'public-read',
    });
  });

  it('keeps the S3 block on a --publish never build when the env is set', () => {
    const config = resolvePublishConfig({ env: ENV, argv: [...CLI, '--publish', 'never'] });
    assert.equal(config?.bucket, 'test-bucket');
  });

  it('drops the publish block for an explicit --publish never with neither variable set', () => {
    assert.equal(resolvePublishConfig({ env: {}, argv: [...CLI, '--publish', 'never'] }), null);
  });

  it('throws when the policy is implicit, since CI and tags publish implicitly', () => {
    assert.throws(
      () => resolvePublishConfig({ env: {}, argv: CLI }),
      /S3_UPDATE_BUCKET and S3_UPDATE_REGION not set/,
    );
  });

  it('throws on an explicit publishing policy without the env', () => {
    assert.throws(
      () => resolvePublishConfig({ env: {}, argv: [...CLI, '--publish', 'always'] }),
      /publish policy: always/,
    );
  });

  it('treats a blank value as unset', () => {
    assert.throws(
      () => resolvePublishConfig({ env: { ...ENV, S3_UPDATE_REGION: '  ' }, argv: CLI }),
      /S3_UPDATE_REGION not set/,
    );
  });

  it('throws on a half-configured feed even with --publish never', () => {
    assert.throws(
      () =>
        resolvePublishConfig({
          env: { S3_UPDATE_BUCKET: 'test-bucket' },
          argv: [...CLI, '--publish', 'never'],
        }),
      /Set both or neither/,
    );
  });
});

describe('isPackagingCommand', () => {
  it('treats the default build as packaging', () => {
    assert.equal(isPackagingCommand(CLI), true);
    assert.equal(isPackagingCommand(['node', 'electron-builder']), true);
  });

  it('treats install-app-deps and the other helper subcommands as non-packaging', () => {
    for (const command of [
      'install-app-deps',
      'node-gyp-rebuild',
      'create-self-signed-cert',
      'start',
    ]) {
      assert.equal(isPackagingCommand(['node', 'electron-builder', command]), false, command);
    }
  });
});

describe('resolvePublishConfig outside packaging', () => {
  it('does not require the update feed for the postinstall install-app-deps run', () => {
    // The desktop postinstall runs this on every `pnpm install`, where the feed is unset.
    assert.equal(
      resolvePublishConfig({ env: {}, argv: ['node', 'electron-builder', 'install-app-deps'] }),
      null,
    );
  });
});
