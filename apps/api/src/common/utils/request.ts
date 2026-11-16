import type { Request } from 'express';

export function getClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function getUserAgent(req: Request): string {
  return req.headers['user-agent'] ?? 'unknown';
}
