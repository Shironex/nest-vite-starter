import { ConfigService } from '@nestjs/config';
import { MAX_FILE_SIZE } from '@repo/shared/schemas';
import {
  S3_CONNECTION_TIMEOUT_MS,
  S3_SOCKET_TIMEOUT_MS,
} from '../../common/utils/external-timeouts';

const sendMock = jest.fn();
const s3CtorMock = jest.fn((..._args: unknown[]) => ({ send: sendMock }));
const getObjectCommandCtor = jest.fn();
const deleteObjectCommandCtor = jest.fn();
const deleteObjectsCommandCtor = jest.fn();
const listObjectsV2CommandCtor = jest.fn();
const putBucketCorsCommandCtor = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((...args: unknown[]) => s3CtorMock(...args)),
  GetObjectCommand: jest.fn().mockImplementation((args: unknown) => {
    getObjectCommandCtor(args);
    return { __cmd: 'GetObject', args };
  }),
  DeleteObjectCommand: jest.fn().mockImplementation((args: unknown) => {
    deleteObjectCommandCtor(args);
    return { __cmd: 'DeleteObject', args };
  }),
  DeleteObjectsCommand: jest.fn().mockImplementation((args: unknown) => {
    deleteObjectsCommandCtor(args);
    return { __cmd: 'DeleteObjects', args };
  }),
  ListObjectsV2Command: jest.fn().mockImplementation((args: unknown) => {
    listObjectsV2CommandCtor(args);
    return { __cmd: 'ListObjectsV2', args };
  }),
  PutBucketCorsCommand: jest.fn().mockImplementation((args: unknown) => {
    putBucketCorsCommandCtor(args);
    return { __cmd: 'PutBucketCors', args };
  }),
}));

const getSignedUrlMock = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

const createPresignedPostMock = jest.fn();
jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: (...args: unknown[]) => createPresignedPostMock(...args),
}));

// Import AFTER jest.mock so the service binds to the mocked SDK.
import { StorageService } from './storage.service';

const buildConfig = (overrides: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    S3_ENDPOINT: 'http://localhost:4568',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'ak',
    S3_SECRET_KEY: 'sk',
    S3_BUCKET: 'my-bucket',
    ...overrides,
  };
  return {
    getOrThrow: jest.fn((key: string) => {
      const v = values[key];
      if (v === undefined) throw new Error(`missing config: ${key}`);
      return v;
    }),
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
};

