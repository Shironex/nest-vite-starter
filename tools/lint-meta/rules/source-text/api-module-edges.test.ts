import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, messages, runSync } from '../../test-support';
import {
  apiModuleEdgesRule,
  checkApiModuleEdges,
  edgesOf,
  isTypeOnlyClause,
} from './api-module-edges';

const MODULES = 'apps/api/src/modules';

describe('api-module-edges', () => {
  it("reports a value import of another module's repository", () => {
    const fixture = createFixture({
      [`${MODULES}/storage/some.router.ts`]:
        "import { UserRepository } from '../user/user.repository';\n",
    });

    assert.match(
      messages(runSync(apiModuleEdgesRule, fixture.context()))[0] ?? '',
      /Foreign repository: `\.\.\/user\/user\.repository`/u,
    );
  });

  it('allows a type-only import of a foreign repository, in both spellings', () => {
    const fixture = createFixture({
      [`${MODULES}/storage/a.service.ts`]:
        "import type { UserRow } from '../user/user.repository';\n",
      [`${MODULES}/storage/b.service.ts`]:
        "import { type UserRow, type OtherRow } from '../user/user.repository';\n",
    });

    assert.deepEqual(runSync(apiModuleEdgesRule, fixture.context()), []);
  });

  it('reports a reach into a foreign subdirectory', () => {
    // A path the real EDGE_EXCEPTIONS table does not name: the table is keyed
    // on repo-relative paths, so a fixture reusing one would be excepted.
    const fixture = createFixture({
      [`${MODULES}/storage/storage-reports.service.ts`]:
        "import { AvatarService } from '../user/avatar/avatar.service';\n",
    });

    assert.match(
      messages(runSync(apiModuleEdgesRule, fixture.context()))[0] ?? '',
      /Foreign subdirectory: `\.\.\/user\/avatar\/avatar\.service` reaches inside `user`/u,
    );
  });

  it('allows the sanctioned platform entry points', () => {
    const fixture = createFixture({
      [`${MODULES}/storage/storage.router.ts`]: [
        "import { AuthMiddleware } from '../auth/middleware/auth.middleware';",
        "import { SessionService } from '../auth/services/session.service';",
        '',
      ].join('\n'),
    });

    assert.deepEqual(runSync(apiModuleEdgesRule, fixture.context()), []);
  });

  it("allows another module's root, which is where its module and public surface live", () => {
    const fixture = createFixture({
      [`${MODULES}/user/user-purge.service.ts`]: [
        "import { STORAGE_LIMITS } from '../storage/storage.constants';",
        "import { EventsModule } from '../events/events.module';",
        '',
      ].join('\n'),
    });

    assert.deepEqual(runSync(apiModuleEdgesRule, fixture.context()), []);
  });

  it('ignores an import that leaves the module graph, because common/ is not a module', () => {
    const fixture = createFixture({
      [`${MODULES}/user/user.repository.ts`]:
        "import { PrismaService } from '../../common/database/prisma.service';\n",
    });

    assert.deepEqual(runSync(apiModuleEdgesRule, fixture.context()), []);
  });

  it('ignores specs, which build fixtures out of whatever module defines the type', () => {
    const fixture = createFixture({
      [`${MODULES}/storage/storage.service.spec.ts`]:
        "import { AvatarService } from '../user/avatar/avatar.service';\n",
    });

    assert.deepEqual(runSync(apiModuleEdgesRule, fixture.context()), []);
  });

  it('reports an EDGE_EXCEPTIONS entry whose import is gone, so a paid debt leaves the table', () => {
    // The real table is empty, so the entry is the test's own: a recorded
    // `storage/storage.module.ts` -> `user/user.repository` edge, in a tree
    // where that file exists without the import. That is the tree after the
    // cleanup, and the entry has to go with it.
    const exceptions = [
      {
        from: 'storage/storage.module.ts',
        to: 'user/user.repository',
        rule: 'foreign-repository',
        reason: 'fixture',
      },
    ] as const;
    const fixture = createFixture({
      [`${MODULES}/storage/storage.module.ts`]: "import { Module } from '@nestjs/common';\n",
    });

    assert.match(
      checkApiModuleEdges(fixture.context().sourceFiles, exceptions)[0]?.message ?? '',
      /Stale EDGE_EXCEPTIONS entry: `storage\/storage\.module\.ts`/u,
    );
  });

  it('lets a recorded exception through, and only the one recorded', () => {
    const exceptions = [
      {
        from: 'storage/storage.module.ts',
        to: 'user/user.repository',
        rule: 'foreign-repository',
        reason: 'fixture',
      },
    ] as const;
    const fixture = createFixture({
      [`${MODULES}/storage/storage.module.ts`]:
        "import { UserRepository } from '../user/user.repository';\n",
      [`${MODULES}/storage/storage.router.ts`]:
        "import { UserRepository } from '../user/user.repository';\n",
    });

    const violations = checkApiModuleEdges(fixture.context().sourceFiles, exceptions);
    assert.equal(violations.length, 1);
    assert.match(violations[0]?.file ?? '', /storage\/storage\.router\.ts$/u);
  });

  it('ships an empty exceptions table, so the real tree has no recorded break', () => {
    const fixture = createFixture({
      [`${MODULES}/storage/storage.router.ts`]:
        "import { UserRepository } from '../user/user.repository';\n",
      [`${MODULES}/storage/storage.constants.ts`]:
        "import { AVATAR_SIZES } from '../user/avatar/avatar.constants';\n",
    });

    assert.equal(runSync(apiModuleEdgesRule, fixture.context()).length, 2);
  });

  it('exposes the same check the rule runs', () => {
    const fixture = createFixture({
      [`${MODULES}/storage/x.service.ts`]:
        "import { UserRepository } from '../user/user.repository';\n",
    });

    assert.equal(checkApiModuleEdges(fixture.context().sourceFiles).length, 1);
  });
});

describe('edgesOf', () => {
  it('does not let a non-relative type import lend its `type` to the value import after it', () => {
    const [edge] = edgesOf(
      'storage/x.router.ts',
      "import type { Readable } from 'node:stream';\nimport { UserRepository } from '../user/user.repository';\n",
    );

    assert.equal(edge?.to, 'user/user.repository');
    assert.equal(edge?.typeOnly, false);
  });

  it('still reads a type-only import as type-only after a non-relative value import', () => {
    const [edge] = edgesOf(
      'storage/x.router.ts',
      "import { Logger } from '@nestjs/common';\nimport type { UserRepository } from '../user/user.repository';\n",
    );

    assert.equal(edge?.typeOnly, true);
  });

  it('reads a multi-line clause', () => {
    const edges = edgesOf(
      'storage/x.ts',
      "import {\n  A,\n  type B,\n} from '../user/user.public';\n",
    );

    assert.equal(edges.length, 1);
    assert.equal(edges[0]?.to, 'user/user.public');
  });
});

describe('isTypeOnlyClause', () => {
  it('reads both type-only spellings and neither value spelling', () => {
    assert.equal(isTypeOnlyClause(' type { A }'), true);
    assert.equal(isTypeOnlyClause('{ type A, type B }'), true);
    assert.equal(isTypeOnlyClause('{ type A, B }'), false);
    assert.equal(isTypeOnlyClause('{ A }'), false);
    assert.equal(isTypeOnlyClause(' A'), false);
    assert.equal(isTypeOnlyClause('{}'), false);
  });
});
