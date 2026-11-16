/**
 * Socket.io typed event constants and payload interfaces.
 * Shared between API (server) and web (client) workspaces.
 */

// ---------------------------------------------------------------------------
// Event name constants
// ---------------------------------------------------------------------------

export const SocketEvents = {
  // Server -> Client
  NOTIFICATION: 'notification',
  ACTIVITY: 'activity',

  // Client -> Server
  TEST_NOTIFICATION: 'test:notification',
} as const;

// ---------------------------------------------------------------------------
// Payload interfaces
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}

export interface ActivityPayload {
  id: string;
  action: string;
  actor: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Type-safe Socket.io event maps (for generics)
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  [SocketEvents.NOTIFICATION]: (payload: NotificationPayload) => void;
  [SocketEvents.ACTIVITY]: (payload: ActivityPayload) => void;
}

export interface ClientToServerEvents {
  [SocketEvents.TEST_NOTIFICATION]: (ack: (response: { ok: boolean }) => void) => void;
}
