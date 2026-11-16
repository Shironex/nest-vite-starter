import { BadRequestException } from '@nestjs/common';
import { register } from 'prom-client';
import { VitalsController } from './vitals.controller';

type HistogramValue = { metricName?: string; value: number; labels: Record<string, string> };

const histogramSum = async (name: string, labels: Record<string, string> = {}) => {
  const metric = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} not registered`);
  const { values } = (await metric.get()) as { values: HistogramValue[] };
  const sumEntry = values.find(
    (v) =>
      v.metricName === `${name}_sum` &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return sumEntry?.value ?? 0;
};

describe('VitalsController', () => {
  const controller = new VitalsController();
  const validPayload = { name: 'LCP', value: 1234, id: 'v1-abc' };

  it('accepts a parsed JSON object body (application/json)', () => {
    expect(() => controller.ingest(validPayload)).not.toThrow();
  });

  it('accepts the beacon text/plain body: a JSON string', () => {
    // The web client posts JSON inside a text/plain Blob so sendBeacon stays a
    // CORS-simple request from the packaged Electron origin.
    expect(() => controller.ingest(JSON.stringify(validPayload))).not.toThrow();
  });

  it('rejects a non-JSON string body', () => {
    expect(() => controller.ingest('not json')).toThrow(BadRequestException);
  });

  it('rejects a JSON string that fails the payload schema', () => {
    expect(() => controller.ingest(JSON.stringify({ name: 'NOPE', value: 1, id: 'x' }))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an object that fails the payload schema', () => {
    expect(() => controller.ingest({ name: 'LCP', value: -1, id: 'x' })).toThrow(
      BadRequestException,
    );
  });

  describe('unit handling', () => {
    it('records CLS raw (unitless) in web_vitals_cls, not divided by 1000', async () => {
      const before = await histogramSum('web_vitals_cls');
      controller.ingest({ name: 'CLS', value: 0.25, id: 'v1-cls' });
      const after = await histogramSum('web_vitals_cls');
      // A "poor" CLS of 0.25 must land as 0.25; the old /1000 would have
      // recorded 0.00025 and crushed it into the first bucket.
      expect(after - before).toBeCloseTo(0.25, 10);
    });

    it('does not record CLS in the seconds histogram', async () => {
      const before = await histogramSum('web_vitals_seconds', { metric: 'CLS' });
      controller.ingest({ name: 'CLS', value: 0.1, id: 'v1-cls2' });
      const after = await histogramSum('web_vitals_seconds', { metric: 'CLS' });
      expect(after).toBe(before);
    });

    it('still converts time-based metrics from ms to seconds', async () => {
      const before = await histogramSum('web_vitals_seconds', { metric: 'TTFB' });
      controller.ingest({ name: 'TTFB', value: 500, id: 'v1-ttfb' });
      const after = await histogramSum('web_vitals_seconds', { metric: 'TTFB' });
      expect(after - before).toBeCloseTo(0.5, 10);
    });
  });
});
