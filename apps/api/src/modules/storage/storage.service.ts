import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost, type PresignedPost } from '@aws-sdk/s3-presigned-post';
import { MAX_FILE_SIZE } from '@repo/shared/schemas';
import {
  S3_CONNECTION_TIMEOUT_MS,
  S3_SOCKET_TIMEOUT_MS,
} from '../../common/utils/external-timeouts';
import { InvariantError } from '../../common/errors/invariant-error';

// Short window for uploads (the client posts immediately after requesting),
// longer for downloads so an already-rendered link stays usable.
const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 3600;

/** One object as the bucket describes it. `lastModified` is the store's clock, not ours. */
export interface IStoredObjectSummary {
  readonly key: string;
  readonly lastModified: Date | null;
  /** Bytes AS STORED, so ciphertext length for an encrypted object. */
  readonly size: number;
}

/** What `listPrefix` saw, and whether that was all of it. */
export interface IPrefixListing {
  readonly objects: readonly IStoredObjectSummary[];
  /** True when the prefix held more objects than the caller's limit allowed. */
  readonly truncated: boolean;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.getOrThrow<string>('S3_ENDPOINT');
    const region = this.configService.getOrThrow<string>('S3_REGION');
    const accessKeyId = this.configService.getOrThrow<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.getOrThrow<string>('S3_SECRET_KEY');

    this.bucket = this.configService.getOrThrow<string>('S3_BUCKET');

    this.s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // Required for S3rver and MinIO
      requestHandler: {
        connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
        socketTimeout: S3_SOCKET_TIMEOUT_MS,
      },
    });

    this.logger.log(`S3 client initialized (endpoint: ${endpoint}, bucket: ${this.bucket})`);
  }

  async onModuleInit(): Promise<void> {
    const endpoint = this.configService.getOrThrow<string>('S3_ENDPOINT');
    const isLocalS3Endpoint = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');

    if (!isLocalS3Endpoint) return;

    try {
      await this.s3.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
                // POST is what the presigned POST policy upload uses.
                AllowedMethods: ['GET', 'POST', 'DELETE', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        }),
      );
      this.logger.log('Applied local S3 CORS policy for presigned uploads');
    } catch (error) {
      this.logger.warn('Failed to apply local S3 CORS policy', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create a presigned POST policy for client-side direct upload.
   *
   * A POST policy (unlike a presigned PUT) lets S3 itself enforce the size
   * cap via `content-length-range`, so an oversized body is rejected by the
   * storage backend even when the client lied about `size` while requesting
   * the upload. The Content-Type is pinned to the validated MIME type the
   * same way. MAX_FILE_SIZE comes from @repo/shared/schemas so the policy,
   * the zod input cap, and the client-side check share one source of truth.
   */
  async createUploadPost(
    key: string,
    contentType: string,
    expiresIn = UPLOAD_URL_TTL_SECONDS,
  ): Promise<PresignedPost> {
    const post = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_FILE_SIZE],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresIn,
    });
    this.logger.debug('Generated presigned upload POST policy', { key });
    return post;
  }

  /**
   * Generate a presigned GET URL for downloading/viewing a file.
   */
  async getDownloadUrl(key: string, expiresIn = DOWNLOAD_URL_TTL_SECONDS): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn });
    this.logger.debug('Generated presigned download URL', { key });
    return url;
  }

  /**
   * Read an object's size and content type WITHOUT fetching its bytes.
   *
   * Document metadata must never be taken from a value the acting client
   * supplied, and these two are the parts the server can answer for itself. HeadObject is a metadata request, so this costs no
   * transfer.
   *
   * Reports what the STORED OBJECT is, which for an encrypted staged upload is
   * the ciphertext, not the plaintext it decrypts to. Callers that need the
   * plaintext's size or mime type must get them from somewhere that records
   * them.
   *
   * Throws when the object is missing, which is the honest answer: a caller
   * asking about an object that is not there has a bigger problem than a
   * default value would paper over.
   */
  async head(key: string): Promise<{ size: number; mime: string }> {
    try {
      const result = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return {
        size: result.ContentLength ?? 0,
        mime: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      this.logger.error(
        'Failed to head object',
        { key, bucket: this.bucket },
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * Delete a file from S3.
   */
  async delete(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.debug('Deleted object', { key });
    } catch (error) {
      // Surface which object/bucket failed: a raw S3 throw with no context is
      // undebuggable in aggregated logs.
      this.logger.error(
        'Failed to delete object',
        { key, bucket: this.bucket },
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  /**
   * List what is ACTUALLY in the bucket under a key prefix.
   *
   * `deletePrefix` below already pages ListObjectsV2, but it consumes the
   * listing and tells the caller nothing; this hands the listing back, which is
   * the difference between "remove these" and "reconcile these against
   * something else". It serves an orphan-object sweep, whose whole job is an
   * inventory-versus-rows diff: it is looking for objects that have NO row, so
   * a row-driven read cannot find them and only the bucket knows they exist.
   *
   * `lastModified` is returned because a reconciler needs an age floor. An
   * object that was created seconds ago and has not been claimed yet is
   * indistinguishable from an abandoned one by key alone, and the difference
   * between them is somebody's document.
   *
   * BOUNDED, AND IT SAYS SO. `truncated` is true when the prefix held more than
   * `limit` objects, so a caller reports a partial scan as partial instead of
   * treating "everything I saw" as "everything there is". A sweep that silently
   * truncates reads as full coverage in a log and is exactly how a reconciler
   * comes to be trusted for something it never did.
   */
  async listPrefix(prefix: string, limit: number): Promise<IPrefixListing> {
    const objects: IStoredObjectSummary[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(continuationToken !== undefined ? { ContinuationToken: continuationToken } : {}),
        }),
      );

      for (const object of page.Contents ?? []) {
        if (object.Key === undefined) {
          continue;
        }
        if (objects.length >= limit) {
          return { objects, truncated: true };
        }
        objects.push({
          key: object.Key,
          lastModified: object.LastModified ?? null,
          size: object.Size ?? 0,
        });
      }

      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);

    return { objects, truncated: false };
  }

  /**
   * Delete EVERY object under a key prefix (e.g. `avatars/<userId>/`).
   *
   * Pages through ListObjectsV2 (1000 keys per page) and batch-deletes each
   * page with DeleteObjects. DeleteObjects can partially fail while still
   * returning HTTP 200 (per-key entries in `Errors`), so any per-key error is
   * promoted to a throw: callers (the user-purge sweep) must be able to treat
   * "deletePrefix resolved" as "no objects remain under the prefix".
   *
   * Returns the number of objects deleted (0 when the prefix is empty).
   */
  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const page = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ...(continuationToken !== undefined ? { ContinuationToken: continuationToken } : {}),
        }),
      );

      const keys = (page.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => key !== undefined);

      if (keys.length > 0) {
        const result = await this.s3.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );

        const errors = result.Errors ?? [];
        const firstError = errors[0];
        if (firstError !== undefined) {
          throw new InvariantError(
            `Failed to delete ${errors.length} object(s) under prefix ${prefix} in bucket ` +
              `${this.bucket} (first: ${firstError.Key ?? 'unknown key'}: ${
                firstError.Message ?? firstError.Code ?? 'unknown error'
              })`,
          );
        }
        deleted += keys.length;
      }

      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);

    this.logger.debug('Deleted objects under prefix', { deleted, prefix });
    return deleted;
  }
}
