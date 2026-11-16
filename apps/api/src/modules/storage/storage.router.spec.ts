import { TRPCError } from '@trpc/server';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { StorageRouter } from './storage.router';

const presignedPost = {
  url: 'https://upload.example/bucket',
  fields: {
    'Content-Type': 'image/png',
    Policy: 'base64policy',
    'X-Amz-Signature': 'signature',
  },
};

const buildRouter = () => {
  const storageService = {
    createUploadPost: jest.fn().mockResolvedValue(presignedPost),
    getDownloadUrl: jest.fn().mockResolvedValue('https://download.example/signed'),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const avatarOwner = {
    clearAvatarIfCurrent: jest.fn().mockResolvedValue(false),
  };
  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  };
  const router = new StorageRouter(
    storageService as unknown as ConstructorParameters<typeof StorageRouter>[0],
    avatarOwner as unknown as ConstructorParameters<typeof StorageRouter>[1],
    auditService as unknown as ConstructorParameters<typeof StorageRouter>[2],
  );
  return { router, storageService, avatarOwner, auditService };
};

const buildCtx = (userId = 'u-1') =>
  ({
    req: {} as unknown,
    res: {} as unknown,
    user: { id: userId, email: 'e', role: 'USER', emailVerified: true },
    session: null,
  }) as unknown as Parameters<StorageRouter['requestUpload']>[0];

describe('StorageRouter (wiring + ownership)', () => {
  describe('requestUpload', () => {
    it('builds an avatars/<userId>/<uuid>.<ext> key with the extension from the content type', async () => {
      const { router, storageService } = buildRouter();
      const result = await router.requestUpload(buildCtx('u-1'), {
        filename: 'pic.PNG',
        contentType: 'image/png',
        size: 1024,
      });
      expect(result.key).toMatch(/^avatars\/u-1\/[0-9a-f-]{36}\.png$/i);
      expect(storageService.createUploadPost).toHaveBeenCalledWith(result.key, 'image/png');
      expect(storageService.getDownloadUrl).toHaveBeenCalledWith(result.key);
      // The POST policy passes through untouched so the client can spread
      // `fields` straight into its multipart form.
      expect(result.url).toBe(presignedPost.url);
      expect(result.fields).toEqual(presignedPost.fields);
      expect(result.downloadUrl).toBe('https://download.example/signed');
    });

    it('derives the extension from the MIME type, not the filename (jpeg → jpg)', async () => {
      const { router } = buildRouter();
      const result = await router.requestUpload(buildCtx('u-1'), {
        filename: 'my.archive.tar.gz',
        contentType: 'image/jpeg',
        size: 10,
      });
      expect(result.key).toMatch(/\.jpg$/);
    });

    it('ignores a smuggled filename extension and uses the MIME-derived one (webp)', async () => {
      const { router } = buildRouter();
      const result = await router.requestUpload(buildCtx('u-1'), {
        filename: 'evil.svg',
        contentType: 'image/webp',
        size: 1,
      });
      expect(result.key).toMatch(/\.webp$/);
      expect(result.key).not.toContain('svg');
    });
  });

  describe('getUrl', () => {
    it('returns downloadUrl for an own-key', async () => {
      const { router, storageService } = buildRouter();
      const result = await router.getUrl(buildCtx('u-1'), {
        key: 'avatars/u-1/abc.png',
      });
      expect(storageService.getDownloadUrl).toHaveBeenCalledWith('avatars/u-1/abc.png');
      expect(result).toEqual({ downloadUrl: 'https://download.example/signed' });
    });

    it('throws FORBIDDEN for another user’s key', async () => {
      const { router, storageService } = buildRouter();
      await expect(
        router.getUrl(buildCtx('u-1'), { key: 'avatars/u-2/abc.png' }),
      ).rejects.toBeInstanceOf(TRPCError);
      await expect(
        router.getUrl(buildCtx('u-1'), { key: 'avatars/u-2/abc.png' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(storageService.getDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN for a path-traversal-shaped key', async () => {
      const { router } = buildRouter();
      await expect(
        router.getUrl(buildCtx('u-1'), { key: '../../etc/passwd' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('deleteFile', () => {
    it('deletes own-key, clears a matching avatarUrl, and returns success', async () => {
      const { router, storageService, avatarOwner } = buildRouter();
      const result = await router.deleteFile(buildCtx('u-1'), {
        key: 'avatars/u-1/abc.png',
      });
      expect(storageService.delete).toHaveBeenCalledWith('avatars/u-1/abc.png');
      // The compare-and-swap clears avatarUrl only when the deleted key backed
      // the current avatar, so the profile never dangles on a missing object.
      expect(avatarOwner.clearAvatarIfCurrent).toHaveBeenCalledWith('u-1', 'avatars/u-1/abc.png');
      expect(result).toEqual({ success: true });
    });

    it('audits the destructive delete (who deleted which object)', async () => {
      const { router, auditService } = buildRouter();
      await router.deleteFile(buildCtx('u-1'), { key: 'avatars/u-1/abc.png' });
      expect(auditService.log).toHaveBeenCalledWith({
        action: AUDIT_ACTIONS.STORAGE_FILE_DELETED,
        userId: 'u-1',
        targetType: 'StorageObject',
        targetId: 'avatars/u-1/abc.png',
      });
    });

    it('does not clear avatarUrl or audit when the S3 delete throws', async () => {
      const { router, storageService, avatarOwner, auditService } = buildRouter();
      storageService.delete.mockRejectedValue(new Error('S3 down'));
      await expect(
        router.deleteFile(buildCtx('u-1'), { key: 'avatars/u-1/abc.png' }),
      ).rejects.toThrow('S3 down');
      expect(avatarOwner.clearAvatarIfCurrent).not.toHaveBeenCalled();
      // Nothing was deleted, so no audit row must claim it was.
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('throws FORBIDDEN for another user’s key (no delete call, no audit)', async () => {
      const { router, storageService, avatarOwner, auditService } = buildRouter();
      await expect(
        router.deleteFile(buildCtx('u-1'), { key: 'avatars/u-2/abc.png' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(storageService.delete).not.toHaveBeenCalled();
      expect(avatarOwner.clearAvatarIfCurrent).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});
