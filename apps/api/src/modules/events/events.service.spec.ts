import { Logger } from '@nestjs/common';
import { EventsService } from './events.service';
import { SocketEvents } from '@repo/shared/events';

const buildFakeServer = () => {
  const emit = jest.fn();
  const to = jest.fn();
  const roomEmit = jest.fn();
  const inFn = jest.fn();
  const disconnectSockets = jest.fn();
  to.mockReturnValue({ emit: roomEmit });
  inFn.mockReturnValue({ disconnectSockets });
  return {
    server: { emit, to, in: inFn } as never,
    emit,
    to,
    roomEmit,
    inFn,
    disconnectSockets,
  };
};

describe('EventsService', () => {
  let svc: EventsService;

  beforeEach(() => {
    svc = new EventsService();
  });

  describe('uninitialized server', () => {
    it('notifyUser warns and emits nothing', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // No server attached, so there is nothing it could emit through: the warn
      // is the whole observable effect.
      expect(() =>
        svc.notifyUser('u-1', { id: 'n', type: 'info', title: 't', message: 'm', timestamp: 0 }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledWith('Cannot emit: server not initialized');
      warn.mockRestore();
    });

    it('disconnectUser warns and does not throw', () => {
      expect(() => svc.disconnectUser('u-1')).not.toThrow();
    });

    it('disconnectSession warns and does not throw', () => {
      expect(() => svc.disconnectSession('sid-1')).not.toThrow();
    });
  });

  describe('after setServer', () => {
    it('notifyUser emits to user:<id> room with NOTIFICATION event', () => {
      const { server, to, roomEmit } = buildFakeServer();
      svc.setServer(server);
      const payload = {
        id: 'n',
        type: 'info' as const,
        title: 't',
        message: 'm',
        timestamp: 1,
      };
      svc.notifyUser('u-1', payload);
      expect(to).toHaveBeenCalledWith('user:u-1');
      expect(roomEmit).toHaveBeenCalledWith(SocketEvents.NOTIFICATION, payload);
    });

    it('disconnectUser force-closes every socket in the user:<id> room', () => {
      const { server, inFn, disconnectSockets } = buildFakeServer();
      svc.setServer(server);
      svc.disconnectUser('u-1');
      expect(inFn).toHaveBeenCalledWith('user:u-1');
      // close: true drops the underlying connections, not just the namespace.
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('disconnectSession force-closes only the session:<id> room', () => {
      const { server, inFn, disconnectSockets } = buildFakeServer();
      svc.setServer(server);
      svc.disconnectSession('sid-1');
      // The narrow twin of disconnectUser: logout, a single-device revoke and a
      // max-sessions eviction each end exactly one session.
      expect(inFn).toHaveBeenCalledWith('session:sid-1');
      expect(inFn).not.toHaveBeenCalledWith(expect.stringMatching(/^user:/u));
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });
  });
});
