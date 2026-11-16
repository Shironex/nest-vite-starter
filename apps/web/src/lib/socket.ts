import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@repo/shared/events';
import { getSocketUrl } from './electron';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

/**
 * Returns a singleton typed Socket.io client.
 * The socket is created with `autoConnect: false` so callers must explicitly `.connect()`.
 *
 * In Electron mode the URL is set to the dynamic NestJS backend port.
 * In web mode `getSocketUrl()` returns `undefined` so Socket.io auto-detects
 * from `window.location`.
 */
export function getSocket(): TypedSocket {
  if (!socket) {
    socket = io(getSocketUrl(), {
      autoConnect: false,
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

/**
 * Disconnects the current socket and clears the singleton reference.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
