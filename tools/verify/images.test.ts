import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseServiceImages } from './images';

const WORKFLOW = `jobs:
  test-api:
    services:
      postgres:
        image: postgres:17-alpine
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
      s3:
        # A comment inside the block must not be read as a service.
        image: ghcr.io/clockwisesoftware/s3rver:latest
        options: --workdir /app
      mailpit:
        image: axllent/mailpit
    steps:
      - run: echo image: not-a-service
`;

describe('CI service images', () => {
  it('reads every service image out of a services block', () => {
    assert.deepEqual(parseServiceImages(WORKFLOW), {
      postgres: 'postgres:17-alpine',
      redis: 'redis:7-alpine',
      s3: 'ghcr.io/clockwisesoftware/s3rver:latest',
      mailpit: 'axllent/mailpit',
    });
  });

  it('accepts a digest pin', () => {
    const pinned = WORKFLOW.replace('postgres:17-alpine', 'postgres:17-alpine@sha256:abc');

    assert.equal(parseServiceImages(pinned).postgres, 'postgres:17-alpine@sha256:abc');
  });

  it('refuses to guess when a service is missing', () => {
    assert.throws(
      () =>
        parseServiceImages(
          WORKFLOW.replace('      mailpit:\n        image: axllent/mailpit\n', ''),
        ),
      /mailpit/u,
    );
  });

  it('refuses to choose when two jobs pin the same service differently', () => {
    const drifted = `${WORKFLOW}\n  boot-smoke:\n    services:\n      postgres:\n        image: postgres:16-alpine\n      redis:\n        image: redis:7-alpine\n      s3:\n        image: ghcr.io/clockwisesoftware/s3rver:latest\n      mailpit:\n        image: axllent/mailpit\n`;

    assert.throws(() => parseServiceImages(drifted), /more than one image/u);
  });

  it('parses the live CI workflow, which is what the sandbox actually runs', () => {
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
    const images = parseServiceImages(workflow);

    assert.match(images.postgres, /^postgres:/u);
    assert.match(images.redis, /^redis:/u);
    assert.match(images.s3, /s3rver/u);
    assert.match(images.mailpit, /mailpit/u);
  });
});
