import { assertKnownFlags, boolFlag, parseArgs, stringFlag } from './args';
import { stopWritingOnClosedPipe } from './cli-io';
import { laneDatabaseUrl, laneRedisUrl, mailpitHttpUrl, s3Endpoint } from './descriptor';
import { LANES, laneById } from './lanes';
import { createLanes, current, down, up } from './sandbox-lifecycle';

const USAGE = `Usage:
  pnpm sandbox:up                      start this worktree's sandbox (idempotent)
  pnpm sandbox:down [--id=<id>]        remove only this worktree's sandbox containers
  pnpm sandbox:inspect [--json]        show the running sandbox (no credentials)
  pnpm sandbox:inspect --lane-url=<lane>   print a lane's DATABASE_URL
  pnpm sandbox:inspect --redis-url=<lane>  print a lane's REDIS_URL

Lanes: ${LANES.map((lane) => lane.id).join(', ')}`;

function describe(root: string): number {
  const descriptor = current(root);
  if (descriptor === null) {
    process.stdout.write(
      'No sandbox is running for this worktree. Start one with `pnpm sandbox:up`.\n',
    );
    return 1;
  }

  const lines = [
    `sandbox ${descriptor.id} (created ${descriptor.createdAt})`,
    ...Object.entries(descriptor.services).map(
      ([role, service]) =>
        `  ${role.padEnd(9)} ${service.image}  ports ${Object.entries(service.ports)
          .map(([container, host]) => `${container}->127.0.0.1:${host}`)
          .join(' ')}`,
    ),
    `  lanes     ${LANES.map((lane) => `${lane.id}=${lane.database}(redis ${lane.redisDb})`).join(' ')}`,
    `  s3        ${s3Endpoint(descriptor)}`,
    `  mailpit   ${mailpitHttpUrl(descriptor)}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  const root = process.cwd();

  switch (parsed.command) {
    case 'up': {
      assertKnownFlags(parsed, [], USAGE);
      const existing = current(root);
      if (existing !== null) {
        // Idempotent: reuse the containers and reset the lane databases from
        // the template, which is what a second `up` is actually asking for.
        createLanes(existing);
        process.stdout.write(
          `Reusing sandbox ${existing.id}; lane databases recreated from the template.\n`,
        );
        return describe(root);
      }
      const result = await up(root);
      process.stdout.write(
        `Sandbox ${result.descriptor.id} up. Template migrated in ${result.migrateMs}ms, ${LANES.length} lanes created in ${result.lanesMs}ms.\nDescriptor: ${result.file}\n`,
      );
      return describe(root);
    }

    case 'down': {
      assertKnownFlags(parsed, ['id'], USAGE);
      const id = stringFlag(parsed, 'id');
      const result = down(root, id ?? undefined);
      process.stdout.write(
        `Removed ${result.containersRemoved} container(s) and ${result.descriptorsRemoved} descriptor(s) owned by this worktree.\n`,
      );
      return 0;
    }

    case 'inspect':
    case null: {
      assertKnownFlags(parsed, ['json', 'lane-url', 'redis-url'], USAGE);
      const laneUrl = stringFlag(parsed, 'lane-url');
      const redisUrl = stringFlag(parsed, 'redis-url');

      if (laneUrl !== null || redisUrl !== null) {
        const descriptor = current(root);
        if (descriptor === null) {
          return 1;
        }
        const lane = laneById(laneUrl ?? redisUrl ?? '');
        process.stdout.write(
          `${laneUrl !== null ? laneDatabaseUrl(descriptor, lane) : laneRedisUrl(descriptor, lane)}\n`,
        );
        return 0;
      }

      if (boolFlag(parsed, 'json')) {
        const descriptor = current(root);
        if (descriptor === null) {
          return 1;
        }
        // Redacted: the descriptor file is 0600 for a reason, and `inspect` is
        // routinely piped into a log or a report.
        process.stdout.write(
          `${JSON.stringify({ ...descriptor, password: '[redacted]' }, null, 2)}\n`,
        );
        return 0;
      }

      return describe(root);
    }

    default:
      process.stderr.write(`${USAGE}\n`);
      return 1;
  }
}

stopWritingOnClosedPipe();

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
