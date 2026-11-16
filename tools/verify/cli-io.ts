/*
 * A reader that closes the pipe first (`pnpm sandbox:inspect | head -1`) makes
 * the next write raise EPIPE, which node turns into an unhandled 'error' event
 * and a stack trace. Nothing went wrong: the consumer has what it asked for, so
 * the right response is to stop writing. Any other stream error still throws.
 */
export function stopWritingOnClosedPipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') {
        throw error;
      }
      process.exit(0);
    });
  }
}
