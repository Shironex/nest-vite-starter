import { protocol } from 'electron';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const PROTOCOL_SCHEME = 'app';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

/**
 * Register the `app://` scheme as privileged.
 * MUST be called before `app.whenReady()`.
 */
export function registerAppProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/**
 * Set up the protocol handler to serve renderer files.
 * Must be called after `app.whenReady()`.
 */
export function setupProtocolHandler(): void {
  const rendererDir = path.join(__dirname, '../renderer');

  protocol.handle(PROTOCOL_SCHEME, (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    if (filePath === '/' || filePath === '') {
      filePath = '/index.html';
    }

    const fullPath = path.join(rendererDir, filePath);

    // A bare prefix check would also match sibling dirs like `renderer-x`;
    // require the exact dir or a path-separator boundary.
    if (!(fullPath === rendererDir || fullPath.startsWith(rendererDir + path.sep))) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = readFileSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      return new Response(data, {
        headers: { 'Content-Type': mimeType },
      });
    } catch {
      try {
        const indexData = readFileSync(path.join(rendererDir, 'index.html'));
        return new Response(indexData, {
          headers: { 'Content-Type': 'text/html' },
        });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  });
}
