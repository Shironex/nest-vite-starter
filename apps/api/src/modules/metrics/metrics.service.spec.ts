import type { ConfigService } from '@nestjs/config';
import { collectDefaultMetrics } from 'prom-client';
import { MetricsService } from './metrics.service';

// prom-client's registry is process-global and rejects a second registration,
// which is the whole reason registration lives in a lifecycle hook. The spec
// replaces only the registration call, never the service under test.
jest.mock('prom-client', () => ({ collectDefaultMetrics: jest.fn() }));

const buildConfig = (version?: string): ConfigService =>
  ({
    get: jest.fn((key: string) => (key === 'APP_VERSION' ? version : undefined)),
  }) as unknown as ConfigService;

describe('MetricsService', () => {
  beforeEach(() => {
    jest.mocked(collectDefaultMetrics).mockClear();
  });

  it('registers nothing at construction: registration waits for the bootstrap hook', () => {
    new MetricsService(buildConfig('1.2.3'));

    expect(collectDefaultMetrics).not.toHaveBeenCalled();
  });

  it('registers the default process metrics under the api_ prefix on bootstrap', () => {
    new MetricsService(buildConfig('1.2.3')).onApplicationBootstrap();

    expect(collectDefaultMetrics).toHaveBeenCalledTimes(1);
    expect(collectDefaultMetrics).toHaveBeenCalledWith({
      prefix: 'api_',
      labels: { service: 'api', version: '1.2.3' },
    });
  });

  it('labels the version "dev" when APP_VERSION is not configured', () => {
    new MetricsService(buildConfig(undefined)).onApplicationBootstrap();

    expect(collectDefaultMetrics).toHaveBeenCalledWith({
      prefix: 'api_',
      labels: { service: 'api', version: 'dev' },
    });
  });
});
