import { describe, expect, it } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES,
  avatarKeySchema,
  deleteFileSchema,
  getUrlSchema,
  uploadResponseSchema,
} from './storage';

// Same shape the server issues: avatars/<cuid>/<crypto.randomUUID()>.<ext>.
// The UUIDs are canonical lowercase 8-4-4-4-12 samples of randomUUID output
// (the shared tsconfig has no Node lib, so generating live ones is not
// typable here); together they cover the full hex digit range.
const CUID = 'ckx1abc2d0000qzrmn831i7rn';
const UUID = '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9';
const UUID_ALL_HEX = 'abcdef01-2345-6789-abcd-ef0123456789';

describe('avatarKeySchema', () => {
  it('accepts a generated-shape key for every allowed extension', () => {
    for (const ext of Object.values(ALLOWED_IMAGE_TYPES)) {
      const key = `avatars/${CUID}/${UUID}.${ext}`;
      expect(avatarKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it('accepts keys across the full uuid hex range', () => {
    const key = `avatars/${CUID}/${UUID_ALL_HEX}.png`;
    expect(avatarKeySchema.safeParse(key).success).toBe(true);
  });

  it.each([
    ['dot-dot traversal in the id segment', `avatars/../${UUID}.png`],
    ['traversal smuggled after a valid id', `avatars/${CUID}/../${UUID}.png`],
    ['bare traversal path', '../../etc/passwd'],
    ['wrong prefix', `uploads/${CUID}/${UUID}.png`],
    ['singular prefix', `avatar/${CUID}/${UUID}.png`],
    ['uppercase prefix', `AVATARS/${CUID}/${UUID}.png`],
    ['uppercase user id', `avatars/${CUID.toUpperCase()}/${UUID}.png`],
    ['uppercase uuid', `avatars/${CUID}/${UUID.toUpperCase()}.png`],
    ['uppercase extension', `avatars/${CUID}/${UUID}.PNG`],
    ['extra path segment before the uuid', `avatars/${CUID}/extra/${UUID}.png`],
    ['extra path segment after the file', `avatars/${CUID}/${UUID}.png/more`],
    ['dot inside the id segment', `avatars/a.b/${UUID}.png`],
    ['hyphen inside the id segment', `avatars/u-1/${UUID}.png`],
    ['disallowed svg extension', `avatars/${CUID}/${UUID}.svg`],
    ['disallowed html extension', `avatars/${CUID}/${UUID}.html`],
    ['double extension', `avatars/${CUID}/${UUID}.png.svg`],
    ['non-uuid object name', `avatars/${CUID}/not-a-uuid.png`],
    ['plain filename', 'pic.png'],
    ['empty string', ''],
  ])('rejects %s', (_label, key) => {
    expect(avatarKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('getUrlSchema / deleteFileSchema', () => {
  const validKey = `avatars/${CUID}/${UUID}.webp`;

  it('accept a server-issued key', () => {
    expect(getUrlSchema.safeParse({ key: validKey }).success).toBe(true);
    expect(deleteFileSchema.safeParse({ key: validKey }).success).toBe(true);
  });

  it('reject traversal-shaped keys through the shared avatar key schema', () => {
    const traversal = `avatars/${CUID}/../${UUID}.png`;
    expect(getUrlSchema.safeParse({ key: traversal }).success).toBe(false);
    expect(deleteFileSchema.safeParse({ key: traversal }).success).toBe(false);
  });
});

describe('uploadResponseSchema', () => {
  it('accepts the AWS PresignedPost shape plus key and downloadUrl', () => {
    const result = uploadResponseSchema.safeParse({
      url: 'http://localhost:4569/saas-starter-uploads',
      fields: {
        'Content-Type': 'image/png',
        key: `avatars/${CUID}/${UUID}.png`,
        Policy: 'base64policy',
        'X-Amz-Signature': 'signature',
      },
      key: `avatars/${CUID}/${UUID}.png`,
      downloadUrl: 'http://localhost:4569/saas-starter-uploads/signed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string values inside fields', () => {
    const result = uploadResponseSchema.safeParse({
      url: 'http://localhost:4569/saas-starter-uploads',
      fields: { Policy: 42 },
      key: `avatars/${CUID}/${UUID}.png`,
      downloadUrl: 'http://localhost:4569/saas-starter-uploads/signed',
    });
    expect(result.success).toBe(false);
  });
});
