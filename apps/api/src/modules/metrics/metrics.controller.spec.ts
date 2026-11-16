import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

const metricsBody = '# HELP api_up\napi_up 1\n';
const metricsMock = jest.fn().mockResolvedValue(metricsBody);

jest.mock('prom-client', () => ({
  collectDefaultMetrics: jest.fn(),
  register: {
    contentType: 'text/plain; version=0.0.4',
    metrics: () => metricsMock(),
  },
}));

import { MetricsController } from './metrics.controller';

const buildController = (basicAuth: string | undefined) => {
  const config = {
    get: jest.fn((key: string) => (key === 'METRICS_BASIC_AUTH' ? basicAuth : undefined)),
  } as unknown as ConfigService;
  return new MetricsController(config);
};

const buildReq = (headers: Record<string, string> = {}) => ({ headers }) as unknown as Request;

const buildRes = () => ({}) as unknown as Response;

describe('MetricsController', () => {
  beforeEach(() => {
    metricsMock.mockClear();
    metricsMock.mockResolvedValue(metricsBody);
  });

  it('returns metrics body without auth check when METRICS_BASIC_AUTH is unset', async () => {
    const ctrl = buildController(undefined);
    const result = await ctrl.metrics(buildReq(), buildRes());
    expect(result).toBe(metricsBody);
  });

  it('throws UnauthorizedException("basic auth required") when header missing', async () => {
    const ctrl = buildController('user:pass');
    await expect(ctrl.metrics(buildReq(), buildRes())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(ctrl.metrics(buildReq(), buildRes())).rejects.toThrow('basic auth required');
  });

  it('throws UnauthorizedException when Authorization does not start with "Basic "', async () => {
    const ctrl = buildController('user:pass');
    await expect(
      ctrl.metrics(buildReq({ authorization: 'Bearer token' }), buildRes()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      ctrl.metrics(buildReq({ authorization: 'Bearer token' }), buildRes()),
    ).rejects.toThrow('basic auth required');
  });

  it('throws UnauthorizedException("invalid metrics credentials") on credential mismatch', async () => {
    const ctrl = buildController('user:pass');
    const wrong = Buffer.from('user:wrong').toString('base64');
    await expect(
      ctrl.metrics(buildReq({ authorization: `Basic ${wrong}` }), buildRes()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      ctrl.metrics(buildReq({ authorization: `Basic ${wrong}` }), buildRes()),
    ).rejects.toThrow('invalid metrics credentials');
  });

  it('returns metrics body when credentials match', async () => {
    const ctrl = buildController('user:pass');
    const ok = Buffer.from('user:pass').toString('base64');
    const result = await ctrl.metrics(buildReq({ authorization: `Basic ${ok}` }), buildRes());
    expect(result).toBe(metricsBody);
  });
});
