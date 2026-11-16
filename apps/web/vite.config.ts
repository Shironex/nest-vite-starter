import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'path';

// The web app talks to the API same-origin via relative `/trpc` (see
// src/lib/electron.ts getTrpcUrl). Both the dev server and `vite preview`
// (used by the CI e2e job to serve the built app) proxy those paths to the
// API so the SPA reaches it without a CORS hop.
//
// The target is resolved, strongest first, from `VITE_API_PROXY_TARGET`, then
// `http://localhost:<PORT>` with the same `PORT` the API reads, then :3000.
// Each is taken from the real process env first, then from the workspace-root
// `.env` (the API's source of truth, see `.env.example`), because vite's own
// envDir here is apps/web, which has no `.env`. That is what lets a second
// worktree move its API AND its UI proxy with one `PORT` line, instead of
// silently proxying to the first worktree's API.
//
// The root `.env` is parsed, NOT passed to vite's `loadEnv`: `loadEnv` copies
// the file's `NODE_ENV=development` into `VITE_USER_NODE_ENV`, which turns a
// production `vite build` into a development-mode bundle (~80 kB brotli heavier).
const rootEnvPath = resolve(__dirname, '../../.env');
const rootEnv = existsSync(rootEnvPath) ? parseEnv(readFileSync(rootEnvPath, 'utf8')) : {};
const readEnv = (key: string) => process.env[key] || rootEnv[key];
const apiTarget =
  readEnv('VITE_API_PROXY_TARGET') || `http://localhost:${readEnv('PORT') || '3000'}`;

const apiProxy = {
  '/trpc': {
    target: apiTarget,
    changeOrigin: true,
  },
  '/api': {
    target: apiTarget,
    changeOrigin: true,
  },
  '/socket.io': {
    target: apiTarget,
    changeOrigin: true,
    ws: true,
  },
};

export default defineConfig({
  base: '/',
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      codeSplittingOptions: {
        /*
         * The plugin's default groupings split `component`, `errorComponent`
         * and `notFoundComponent` out of the entry graph but leave
         * `pendingComponent` in it. That default is the single largest leak
         * into first paint here, because the layout route deliberately draws
         * its FULL shell while it waits: `/_authenticated` renders the sidebar
         * and topbar. Left eager, every visitor downloads the shell before
         * anything paints, including the sign-in screen, which never renders it.
         *
         * Splitting it costs nothing at the moment it is actually used: the
         * router loads a match's split chunks together, and `defaultPendingMs`
         * is 500ms, so the chunk is in flight long before the placeholder is
         * allowed to appear.
         */
        defaultBehavior: [
          ['component'],
          ['pendingComponent'],
          ['errorComponent'],
          ['notFoundComponent'],
        ],
      },
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        // Stable framework chunk: react/react-dom/scheduler only change on a
        // framework upgrade, so returning visitors keep a warm cache for them
        // across app deploys. Matched on exact package directory boundaries
        // (trailing slash) so react-hook-form, @tanstack/react-*, etc. stay
        // in their regular chunks. Deliberately conservative: no other splits.
        manualChunks(id: string) {
          if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@api': resolve(__dirname, '../api/src'),
    },
  },
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    port: 5173,
    proxy: apiProxy,
  },
});
