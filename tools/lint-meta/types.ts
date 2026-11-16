/*
 * Categories trimmed to what this monorepo actually uses.
 */
export type MetaRuleCategory = 'config' | 'source-text' | 'supply-chain' | 'ci' | 'testing';

export interface IViolation {
  readonly file: string;
  readonly rule: string;
  readonly message: string;
}

/** What a rule's `exec` gets back. A failed command is a code, never a throw. */
export interface IExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/*
 * The context every rule is handed.
 *
 * It is a SUPERSET of the `@noctcore/harness` `IMetaCtx`
 * (`{ root, read, exists, glob, exec }`), so a rule written against the harness
 * runs on it unchanged and a rule written here loses nothing but the two
 * pre-collected file lists when it moves upstream. The harness runs the
 * registry and hands each rule its own `IMetaCtx`; `adoptLocalRule` in
 * `tools/lint-meta/harness.ts` builds this context from it, and the
 * compile-time proof that the two still line up lives there too.
 *
 * `sourceFiles` and `workflowFiles` stay because 30-odd rules read them and
 * because collecting them once per run, rather than once per rule, is what
 * keeps `pnpm lint:meta` cheap enough to sit in the pre-push hook.
 */
export interface IMetaContext {
  /** Absolute repo root every relative path resolves against. */
  readonly root: string;
  /** Every first-party `.ts`/`.tsx` file, as absolute paths (see context.ts). */
  readonly sourceFiles: readonly string[];
  /** Every `.github/workflows/*.y(a)ml`, as absolute paths. */
  readonly workflowFiles: readonly string[];
  /** Read a repo-relative file (LF-normalized), or `null` if it does not exist. */
  read(rel: string): string | null;
  /** Whether a repo-relative path exists. */
  exists(rel: string): boolean;
  /** Glob repo-relative paths (cwd = {@link IMetaContext.root}). */
  glob(pattern: string): string[];
  /** Run a shell command at {@link IMetaContext.root}; never throws. */
  exec(cmd: string): IExecResult;
}

export interface IMetaRule {
  readonly id: string;
  readonly category: MetaRuleCategory;
  readonly description: string;
  /*
   * Whether a violation must red the build. The harness's exit code is driven
   * by it, so every rule sets it: `tools/lint-meta/registry.ts` refuses to load
   * a rule that does not (see `assertEveryRuleBlocks` in harness.ts).
   */
  readonly ciCritical?: boolean;
  // A rule provides `run` (sync), `runAsync` (async), or both, the same shape
  // as the harness contract. Both passes run on every `pnpm lint:meta`; a rule
  // that needs ESLint's resolved config (eslint-config-no-warn) is async-only.
  run?: (ctx: IMetaContext) => IViolation[];
  runAsync?: (ctx: IMetaContext) => Promise<IViolation[]>;
}
