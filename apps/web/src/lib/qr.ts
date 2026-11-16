import { encodeQR } from 'qr';

/**
 * Render an `otpauth://` URI as an SVG data URI suitable for an `<img src>`.
 *
 * The QR matrix is produced locally by the zero-dependency `qr` encoder, so the
 * TOTP secret embedded in the URI never leaves the browser and no network
 * request is made. We return a data URI (not raw `<svg>` markup) so callers
 * render it through an `<img>` element and never reach for
 * `dangerouslySetInnerHTML`.
 */
export function otpauthUriToQrDataUri(otpauthUri: string): string {
  const svg = encodeQR(otpauthUri, 'svg', { border: 2 });
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
