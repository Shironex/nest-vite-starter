import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { DEFAULT_NOTIFICATION_CHANNELS, NOTIFICATION_CATEGORIES } from '@repo/shared/schemas';
import type { NotificationChannelMatrix } from '@repo/shared/schemas';
import { ConflictError } from '../../common/errors/domain-error';
import { NotificationPreferencesService } from './notification-preferences.service';

type Deps = ConstructorParameters<typeof NotificationPreferencesService>;

const SAVED_AT = new Date('2026-08-04T10:00:00Z');

/** A full matrix that differs from the defaults in every category. */
const CUSTOM_MATRIX: NotificationChannelMatrix = {
  WORKSPACE_CREATED: { inApp: true, digest: false },
  ADMIN_ACTIONS: { inApp: true, digest: false },
};

const buildSubject = () => {
  const repository = {
    findPreference: jest.fn().mockResolvedValue(null),
    findPreferencesByUserIds: jest.fn().mockResolvedValue([]),
    createPreference: jest.fn(),
    updatePreference: jest.fn(),
  };
  const prismaService = {
    client: {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    },
  };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationPreferencesService(
    prismaService as unknown as Deps[0],
    repository as unknown as Deps[1],
    auditService as unknown as Deps[2],
  );
  return { service, repository, prismaService, auditService };
};

describe('NotificationPreferencesService', () => {
  describe('resolveChannels (the seam every delivery path reads through)', () => {
    it("resolves an absent blob to the defaults, which equal today's behavior", () => {
      const resolved = NotificationPreferencesService.resolveChannels(null);

      expect(resolved).toEqual(DEFAULT_NOTIFICATION_CHANNELS);
      expect(resolved.WORKSPACE_CREATED).toEqual({ inApp: false, digest: false });
    });

    it('fills a category missing from a stale blob with its default', () => {
      const resolved = NotificationPreferencesService.resolveChannels({
        WORKSPACE_CREATED: { inApp: true, digest: false },
      });

      expect(resolved.WORKSPACE_CREATED).toEqual({ inApp: true, digest: false });
      // Absent from the blob: falls back to its (muted) default.
      expect(resolved.ADMIN_ACTIONS).toEqual(DEFAULT_NOTIFICATION_CHANNELS.ADMIN_ACTIONS);
    });

    it('drops an unknown category key instead of crashing the wire read', () => {
      const resolved = NotificationPreferencesService.resolveChannels({
        SMS_EVERYTHING: { inApp: true, digest: true },
      });

      expect(resolved).toEqual(DEFAULT_NOTIFICATION_CHANNELS);
      expect('SMS_EVERYTHING' in resolved).toBe(false);
    });

    it('replaces a malformed entry with the default for that category', () => {
      const resolved = NotificationPreferencesService.resolveChannels({
        ADMIN_ACTIONS: { inApp: 'yes' },
      });

      expect(resolved.ADMIN_ACTIONS).toEqual(DEFAULT_NOTIFICATION_CHANNELS.ADMIN_ACTIONS);
    });
  });

  describe('getForUser', () => {
    it('answers the defaults with isDefault while no row exists', async () => {
      const { service } = buildSubject();

      await expect(service.getForUser('u-1')).resolves.toEqual({
        channels: DEFAULT_NOTIFICATION_CHANNELS,
        isDefault: true,
        updatedAt: null,
      });
    });

    it('resolves a saved row through the seam', async () => {
      const { service, repository } = buildSubject();
      repository.findPreference.mockResolvedValue({
        id: 'pref-1',
        userId: 'u-1',
        channels: CUSTOM_MATRIX,
        updatedAt: SAVED_AT,
      });

      await expect(service.getForUser('u-1')).resolves.toEqual({
        channels: CUSTOM_MATRIX,
        isDefault: false,
        updatedAt: SAVED_AT,
      });
    });
  });

  describe('updateForUser', () => {
    it('creates the row on first save and audits the saved matrix', async () => {
      const { service, repository, auditService } = buildSubject();
      repository.createPreference.mockResolvedValue({
        id: 'pref-1',
        userId: 'u-1',
        channels: CUSTOM_MATRIX,
        updatedAt: SAVED_AT,
      });

      const result = await service.updateForUser('u-1', CUSTOM_MATRIX);

      expect(repository.createPreference).toHaveBeenCalledWith('u-1', CUSTOM_MATRIX, {});
      expect(repository.updatePreference).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATED,
        targetType: 'NotificationPreference',
        targetId: 'pref-1',
        metadata: { channels: CUSTOM_MATRIX },
      });
      expect(result.isDefault).toBe(false);
    });

    it('updates in place once a row exists', async () => {
      const { service, repository } = buildSubject();
      repository.findPreference.mockResolvedValue({
        id: 'pref-1',
        userId: 'u-1',
        channels: DEFAULT_NOTIFICATION_CHANNELS,
        updatedAt: SAVED_AT,
      });
      repository.updatePreference.mockResolvedValue({
        id: 'pref-1',
        userId: 'u-1',
        channels: CUSTOM_MATRIX,
        updatedAt: SAVED_AT,
      });

      await service.updateForUser('u-1', CUSTOM_MATRIX);

      expect(repository.updatePreference).toHaveBeenCalledWith('pref-1', CUSTOM_MATRIX, {});
      expect(repository.createPreference).not.toHaveBeenCalled();
    });

    it('translates the concurrent-first-save P2002 into ConflictError', async () => {
      const { service, repository } = buildSubject();
      repository.createPreference.mockRejectedValue(
        Object.assign(new Error('unique'), {
          code: 'P2002',
          name: 'PrismaClientKnownRequestError',
        }),
      );

      await expect(service.updateForUser('u-1', CUSTOM_MATRIX)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe('filterByChannel', () => {
    it('drops users without a row when the default for the flag is OFF', async () => {
      const { service } = buildSubject();

      await expect(
        service.filterByChannel(['u-1', 'u-2'], NOTIFICATION_CATEGORIES.WORKSPACE_CREATED, 'inApp'),
      ).resolves.toEqual([]);
    });

    it("applies each user's saved row and the defaults side by side", async () => {
      const { service, repository } = buildSubject();
      repository.findPreferencesByUserIds.mockResolvedValue([
        { userId: 'muted', channels: CUSTOM_MATRIX },
      ]);

      await expect(
        service.filterByChannel(
          ['muted', 'untouched'],
          NOTIFICATION_CATEGORIES.WORKSPACE_CREATED,
          'inApp',
        ),
      ).resolves.toEqual(['muted']);
    });

    it('answers an empty set without touching the database', async () => {
      const { service, repository } = buildSubject();

      await expect(
        service.filterByChannel([], NOTIFICATION_CATEGORIES.WORKSPACE_CREATED, 'inApp'),
      ).resolves.toEqual([]);
      expect(repository.findPreferencesByUserIds).not.toHaveBeenCalled();
    });
  });
});