describe('StorageService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    s3CtorMock.mockReset();
    s3CtorMock.mockImplementation(() => ({ send: sendMock }));
    getObjectCommandCtor.mockReset();
    deleteObjectCommandCtor.mockReset();
    deleteObjectsCommandCtor.mockReset();
    listObjectsV2CommandCtor.mockReset();
    putBucketCorsCommandCtor.mockReset();
    getSignedUrlMock.mockReset();
    createPresignedPostMock.mockReset();
  });

  describe('constructor', () => {
    it('throws when S3_ENDPOINT is missing (delegates to getOrThrow)', () => {
      const cfg = {
        getOrThrow: jest.fn((key: string) => {
          if (key === 'S3_ENDPOINT') throw new Error('missing config');
          return 'x';
        }),
        get: jest.fn(),
      } as unknown as ConfigService;
      expect(() => new StorageService(cfg)).toThrow(/missing config/);
    });

    it('initializes S3Client with endpoint, region, credentials, forcePathStyle', () => {
      new StorageService(buildConfig());
      expect(s3CtorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'us-east-1',
          endpoint: 'http://localhost:4568',
          credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
          forcePathStyle: true,
        }),
      );
    });

    it('sets connection and inactivity timeouts on the request handler', () => {
      new StorageService(buildConfig());
      expect(s3CtorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestHandler: {
            connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
            socketTimeout: S3_SOCKET_TIMEOUT_MS,
          },
        }),
      );
    });
  });

  describe('onModuleInit', () => {
    it('applies CORS for localhost endpoint', async () => {
      sendMock.mockResolvedValue(undefined);
      const svc = new StorageService(buildConfig({ S3_ENDPOINT: 'http://localhost:4568' }));
      await svc.onModuleInit();
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(putBucketCorsCommandCtor).toHaveBeenCalledWith(
        expect.objectContaining({ Bucket: 'my-bucket' }),
      );
    });

    it('allows POST so presigned POST policy uploads pass the dev CORS check', async () => {
      sendMock.mockResolvedValue(undefined);
      const svc = new StorageService(buildConfig({ S3_ENDPOINT: 'http://localhost:4568' }));
      await svc.onModuleInit();
      expect(putBucketCorsCommandCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          CORSConfiguration: {
            CORSRules: [
              expect.objectContaining({
                AllowedMethods: expect.arrayContaining(['POST']),
              }),
            ],
          },
        }),
      );
    });

    it('applies CORS for 127.0.0.1 endpoint', async () => {
      sendMock.mockResolvedValue(undefined);
      const svc = new StorageService(buildConfig({ S3_ENDPOINT: 'http://127.0.0.1:9000' }));
      await svc.onModuleInit();
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT apply CORS for a non-local endpoint', async () => {
      const svc = new StorageService(
        buildConfig({ S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com' }),
      );
      await svc.onModuleInit();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('logs and does not throw when CORS apply rejects', async () => {
      sendMock.mockRejectedValue(new Error('boom'));
      const svc = new StorageService(buildConfig({ S3_ENDPOINT: 'http://localhost:4568' }));
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('createUploadPost', () => {
    it('builds a POST policy pinning the size range and content type, expiring in 300s', async () => {
      createPresignedPostMock.mockResolvedValue({
        url: 'http://localhost:4568/my-bucket',
        fields: { 'Content-Type': 'image/png', key: 'avatars/u-1/x.png' },
      });
      const svc = new StorageService(buildConfig());
      const post = await svc.createUploadPost('avatars/u-1/x.png', 'image/png');
      expect(post).toEqual({
        url: 'http://localhost:4568/my-bucket',
        fields: { 'Content-Type': 'image/png', key: 'avatars/u-1/x.png' },
      });
      expect(createPresignedPostMock).toHaveBeenCalledWith(expect.anything(), {
        Bucket: 'my-bucket',
        Key: 'avatars/u-1/x.png',
        Conditions: [
          ['content-length-range', 1, MAX_FILE_SIZE],
          ['eq', '$Content-Type', 'image/png'],
        ],
        Fields: { 'Content-Type': 'image/png' },
        Expires: 300,
      });
    });

    it('honors a custom expiresIn', async () => {
      createPresignedPostMock.mockResolvedValue({ url: 'u', fields: {} });
      const svc = new StorageService(buildConfig());
      await svc.createUploadPost('avatars/u-1/x.png', 'image/png', 60);
      expect(createPresignedPostMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Expires: 60 }),
      );
    });
  });

  describe('signed URL generation', () => {
    it('getDownloadUrl uses GetObjectCommand and expiresIn 3600 by default', async () => {
      getSignedUrlMock.mockResolvedValue('https://download.example/signed');
      const svc = new StorageService(buildConfig());
      const url = await svc.getDownloadUrl('avatars/u-1/x.png');
      expect(url).toBe('https://download.example/signed');
      expect(getObjectCommandCtor).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: 'avatars/u-1/x.png',
      });
      expect(getSignedUrlMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ __cmd: 'GetObject' }),
        { expiresIn: 3600 },
      );
    });
  });

  describe('delete', () => {
    it('sends DeleteObjectCommand with bucket + key', async () => {
      sendMock.mockResolvedValue(undefined);
      const svc = new StorageService(buildConfig());
      await svc.delete('avatars/u-1/x.png');
      expect(deleteObjectCommandCtor).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Key: 'avatars/u-1/x.png',
      });
      expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'DeleteObject' }));
    });
  });

  describe('deletePrefix', () => {
    const listReply = (keys: string[], next?: string) => ({
      Contents: keys.map((Key) => ({ Key })),
      IsTruncated: next !== undefined,
      ...(next !== undefined ? { NextContinuationToken: next } : {}),
    });

    it('lists the prefix and batch-deletes every returned key', async () => {
      sendMock.mockImplementation((cmd: { __cmd: string }) => {
        if (cmd.__cmd === 'ListObjectsV2') {
          return Promise.resolve(listReply(['avatars/u-1/a.png', 'avatars/u-1/b.png']));
        }
        return Promise.resolve({});
      });
      const svc = new StorageService(buildConfig());

      await expect(svc.deletePrefix('avatars/u-1/')).resolves.toBe(2);

      expect(listObjectsV2CommandCtor).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Prefix: 'avatars/u-1/',
      });
      expect(deleteObjectsCommandCtor).toHaveBeenCalledWith({
        Bucket: 'my-bucket',
        Delete: {
          Objects: [{ Key: 'avatars/u-1/a.png' }, { Key: 'avatars/u-1/b.png' }],
          Quiet: true,
        },
      });
    });

    it('pages through a truncated listing with the continuation token', async () => {
      sendMock.mockImplementation(
        (cmd: { __cmd: string; args: { ContinuationToken?: string } }) => {
          if (cmd.__cmd === 'ListObjectsV2') {
            return cmd.args.ContinuationToken === undefined
              ? Promise.resolve(listReply(['avatars/u-1/a.png'], 'token-2'))
              : Promise.resolve(listReply(['avatars/u-1/b.png']));
          }
          return Promise.resolve({});
        },
      );
      const svc = new StorageService(buildConfig());

      await expect(svc.deletePrefix('avatars/u-1/')).resolves.toBe(2);

      expect(listObjectsV2CommandCtor).toHaveBeenCalledTimes(2);
      expect(listObjectsV2CommandCtor).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ ContinuationToken: 'token-2' }),
      );
      expect(deleteObjectsCommandCtor).toHaveBeenCalledTimes(2);
    });

    it('resolves 0 without a delete round trip when the prefix is empty', async () => {
      sendMock.mockResolvedValue({ Contents: [], IsTruncated: false });
      const svc = new StorageService(buildConfig());

      await expect(svc.deletePrefix('avatars/ghost/')).resolves.toBe(0);
      expect(deleteObjectsCommandCtor).not.toHaveBeenCalled();
    });

    it('throws when DeleteObjects reports per-key errors (partial failure must not look like success)', async () => {
      sendMock.mockImplementation((cmd: { __cmd: string }) => {
        if (cmd.__cmd === 'ListObjectsV2') {
          return Promise.resolve(listReply(['avatars/u-1/a.png']));
        }
        return Promise.resolve({
          Errors: [{ Key: 'avatars/u-1/a.png', Code: 'AccessDenied', Message: 'denied' }],
        });
      });
      const svc = new StorageService(buildConfig());

      await expect(svc.deletePrefix('avatars/u-1/')).rejects.toThrow(/avatars\/u-1\/a\.png/);
    });
  });
});
