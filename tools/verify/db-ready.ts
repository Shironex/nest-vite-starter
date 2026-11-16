import { postgresReady } from './net-probe';

/*
 * "Is there a Postgres accepting connections on host:port?", as a process, so
 * a shell gate can ask it. scripts/ci/pre-push.sh uses it to decide whether
 * the Prisma gates can run at all: a gate that did not run is INCOMPLETE, and
 * that verdict is only worth anything if the question was the real one.
 *
 * Exit 0 ready, 1 not ready (the reason goes to stdout), 2 bad usage.
 */
const USAGE = 'Usage: node --import tsx tools/verify/db-ready.ts <host> <port> [timeoutMs]';

async function main(): Promise<number> {
  const [host, port, timeout] = process.argv.slice(2);
  const portNumber = Number(port);
  if (host === undefined || !Number.isInteger(portNumber) || portNumber <= 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const timeoutMs = timeout === undefined ? undefined : Number(timeout);
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs <= 0)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const probe = await postgresReady(host, portNumber, timeoutMs);
  process.stdout.write(`${probe.reason}\n`);
  return probe.ready ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
