import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { TURNSTILE_VERIFY_TIMEOUT_MS } from '../../../common/utils/external-timeouts';
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  let service: TurnstileService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TurnstileService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('secret-key'),
            getOrThrow: jest.fn().mockReturnValue('secret-key'),
          },
        },
      ],
    }).compile();
    service = module.get(TurnstileService);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns true when siteverify responds with success: true', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    await expect(service.validate('tok', '1.2.3.4')).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    // Body includes secret + response + remoteip.
    const body = fetchSpy.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('secret-key');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('returns false when siteverify responds with success: false', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: false }) } as Response);
    await expect(service.validate('tok')).resolves.toBe(false);
  });

  it('omits remoteip from the body when not provided', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    await service.validate('tok');
    const body = fetchSpy.mock.calls[0][1].body as URLSearchParams;
    expect(body.has('remoteip')).toBe(false);
  });

  it('returns false when fetch throws (network error swallowed, never bubbles)', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    await expect(service.validate('tok')).resolves.toBe(false);
  });

  it('returns false when response.json() throws', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);
    await expect(service.validate('tok')).resolves.toBe(false);
  });

  it('fails closed on a non-OK status without parsing the error body', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const json = jest.fn(async () => ({ success: true }));
    fetchSpy.mockResolvedValue({ ok: false, status: 503, json } as unknown as Response);

    await expect(service.validate('tok')).resolves.toBe(false);

    expect(json).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Turnstile verification returned a non-OK status', {
      status: 503,
    });
    errorSpy.mockRestore();
  });

  describe('when siteverify stalls', () => {
    let errorSpy: jest.SpyInstance;
    let timeoutSpy: jest.SpyInstance;
    let deadline: AbortController;

    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      // AbortSignal.timeout runs on Node-internal timers that fake timers do not
      // touch, so hand the service a signal the test fires itself.
      deadline = new AbortController();
      timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
      // A stalled peer: settles only when the caller's signal aborts, as real fetch does.
      fetchSpy.mockImplementation(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      );
    });

    afterEach(() => {
      errorSpy.mockRestore();
      timeoutSpy.mockRestore();
    });

    it('arms the call with the Turnstile budget', async () => {
      const result = service.validate('tok');
      expect(timeoutSpy).toHaveBeenCalledWith(TURNSTILE_VERIFY_TIMEOUT_MS);
      expect(fetchSpy.mock.calls[0][1].signal).toBe(deadline.signal);
      deadline.abort();
      await result;
    });

    it('stays pending until the deadline fires, then fails closed', async () => {
      let settled = false;
      const result = service.validate('tok').then((valid) => {
        settled = true;
        return valid;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

      await expect(result).resolves.toBe(false);
    });

    it('logs the timeout distinctly from a rejected challenge or a failed request', async () => {
      const result = service.validate('tok');
      deadline.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      await result;

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('Turnstile verification timed out', {
        timeoutMs: TURNSTILE_VERIFY_TIMEOUT_MS,
      });
    });
  });
});
