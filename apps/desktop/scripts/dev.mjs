/**
 * Desktop dev script: starts the API server, Vite dev server (for renderer HMR),
 * waits for both to be ready, then launches Electron.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const API_PORT = 3000;
const VITE_PORT = 5173;
const API_URL = `http://localhost:${API_PORT}/health`;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const MAX_WAIT = 30_000; // 30 seconds

function waitForUrl(url, label) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > MAX_WAIT) {
        reject(new Error(`${label} did not start within ${MAX_WAIT / 1000}s`));
        return;
      }
      const req = request(url, { method: 'HEAD' }, (res) => {
        if (res.statusCode) resolve();
        else setTimeout(check, 300);
      });
      req.on('error', () => setTimeout(check, 300));
      req.end();
    };
    check();
  });
}

// Start API server
const api = spawn('pnpm', ['--filter', '@repo/api', 'dev'], {
  stdio: 'inherit',
  env: { ...process.env },
});

// Start Vite dev server from the web app
const vite = spawn('pnpm', ['--filter', '@repo/web', 'dev'], {
  stdio: 'inherit',
  env: { ...process.env },
});

console.log('Waiting for API and Vite dev servers...');

try {
  await Promise.all([waitForUrl(API_URL, 'API server'), waitForUrl(VITE_URL, 'Vite dev server')]);
  console.log(`API ready at http://localhost:${API_PORT}`);
  console.log(`Vite ready at ${VITE_URL}`);
} catch (err) {
  console.error(err.message);
  api.kill();
  vite.kill();
  process.exit(1);
}

// Launch Electron
const electron = spawn('npx', ['cross-env', 'NODE_ENV=development', 'electron', '.'], {
  stdio: 'inherit',
  env: { ...process.env },
});

electron.on('exit', (code) => {
  api.kill();
  vite.kill();
  process.exit(code ?? 0);
});

// Forward signals to clean up all processes
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    electron.kill(signal);
    api.kill(signal);
    vite.kill(signal);
  });
}
