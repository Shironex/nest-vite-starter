import { cpSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(__dirname, '../../web/dist');
const rendererDist = resolve(__dirname, '../dist/renderer');

if (!existsSync(webDist)) {
  console.warn('Warning: apps/web/dist not found. Build the web app first (pnpm --filter @repo/web build).');
  process.exit(0);
}

cpSync(webDist, rendererDist, { recursive: true });
console.log('Copied web dist to desktop dist/renderer');
