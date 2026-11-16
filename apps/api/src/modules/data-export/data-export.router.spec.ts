import { userDataExportOutput } from '@repo/shared/schemas';
import { DataExportRouter } from './data-export.router';
import { DataExportService } from './data-export.service';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';

const buildExport = (userId: string) => ({
  exportSchema: 1 as const,
  exportedAt: new Date('2026-01-01T00:00:00Z'),
  account: {
    id: userId,
    email: 'user@example.com',
    displayName: null,
    avatarUrl: null,
    role: 'USER',
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
});

const buildCtx = (userId: string): IAuthenticatedContextType =>
  ({
    user: { id: userId, email: 'user@example.com', role: 'USER', emailVerified: true },
    session: { id: 's-1', token: 'tok' },
  }) as unknown as IAuthenticatedContextType;

describe('DataExportRouter', () => {
  const buildSubject = () => {
    const service = { exportForUser: jest.fn() };
    const router = new DataExportRouter(service as unknown as DataExportService);
    return { router, service };
  };

  it('download() exports strictly the caller own id from the session (no IDOR surface)', async () => {
    const { router, service } = buildSubject();
    service.exportForUser.mockResolvedValue(buildExport('u-1'));

    const result = await router.download(buildCtx('u-1'));

    // The user id comes only from ctx.user.id, never from request input.
    expect(service.exportForUser).toHaveBeenCalledWith('u-1');
    expect(result.account.id).toBe('u-1');
  });

  it('the export payload satisfies the router output schema (wire-strip contract)', async () => {
    const { router, service } = buildSubject();
    service.exportForUser.mockResolvedValue(buildExport('u-2'));

    const result = await router.download(buildCtx('u-2'));

    // The output schema is what the server applies on the wire; a strict parse
    // must accept the shape and drop anything not declared.
    const parsed = userDataExportOutput.parse(result);
    expect(parsed.exportSchema).toBe(1);
    expect(parsed.account.email).toBe('user@example.com');
  });

  it('the output schema strips an internal field that leaks into the result', () => {
    const leaky = {
      ...buildExport('u-3'),
      account: { ...buildExport('u-3').account, passwordHash: 'should-not-leak' },
    };
    const parsed = userDataExportOutput.parse(leaky);
    expect(parsed.account).not.toHaveProperty('passwordHash');
  });
});
