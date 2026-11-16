import { readFileSync } from 'node:fs';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'ipc-handlers-guard-sender';

/** Only the Electron main process registers IPC handlers. */
const SCANNED_PATH = 'apps/desktop/src/main/';

const GUARD = 'isSenderFrameAllowed';

/*
 * Every `ipcMain.handle` and `ipcMain.on` must check the sender frame first.
 *
 * `apps/desktop/src/main/security.ts` states that as the rule, and a statement
 * in a doc comment binds whoever happens to read it. Sixteen channels reach
 * the OS from the renderer here (the electron-store read/write/delete, four
 * updater channels, three native dialogs, a desktop notification, four window
 * controls and the two `app:*` getters), and each new one is written by
 * someone who may never open security.ts. That is what lint-meta is for.
 *
 * The risk this closes is second-order: `will-navigate` and
 * `setWindowOpenHandler` keep foreign content out of the window, so there is
 * no hostile frame to abuse. It stops being second-order the day a feature
 * renders remote content in a frame, and that is exactly the day nobody
 * re-reads the IPC layer.
 *
 * The check is textual and deliberately blunt: inside the callback passed to
 * `ipcMain.handle` / `ipcMain.on`, the FIRST statement must mention the guard.
 * "First" matters. A guard placed after an await, a store read or a dialog
 * open has already done the thing it was meant to prevent.
 */

interface IpcRegistration {
  /** `handle` or `on`, for the message. */
  readonly kind: string;
  /** Channel name when it is a plain literal, else `?`. */
  readonly channel: string;
  /** 1-based line of the registration, for the message. */
  readonly line: number;
  /** Text of the callback body, or null when the callback cannot be located. */
  readonly body: string | null;
}

/**
 * A copy of `source` with line and block comments replaced by spaces.
 *
 * Offsets are preserved so a line number computed on the blanked text is the
 * line number in the real file. Without this the scan trips over its own
 * documentation: `security.ts` carries two worked examples of the guard in a
 * doc comment, and updater.ts explains itself with the words "ipcMain.on".
 * String literals are left intact because the channel name is read from them.
 */
function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }

    if (two === '/*') {
      while (i < source.length && source.slice(i, i + 2) !== '*/') {
        if (source[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      for (let j = i; j < Math.min(i + 2, source.length); j++) out[j] = ' ';
      i += 2;
      continue;
    }

    const quote = source[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i += 1;
      while (i < source.length && source[i] !== quote) {
        i += source[i] === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

/** Index of the `char`-closing bracket matching the opener at `open`. */
function matchingBracket(source: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every `ipcMain.handle(...)` / `ipcMain.on(...)` in `source`.
 *
 * Brace-balanced rather than regex-matched: a handler body spans lines and
 * carries its own braces, template literals and nested arrow functions, so a
 * regex either stops at the first `}` or runs to the end of the file. A
 * registration whose body cannot be located reports rather than passing, which
 * is the fail-closed direction.
 */
function findRegistrations(source: string): IpcRegistration[] {
  const found: IpcRegistration[] = [];
  const call = /\bipcMain\.(handle|on)\s*\(/gu;

  for (const match of source.matchAll(call)) {
    const kind = match[1] ?? '';
    const openParen = match.index + match[0].length - 1;
    const closeParen = matchingBracket(source, openParen, '(', ')');
    const args =
      closeParen === -1 ? source.slice(openParen + 1) : source.slice(openParen + 1, closeParen);

    const channel = /^\s*['"`]([^'"`]+)['"`]/u.exec(args)?.[1] ?? '?';
    const line = source.slice(0, match.index).split('\n').length;

    // The callback body is the first `{` that opens a block after the channel
    // argument. An expression-bodied arrow (`() => foo()`) has none, and cannot
    // contain a guard, so it reports as a missing guard rather than as unparseable.
    const bodyOpen = args.indexOf('{');
    if (bodyOpen === -1) {
      found.push({ kind, channel, line, body: null });
      continue;
    }
    const bodyClose = matchingBracket(args, bodyOpen, '{', '}');
    found.push({
      kind,
      channel,
      line,
      body: bodyClose === -1 ? null : args.slice(bodyOpen + 1, bodyClose),
    });
  }

  return found;
}

/** The first non-blank line of a callback body (comments arrive blanked). */
function firstStatement(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length > 0) return line;
  }
  return '';
}

export function checkIpcHandlersGuardSender(ctx: IMetaContext): IViolation[] {
  const violations: IViolation[] = [];

  for (const absolute of ctx.sourceFiles) {
    const file = absolute.replace(/\\/gu, '/');
    if (!file.includes(SCANNED_PATH)) continue;

    const relative = file.slice(file.indexOf(SCANNED_PATH));
    const source = blankComments(readFileSync(absolute, 'utf8'));
    if (!source.includes('ipcMain.')) continue;

    for (const registration of findRegistrations(source)) {
      const where = `ipcMain.${registration.kind}('${registration.channel}') at ${relative}:${String(registration.line)}`;

      if (registration.body === null) {
        violations.push({
          file: relative,
          rule: RULE_ID,
          message: `${where} has no block-bodied callback, so it cannot start with the ${GUARD}(event) check. Give it a block body whose first statement is the guard.`,
        });
        continue;
      }

      if (!firstStatement(registration.body).includes(GUARD)) {
        violations.push({
          file: relative,
          rule: RULE_ID,
          message: `${where} does not start with \`if (!${GUARD}(event))\`. Any frame in the app can reach this channel otherwise. Add the guard as the FIRST statement (a check after an await has already done the work it guards), returning for \`on\` and throwing for \`handle\`.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Every Electron IPC entry point checks its sender frame first.
 *
 * The desktop main process is the only code in the repo that runs outside the
 * browser sandbox: an IPC channel is a direct call from the renderer into the
 * OS. `security.ts` documents the guard; this makes it enforceable.
 */
export const ipcHandlersGuardSenderRule: IMetaRule = {
  id: RULE_ID,
  category: 'source-text',
  ciCritical: true,
  description:
    'Every ipcMain.handle / ipcMain.on in apps/desktop must start with the isSenderFrameAllowed(event) guard.',
  run: checkIpcHandlersGuardSender,
};
