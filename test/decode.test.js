// Proves the camera-fallback decode path: QR text -> PNG (qrcode) -> RGBA pixels
// -> vendored jsQR -> same text -> verify().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import '../vendor/jsqr/jsQR.js'; // UMD: attaches to self.jsQR, as in the browser
import { verify } from '../verify.js';

const vectors = JSON.parse(readFileSync(new URL('../../test-vectors.json', import.meta.url), 'utf8'));

test('vendored jsQR round-trips a contract QR rendered by the qrcode package', async () => {
  const jsQR = globalThis.jsQR;
  assert.equal(typeof jsQR, 'function');

  const scan = vectors.scans.find(s => s.expect === 'VALID');
  const png = PNG.sync.read(await QRCode.toBuffer(scan.qr, { errorCorrectionLevel: 'M', scale: 6, margin: 4 }));
  const pixels = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length);

  const decoded = jsQR(pixels, png.width, png.height);
  assert.ok(decoded, 'jsQR found no QR code');
  assert.equal(decoded.data, scan.qr);
  assert.equal(verify(decoded.data, scan.today, vectors.testPublicKey).verdict, 'VALID');
});
