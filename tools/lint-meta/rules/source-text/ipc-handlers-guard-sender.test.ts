import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFixture, runSync } from '../../test-support';
import { ipcHandlersGuardSenderRule } from './ipc-handlers-guard-sender';

const MAIN = 'apps/desktop/src/main';

function check(files: Record<string, string>) {
  return runSync(ipcHandlersGuardSenderRule, createFixture(files).context());
}

describe('ipc-handlers-guard-sender', () => {
  it('passes handlers whose first statement is the sender guard', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: `
        ipcMain.handle('store:get', async (event, key) => {
          if (!isSenderFrameAllowed(event)) throw new Error('forbidden');
          return store.get(key);
        });
        ipcMain.on('window:minimize', (event) => {
          if (!isSenderFrameAllowed(event)) return;
          win.minimize();
        });
      `,
    });

    assert.deepEqual(violations, []);
  });

  it('reports a handler with no guard, naming the channel and line', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: `\nipcMain.handle('store:set', async (event, key, value) => {\n  store.set(key, value);\n});\n`,
    });

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'ipc-handlers-guard-sender');
    assert.match(violations[0]?.message ?? '', /ipcMain\.handle\('store:set'\) at .*ipc\.ts:2/u);
    assert.match(violations[0]?.message ?? '', /does not start with/u);
  });

  it('reports a guard that only appears after other work has already run', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: `
        ipcMain.handle('dialog:open', async (event) => {
          const result = await dialog.showOpenDialog({});
          if (!isSenderFrameAllowed(event)) throw new Error('forbidden');
          return result;
        });
      `,
    });

    assert.equal(violations.length, 1);
  });

  it('reports an expression-bodied callback, which cannot hold a guard', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: "ipcMain.on('app:quit', () => app.quit());\n",
    });

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /no block-bodied callback/u);
  });

  it('is not fooled by the guard name in a comment or by a documented example', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: `
        // ipcMain.on('example', ...) is documented in security.ts
        ipcMain.handle('store:delete', async (event, key) => {
          // isSenderFrameAllowed(event) goes here, one day
          store.delete(key);
        });
      `,
    });

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /'store:delete'/u);
  });

  it('reports each unguarded registration, not just the first', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: `
        ipcMain.handle('a', async () => { return 1; });
        ipcMain.on('b', () => { doThing(); });
      `,
    });

    assert.equal(violations.length, 2);
  });

  it('reads a channel it cannot resolve as ?', () => {
    const violations = check({
      [`${MAIN}/ipc.ts`]: 'ipcMain.handle(CHANNEL, async () => { return 1; });\n',
    });

    assert.match(violations[0]?.message ?? '', /ipcMain\.handle\('\?'\)/u);
  });

  it('only scans the Electron main process', () => {
    const violations = check({
      'apps/desktop/src/renderer/ipc.ts': "ipcMain.handle('x', async () => { return 1; });\n",
      'apps/web/src/ipc.ts': "ipcMain.handle('x', async () => { return 1; });\n",
    });

    assert.deepEqual(violations, []);
  });
});
