import { Test } from '@nestjs/testing';
import { SessionRevocationService } from './session-revocation.service';
import { SessionService } from '../auth/services/session.service';
import { EventsService } from './events.service';

describe('SessionRevocationService', () => {
  const buildSubject = async () => {
    const session = { deleteAllUserSessions: jest.fn().mockResolvedValue(undefined) };
    const events = { disconnectUser: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        SessionRevocationService,
        { provide: SessionService, useValue: session },
        { provide: EventsService, useValue: events },
      ],
    }).compile();
    return { service: module.get(SessionRevocationService), session, events };
  };

  it('revokes all Redis sessions AND disconnects live sockets', async () => {
    const { service, session, events } = await buildSubject();

    await service.revokeAllAndDisconnect('u-1');

    expect(session.deleteAllUserSessions).toHaveBeenCalledWith('u-1');
    expect(events.disconnectUser).toHaveBeenCalledWith('u-1');
  });

  it('revokes sessions BEFORE dropping sockets (a reconnecting socket must find no session)', async () => {
    const { service, session, events } = await buildSubject();

    await service.revokeAllAndDisconnect('u-1');

    expect(session.deleteAllUserSessions.mock.invocationCallOrder[0]).toBeLessThan(
      events.disconnectUser.mock.invocationCallOrder[0] as number,
    );
  });

  it('does not disconnect sockets when session revocation throws', async () => {
    const { service, session, events } = await buildSubject();
    session.deleteAllUserSessions.mockRejectedValue(new Error('redis down'));

    await expect(service.revokeAllAndDisconnect('u-1')).rejects.toThrow('redis down');
    expect(events.disconnectUser).not.toHaveBeenCalled();
  });
});
