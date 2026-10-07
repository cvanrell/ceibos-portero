// Pure verification logic for the Ceibos weekend pass (see ../CONTRACT.md).
// No DOM access: this module runs unchanged in the browser and in Node tests.

// tweetnacl is a UMD script; loaded as an ES module it attaches itself to `self.nacl`.
import './vendor/tweetnacl/nacl-fast.js';

const nacl = globalThis.nacl;

export const TIME_ZONE = 'America/Montevideo';

const QR_PATTERN = /^CEIBOS1\.(\d{4}-\d{2}-\d{2})\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{86})$/;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Decodes unpadded base64url. Returns null on any non-canonical input
 * (bad characters, impossible length, or non-zero trailing bits), so that
 * exactly one text encodes each byte string.
 */
export function decodeBase64url(text) {
  if (typeof text !== 'string' || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let pos = 0;
  for (const ch of text) {
    const value = B64URL.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (buffer >> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0) return null; // leftover bits must be zero
  return out;
}

/** True when `iso` is `YYYY-MM-DD` and names a real calendar date. */
function isRealDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Decodes a configured public key; throws if it is not a raw 32-byte Ed25519 key in base64url. */
export function decodePublicKey(publicKeyB64url) {
  const key = decodeBase64url(publicKeyB64url);
  if (!key || key.length !== nacl.sign.publicKeyLength) {
    throw new Error('Public key must be a raw 32-byte Ed25519 key encoded as unpadded base64url (43 chars).');
  }
  return key;
}

/**
 * Checks a scanned QR text.
 * @param {string} qrText          raw text decoded from the QR
 * @param {string} todayISO        today's date in America/Montevideo, `YYYY-MM-DD`
 * @param {string} publicKeyB64url the issuer's Ed25519 public key (throws if malformed)
 * @returns {{verdict: 'INVALID'|'NOT_YET'|'VALID'|'EXPIRED', from: string|null, to: string|null}}
 */
export function verify(qrText, todayISO, publicKeyB64url) {
  const publicKey = decodePublicKey(publicKeyB64url);
  const invalid = { verdict: 'INVALID', from: null, to: null };

  const match = typeof qrText === 'string' ? QR_PATTERN.exec(qrText) : null;
  if (!match) return invalid;
  const [, from, to, signatureText] = match;
  if (!isRealDate(from) || !isRealDate(to)) return invalid;

  const signature = decodeBase64url(signatureText);
  if (!signature || signature.length !== nacl.sign.signatureLength) return invalid;

  // Signature is checked before dates: a tampered code is INVALID, never EXPIRED.
  const message = new TextEncoder().encode(`CEIBOS1|${from}|${to}`);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) return invalid;

  // ISO dates compare correctly as strings.
  if (todayISO < from) return { verdict: 'NOT_YET', from, to };
  if (todayISO > to) return { verdict: 'EXPIRED', from, to };
  return { verdict: 'VALID', from, to };
}

const montevideoDate = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (`YYYY-MM-DD`) of the given instant in America/Montevideo. */
export function todayInMontevideo(date = new Date()) {
  const parts = Object.fromEntries(
    montevideoDate.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
