import { decodeQR } from 'qr/decode.js';
import { describe, expect, it } from 'vitest';
import { otpauthUriToQrDataUri } from './qr';

const URI =
  'otpauth://totp/SaaSStarter:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=SaaSStarter';
const PIXELS_PER_MODULE = 8;

/**
 * Rasterize the encoder's SVG back into pixels. The path is one unit square per
 * dark module, each subpath opened by an absolute `M x y` or by an `m dx dy`
 * relative to the previous subpath's start (a `Z` returns the pen there).
 */
function rasterise(svg: string): { width: number; height: number; data: Uint8Array } {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!viewBox) throw new Error('SVG has no viewBox');
  const modulesX = Number(viewBox[1]);
  const modulesY = Number(viewBox[2]);
  const width = modulesX * PIXELS_PER_MODULE;
  const height = modulesY * PIXELS_PER_MODULE;
  const data = new Uint8Array(width * height * 3).fill(255);

  let x = 0;
  let y = 0;
  for (const [, command, a, b] of svg.matchAll(/([Mm])(-?\d+)[ ,](-?\d+)/g)) {
    x = command === 'M' ? Number(a) : x + Number(a);
    y = command === 'M' ? Number(b) : y + Number(b);
    for (let py = y * PIXELS_PER_MODULE; py < (y + 1) * PIXELS_PER_MODULE; py++) {
      for (let px = x * PIXELS_PER_MODULE; px < (x + 1) * PIXELS_PER_MODULE; px++) {
        data.fill(0, (py * width + px) * 3, (py * width + px) * 3 + 3);
      }
    }
  }
  return { width, height, data };
}

describe('otpauthUriToQrDataUri', () => {
  it('encodes an otpauth URI as an inline SVG data URI (no network)', () => {
    const dataUri = otpauthUriToQrDataUri(URI);
    expect(dataUri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(dataUri)).toContain('<svg');
  });

  it('renders a QR code an authenticator app scans back to the exact otpauth URI', () => {
    const svg = decodeURIComponent(otpauthUriToQrDataUri(URI).slice('data:image/svg+xml,'.length));
    expect(decodeQR(rasterise(svg), { format: 'RGB' })).toBe(URI);
  });
});
