/**
 * Builds electron-builder's `publish` block for the S3 auto-update feed.
 *
 * electron-builder does not expand `${NAME}` in the publish block, so the old
 * JSON config shipped an app-update.yml naming a bucket literally called
 * `${S3_UPDATE_BUCKET}`. The values now come from the environment
 * here, and a build that could publish or ship an updater feed without them
 * fails before packaging starts.
 *
 * The one build allowed without them is an explicit `--publish never` with
 * NEITHER variable set: it gets no publish block, so the packaged app carries
 * no app-update.yml at all and the updater reports an error instead of
 * polling a wrong bucket. Anything short of an explicit `never` counts as
 * publishing, because electron-builder 26 also publishes implicitly on CI, on
 * a git tag and under an npm `release` script.
 */

const UPDATE_ENV_VARS = ['S3_UPDATE_BUCKET', 'S3_UPDATE_REGION'];

/**
 * electron-builder subcommands that load this config but never package or
 * publish. `install-app-deps` runs as the desktop postinstall on every
 * `pnpm install`, including CI and fresh worktrees, where the update feed is
 * rightly unset; refusing there would break installing the repo.
 */
const NON_PACKAGING_COMMANDS = new Set([
  'install-app-deps',
  'node-gyp-rebuild',
  'create-self-signed-cert',
  'start',
]);

/**
 * Whether the electron-builder invocation in `argv` packages the app. A
 * subcommand, when present, is the first argument after the script path.
 *
 * @param {readonly string[]} argv
 * @returns {boolean}
 */
export function isPackagingCommand(argv) {
  return !argv.slice(2).some((arg) => NON_PACKAGING_COMMANDS.has(arg));
}

/**
 * The publish policy passed on the electron-builder command line, or
 * `undefined` when none was. Accepts `--publish x`, `--publish=x`, `-p x` and
 * `-p=x`; the last occurrence wins, as it does for the CLI parser.
 *
 * @param {readonly string[]} argv
 * @returns {string | undefined}
 */
export function readPublishPolicy(argv) {
  let policy;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = /^(?:--publish|-p)=(.*)$/.exec(arg);
    if (inline) {
      policy = inline[1];
    } else if (arg === '--publish' || arg === '-p') {
      policy = argv[i + 1];
      i++;
    }
  }
  return policy;
}

/**
 * @param {{ env: Record<string, string | undefined>, argv: readonly string[] }} input
 * @returns {{ provider: 's3', bucket: string, region: string, path: string, acl: string } | null}
 */
export function resolvePublishConfig({ env, argv }) {
  if (!isPackagingCommand(argv)) {
    return null;
  }

  const bucket = env.S3_UPDATE_BUCKET?.trim() ?? '';
  const region = env.S3_UPDATE_REGION?.trim() ?? '';

  if (bucket !== '' && region !== '') {
    return { provider: 's3', bucket, region, path: '/releases', acl: 'public-read' };
  }

  const missing = UPDATE_ENV_VARS.filter((name) => (env[name]?.trim() ?? '') === '');
  const policy = readPublishPolicy(argv);
  if (policy === 'never' && missing.length === UPDATE_ENV_VARS.length) {
    return null;
  }

  const reason =
    policy === 'never'
      ? 'Set both or neither: a half-configured update feed is a mistake, not a local build.'
      : `This build can publish (publish policy: ${policy ?? 'implicit'}) and would ship an app-update.yml without a real bucket. ` +
        'For a local build with no update feed, pass --publish never and leave both unset.';
  throw new Error(`Desktop update feed: ${missing.join(' and ')} not set. ${reason}`);
}
