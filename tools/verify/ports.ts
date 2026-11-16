import { createServer } from 'node:net';

/*
 * A port the kernel just handed out and nothing is listening on. There is a
 * window between reserving and binding, which is why `vite preview` runs with
 * `--strictPort` and the API is probed on the port it was told to use: if
 * something else took it, the lane fails loudly instead of testing whatever
 * else answers there.
 */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a free port.')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
