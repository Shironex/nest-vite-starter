import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  close: jest.fn(() => Promise.resolve(true)),
  onUnhandledRejectionIntegration: jest.fn(() => ({ name: 'OnUnhandledRejection' })),
}));

/**
 * Sentry must stay dormant until a DSN is configured: no init, no egress, no
 * shutdown hook. The module runs `initSentry(process.env)` at import, so the
 * import itself is part of what is proven.
 */
describe('instrument (Sentry bootstrap)', () => {
  const originalDsn = process.env.SENTRY_DSN;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.mocked(Sentry.init).mockClear();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it('never initialises Sentry when the module loads with an empty SENTRY_DSN', async () => {
    process.env.SENTRY_DSN = '';
    await jest.isolateModulesAsync(async () => {
      await import('./instrument');
    });

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', {}],
    ['empty', { SENTRY_DSN: '' }],
    ['whitespace', { SENTRY_DSN: '   ' }],
  ])('initSentry is a no-op when SENTRY_DSN is %s', async (_, vars) => {
    const { initSentry } = await import('./instrument');
    jest.mocked(Sentry.init).mockClear();
    const onceSpy = jest.spyOn(process, 'once');

    expect(initSentry(vars)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(onceSpy).not.toHaveBeenCalled();
    onceSpy.mockRestore();
  });

  it('initialises once with the scrubber wired when SENTRY_DSN is set', async () => {
    const { initSentry } = await import('./instrument');
    jest.mocked(Sentry.init).mockClear();
    const onceSpy = jest.spyOn(process, 'once').mockImplementation(() => process);

    expect(initSentry({ SENTRY_DSN: 'https://public@sentry.invalid/1', NODE_ENV: 'test' })).toBe(
      true,
    );
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@sentry.invalid/1',
        sendDefaultPii: false,
        environment: 'test',
        beforeSend: expect.any(Function),
        beforeBreadcrumb: expect.any(Function),
      }),
    );
    onceSpy.mockRestore();
  });
});
