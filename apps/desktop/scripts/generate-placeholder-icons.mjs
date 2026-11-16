/**
 * Generate placeholder icons for electron-builder packaging.
 * Creates minimal valid PNG (1024x1024) and ICO (256x256) files.
 * These are solid-color placeholders; replace with real icons before distribution.
 *
 * Usage: node scripts/generate-placeholder-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resourcesDir = resolve(__dirname, '../resources');

mkdirSync(resourcesDir, { recursive: true });

/**
 * Create a minimal valid PNG file with a solid color.
 * PNG format: signature + IHDR + IDAT + IEND chunks.
 */
function createPng(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit depth (8), color type (2 = RGB)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // Raw image data: filter byte (0) + RGB pixels per row
  const rowSize = 1 + width * 3; // filter byte + pixel data
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  const compressed = deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * Create a PNG chunk with CRC.
 */
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * CRC-32 calculation for PNG chunks.
 */
function crc32(buf) {
  // Build CRC table
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Create a minimal valid ICO file from a BMP image.
 * ICO format: header + directory entry + BMP data (without file header).
 */
function createIco(width, height, r, g, b) {
  // BMP pixel data (bottom-up, BGRA)
  const rowBytes = width * 4;
  // BMP rows must be aligned to 4 bytes (already aligned since width * 4 is always divisible by 4)
  const pixelData = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * rowBytes + x * 4;
      pixelData[offset] = b; // blue
      pixelData[offset + 1] = g; // green
      pixelData[offset + 2] = r; // red
      pixelData[offset + 3] = 255; // alpha
    }
  }

  // AND mask (transparency mask) - all zeros (fully opaque)
  const andMaskRowBytes = Math.ceil(width / 8);
  const andMaskRowPadded = Math.ceil(andMaskRowBytes / 4) * 4;
  const andMask = Buffer.alloc(andMaskRowPadded * height);

  // BMP info header (BITMAPINFOHEADER - 40 bytes)
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0); // header size
  bmpHeader.writeInt32LE(width, 4); // width
  bmpHeader.writeInt32LE(height * 2, 8); // height (doubled for ICO: includes AND mask)
  bmpHeader.writeUInt16LE(1, 12); // planes
  bmpHeader.writeUInt16LE(32, 14); // bits per pixel
  bmpHeader.writeUInt32LE(0, 16); // compression (none)
  bmpHeader.writeUInt32LE(pixelData.length + andMask.length, 20); // image size
  // Rest are zeros (resolution, colors)

  const imageData = Buffer.concat([bmpHeader, pixelData, andMask]);

  // ICO header (6 bytes)
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // number of images

  // ICO directory entry (16 bytes)
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width; // width (0 = 256)
  entry[1] = height >= 256 ? 0 : height; // height (0 = 256)
  entry[2] = 0; // color palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(imageData.length, 8); // image data size
  entry.writeUInt32LE(6 + 16, 12); // offset to image data

  return Buffer.concat([icoHeader, entry, imageData]);
}

// Generate icons with a blue-ish color (#3B82F6 - Tailwind blue-500)
const r = 59,
  g = 130,
  b = 246;

console.log('Generating placeholder icons...');

// 1024x1024 PNG for macOS/Linux
const png = createPng(1024, 1024, r, g, b);
writeFileSync(resolve(resourcesDir, 'icon.png'), png);
console.log('  Created resources/icon.png (1024x1024)');

// 256x256 ICO for Windows
const ico = createIco(256, 256, r, g, b);
writeFileSync(resolve(resourcesDir, 'icon.ico'), ico);
console.log('  Created resources/icon.ico (256x256)');

// Note: .icns is not generated; electron-builder creates it from icon.png on macOS
console.log('  Skipped resources/icon.icns (electron-builder generates from icon.png on macOS)');

console.log('Done. Replace these placeholders with real icons before distribution.');
