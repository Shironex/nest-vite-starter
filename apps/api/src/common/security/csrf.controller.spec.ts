import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { CSRF_TOKEN_PATH } from '@repo/shared/constants';
import { CsrfController } from './csrf.controller';
import { CsrfService } from './csrf.service';
import { expressMocks } from '@test/fixtures';

const buildSubject = async () => {
  const csrf = { generate: jest.fn().mockReturnValue('token-123') };
  const module = await Test.createTestingModule({
    controllers: [CsrfController],
    providers: [{ provide: CsrfService, useValue: csrf }],
  }).compile();
  return { controller: module.get(CsrfController), csrf };
};

describe('CsrfController', () => {
  it('is mounted at the shared CSRF_TOKEN_PATH wire contract (single source of truth)', () => {
    // 'path' is Nest's PATH_METADATA key (@Controller stores its prefix there).
    const controllerPath = Reflect.getMetadata('path', CsrfController) as string;
    expect(`/${controllerPath}`).toBe(CSRF_TOKEN_PATH);
  });

  it('returns exactly { csrfToken } from CsrfService.generate(req, res)', async () => {
    const { controller, csrf } = await buildSubject();
    const { req, res } = expressMocks({ method: 'GET' });
    const body = controller.getToken(req, res);
    // The web client (apps/web/src/lib/csrf.ts) and its 403 self-heal parse
    // this exact shape; generate receives req AND res so it can set the token
    // cookie on the response (passthrough mode keeps that side effect).
    expect(body).toEqual({ csrfToken: 'token-123' });
    expect(csrf.generate).toHaveBeenCalledTimes(1);
    expect(csrf.generate).toHaveBeenCalledWith(req, res);
  });

  it('declares a per-route throttle tighter than the global 100/60s default', () => {
    const handler = CsrfController.prototype.getToken;
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as number;
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as number;
    expect(limit).toBe(30);
    expect(ttl).toBe(60000);
    expect(limit).toBeLessThan(100);
  });
});
