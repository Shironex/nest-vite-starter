import { Controller, Post, Body, BadRequestException, HttpCode } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { Histogram } from 'prom-client';

/**
 * Schema for the web-vitals payload sent by the browser via navigator.sendBeacon.
 *
 * Metric names are the canonical web-vitals identifiers. Value is the raw
 * metric value in milliseconds (LCP/FCP/TTFB/INP) or unitless score (CLS).
 * Time-based metrics are recorded in seconds for histogram consistency with
 * http_request_duration_seconds; CLS is recorded raw in its own unitless
 * histogram.
 */
const VitalPayloadSchema = z.object({
  name: z.enum(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']),
  value: z.number().finite().nonnegative(),
  id: z.string().max(64),
  navigationType: z
    .enum(['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore', ''])
    .optional(),
});

type VitalPayload = z.infer<typeof VitalPayloadSchema>;

/**
 * Histogram buckets tuned for the time-based web vitals (milliseconds / 1000).
 * CLS does NOT record here: it is a unitless score, and dividing it by 1000
 * crushed every observation (good <= 0.1, poor >= 0.25 become 0.0001..0.00025)
 * into the first bucket, making the metric useless. It has its own unitless
 * histogram below.
 */
const webVitalsHistogram = new Histogram({
  name: 'web_vitals_seconds',
  help: 'Time-based Web Vital metric values in seconds (FCP/INP/LCP/TTFB), labeled by metric name',
  labelNames: ['metric'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 4, 10],
});

/**
 * CLS-specific histogram: unitless score, recorded as-is (no ms conversion).
 * Buckets straddle the web-vitals thresholds (good <= 0.1, needs-improvement
 * <= 0.25, poor above) with resolution on both sides.
 */
const clsHistogram = new Histogram({
  name: 'web_vitals_cls',
  help: 'Cumulative Layout Shift score (unitless), recorded without unit conversion',
  buckets: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 0.75, 1],
});

/**
 * Unauthenticated ingest endpoint for web-vitals beacons.
 *
 * The browser fires navigator.sendBeacon at page unload (or on next paint for
 * INP/CLS), before any session may exist. Must NOT be behind auth or tRPC.
 *
 * The beacon ships its JSON as a text/plain Blob (CORS-simple, so the packaged
 * Electron app:// origin needs no preflight); main.ts registers the text body
 * parser and this handler JSON-parses the string. A plain-JSON body is still
 * accepted for compatibility with direct application/json posts.
 *
 * Rate limiting is provided by the global ThrottlerGuard (APP_GUARD).
 * CSRF is exempted in main.ts because sendBeacon cannot include custom headers.
 *
 * Label: only {metric} (CLS|FCP|INP|LCP|TTFB). No userId, sessionId, or URL.
 */
@Controller('api/vitals')
export class VitalsController {
  @Post()
  @HttpCode(204)
  @SkipThrottle({ default: false })
  ingest(@Body() body: unknown): void {
    let payload: unknown = body;
    if (typeof body === 'string') {
      try {
        payload = JSON.parse(body);
      } catch {
        throw new BadRequestException('Invalid vitals payload');
      }
    }
    const result = VitalPayloadSchema.safeParse(payload);
    if (!result.success) {
      throw new BadRequestException('Invalid vitals payload');
    }
    const { name, value }: VitalPayload = result.data;
    // CLS is a unitless score: record it raw in its own histogram. The time
    // metrics (LCP/FCP/INP/TTFB) arrive in milliseconds and normalize to
    // seconds for consistency with http_request_duration_seconds.
    if (name === 'CLS') {
      clsHistogram.observe(value);
      return;
    }
    webVitalsHistogram.labels(name).observe(value / 1000);
  }
}
