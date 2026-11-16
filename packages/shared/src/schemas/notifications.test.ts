import { describe, expect, it } from 'vitest';
import {
  ALL_NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
  notificationChannelMatrixSchema,
  notificationItemOutput,
  notificationListInput,
  notificationTypeSchema,
} from './notifications';

describe('notificationTypeSchema', () => {
  it.each(['info', 'success', 'warning', 'error'] as const)('accepts %p', (type) => {
    expect(notificationTypeSchema.safeParse(type).success).toBe(true);
  });

  it('rejects a type outside the union (DB column is TEXT; this is the boundary)', () => {
    expect(notificationTypeSchema.safeParse('debug').success).toBe(false);
  });
});

describe('notificationListInput', () => {
  it('prefaults a missing input to the default limit', () => {
    expect(notificationListInput.parse(undefined)).toEqual({
      limit: NOTIFICATION_LIST_DEFAULT_LIMIT,
    });
  });

  it('applies the inner default when limit is omitted', () => {
    expect(notificationListInput.parse({})).toEqual({ limit: NOTIFICATION_LIST_DEFAULT_LIMIT });
  });

  it('rejects a limit above the hard cap', () => {
    expect(
      notificationListInput.safeParse({ limit: NOTIFICATION_LIST_MAX_LIMIT + 1 }).success,
    ).toBe(false);
  });

  it('rejects a non-integer limit', () => {
    expect(notificationListInput.safeParse({ limit: 10.5 }).success).toBe(false);
  });
});

describe('notificationItemOutput', () => {
  it('strips unknown fields so internals never ride the wire', () => {
    const parsed = notificationItemOutput.parse({
      id: 'n1',
      type: 'info',
      title: 't',
      message: 'm',
      read: false,
      createdAt: '2026-07-02T00:00:00.000Z',
      jobId: 'internal-should-strip',
      tenantId: 'internal-should-strip',
    });
    expect(parsed).toEqual({
      id: 'n1',
      type: 'info',
      title: 't',
      message: 'm',
      read: false,
      createdAt: '2026-07-02T00:00:00.000Z',
    });
  });
});

describe('notificationChannelMatrixSchema', () => {
  it('accepts the defaults (they must always be a valid saved value)', () => {
    expect(notificationChannelMatrixSchema.safeParse(DEFAULT_NOTIFICATION_CHANNELS).success).toBe(
      true,
    );
  });

  it('rejects a matrix missing a category (the record is exhaustive)', () => {
    const { ADMIN_ACTIONS: _dropped, ...partial } = DEFAULT_NOTIFICATION_CHANNELS;
    expect(notificationChannelMatrixSchema.safeParse(partial).success).toBe(false);
  });

  it('rejects an unknown category key', () => {
    expect(
      notificationChannelMatrixSchema.safeParse({
        ...DEFAULT_NOTIFICATION_CHANNELS,
        SMS_EVERYTHING: { inApp: true, digest: true },
      }).success,
    ).toBe(false);
  });

  it('rejects a non-boolean channel flag', () => {
    expect(
      notificationChannelMatrixSchema.safeParse({
        ...DEFAULT_NOTIFICATION_CHANNELS,
        ADMIN_ACTIONS: { inApp: 'yes', digest: true },
      }).success,
    ).toBe(false);
  });
});

describe('DEFAULT_NOTIFICATION_CHANNELS', () => {
  it.each([
    NOTIFICATION_CATEGORIES.WORKSPACE_CREATED,
    NOTIFICATION_CATEGORIES.ADMIN_ACTIONS,
  ] as const)('mutes the new %s category everywhere (events are opt-in)', (category) => {
    expect(DEFAULT_NOTIFICATION_CHANNELS[category]).toEqual({
      inApp: false,
      digest: false,
    });
  });

  it('covers every category exactly once', () => {
    expect(Object.keys(DEFAULT_NOTIFICATION_CHANNELS).sort()).toEqual(
      [...ALL_NOTIFICATION_CATEGORIES].sort(),
    );
  });
});
