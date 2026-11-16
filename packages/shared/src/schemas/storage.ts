import { z } from 'zod';

/*
 * Moved to `@repo/shared/constants` (no zod there), so the web pays for a
 * number instead of for the whole schemas chunk. Re-exported because the api
 * reads these from the module that enforces them.
 */
export { MAX_FILE_SIZE } from '../constants/index.js';
import { MAX_FILE_SIZE } from '../constants/index.js';

/**
 * Allowed avatar image MIME types mapped to their canonical file extension.
 *
 * SVG is intentionally excluded: an SVG served inline from our own origin can
 * carry `<script>` and become a stored-XSS vector. The stored object key's
 * extension is derived from this map, never from the client-supplied filename.
 */
export const ALLOWED_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES;

const allowedImageTypeKeys = Object.keys(ALLOWED_IMAGE_TYPES) as [
  AllowedImageType,
  ...AllowedImageType[],
];

/** Value for a file input's `accept` attribute, kept in sync with the allowlist. */
export const ALLOWED_IMAGE_ACCEPT = allowedImageTypeKeys.join(',');

/** Input for requesting a presigned upload URL. */
export const uploadRequestSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.enum(allowedImageTypeKeys, {
    error: 'Only PNG, JPEG, WebP, or GIF images are allowed',
  }),
  size: z
    .number()
    .positive('File size must be positive')
    .max(MAX_FILE_SIZE, `File size must be at most ${MAX_FILE_SIZE / 1024 / 1024}MB`),
});

/**
 * Response from requesting an upload: a presigned POST policy plus the stored
 * key. `url` and `fields` deliberately mirror the AWS SDK's `PresignedPost`
 * shape so the client can spread `fields` straight into the multipart form it
 * POSTs to `url`.
 */
export const uploadResponseSchema = z.object({
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  key: z.string(),
  downloadUrl: z.string(),
});

/** Canonical lowercase 8-4-4-4-12 hex form produced by crypto.randomUUID. */
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Structural validator for server-issued avatar object keys:
 * `avatars/<userId>/<uuid>.<ext>`.
 *
 * - `<userId>` is one or more lowercase alphanumerics (cuid shape). Dots and
 *   slashes cannot appear anywhere in the segment, so `..` traversal is
 *   structurally impossible.
 * - `<uuid>` is the canonical form of crypto.randomUUID (see UUID_PATTERN).
 * - `<ext>` is built from ALLOWED_IMAGE_TYPES, the same source of truth the
 *   server derives stored extensions from, so the allowlist never forks.
 *
 * Anchored and case-sensitive on purpose: uppercase prefix/uuid/extension
 * variants are rejected. This schema only narrows shape; routers still
 * enforce ownership via the `avatars/<userId>/` prefix check.
 */
const avatarKeyPattern = new RegExp(
  `^avatars/[a-z0-9]+/${UUID_PATTERN}\\.(?:${Object.values(ALLOWED_IMAGE_TYPES).join('|')})$`,
);

export const avatarKeySchema = z
  .string()
  .regex(avatarKeyPattern, 'Key must be a server-issued avatar object key');

/**
 * Canonical owner prefix for avatar object keys. Every ownership check and
 * key construction must go through this so the layout can never fork from
 * the guards (a key accepted by avatarKeySchema is only the caller's own
 * when it starts with this prefix).
 */
export function avatarKeyPrefix(userId: string): string {
  return `avatars/${userId}/`;
}

/** Input for getting a download URL by key. */
export const getUrlSchema = z.object({
  key: avatarKeySchema,
});

/** Input for deleting a file by key. */
export const deleteFileSchema = z.object({
  key: avatarKeySchema,
});

/**
 * `storage.getUrl` output: the presigned download URL for a stored object.
 * Set as the procedure `output:` so the response is zod-stripped to exactly
 * this field and no presigning internals ride along.
 */
export const getUrlOutput = z.object({
  downloadUrl: z.string(),
});

// Inferred types
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type AvatarKey = z.infer<typeof avatarKeySchema>;
export type GetUrlInput = z.infer<typeof getUrlSchema>;
export type GetUrlOutput = z.infer<typeof getUrlOutput>;
export type DeleteFileInput = z.infer<typeof deleteFileSchema>;
