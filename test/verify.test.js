import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify, todayInMontevideo, decodePublicKey } from '../verify.js';
import { PUBLIC_KEY, PLACEHOLDER_PUBLIC_KEY } from '../config.js';

const vectors = JSON.parse(readFileSync(new URL('../../test-vectors.json', import.meta.url), 'utf8'));
const key = vectors.testPublicKey;

for (const scan of vectors.scans) {
  test(`scan vector: ${scan.why} (today ${scan.today}) -> ${scan.expect}`, () => {
    const result = verify(scan.qr, scan.today, key);
    assert.equal(result.verdict, scan.expect);
    if (scan.expect === 'INVALID') {
      assert.equal(result.from, null);
      assert.equal(result.to, null);
    } else {
      const [, from, to] = scan.qr.split('.');
      assert.deepEqual(result, { verdict: scan.expect, from, to });
    }
  });
}

const good = vectors.scans.find(s => s.expect === 'VALID').qr;

test('rejects whitespace, lowercase prefix and non-string input', () => {
  for (const qr of [` ${good}`, `${good}\n`, good.replace('CEIBOS1', 'ceibos1'), null, undefined, 42]) {
    assert.equal(verify(qr, '2026-10-10', key).verdict, 'INVALID');
  }
});

test('rejects a non-canonical signature encoding (non-zero trailing bits)', () => {
  const last = good.at(-1);
  // 86 base64url chars carry 516 bits for 512; the last char's low 4 bits must be zero.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const twin = alphabet[alphabet.indexOf(last) | 1];
  assert.notEqual(twin, last);
  assert.equal(verify(good.slice(0, -1) + twin, '2026-10-10', key).verdict, 'INVALID');
});

test('a malformed public key throws (configuration error, not a scan verdict)', () => {
  assert.throws(() => verify(good, '2026-10-10', PLACEHOLDER_PUBLIC_KEY));
  assert.throws(() => decodePublicKey(''));
  assert.equal(decodePublicKey(key).length, 32);
});

test('config.js still ships the placeholder, not the test key', () => {
  assert.equal(PUBLIC_KEY, PLACEHOLDER_PUBLIC_KEY);
  assert.notEqual(PUBLIC_KEY, vectors.testPublicKey);
});

test('todayInMontevideo: 2026-10-10T02:30Z is still 2026-10-09 in Montevideo (UTC-3)', () => {
  assert.equal(todayInMontevideo(new Date('2026-10-10T02:30:00Z')), '2026-10-09');
  assert.equal(todayInMontevideo(new Date('2026-10-10T02:59:59Z')), '2026-10-09');
  assert.equal(todayInMontevideo(new Date('2026-10-10T03:00:00Z')), '2026-10-10');
  assert.equal(todayInMontevideo(new Date('2026-10-12T23:30:00Z')), '2026-10-12');
});

test('todayInMontevideo: year boundary', () => {
  assert.equal(todayInMontevideo(new Date('2027-01-01T02:00:00Z')), '2026-12-31');
  assert.equal(todayInMontevideo(new Date('2027-01-01T03:00:00Z')), '2027-01-01');
});

test('end to end: Sunday 23:30 local is VALID, Monday 00:30 local is EXPIRED', () => {
  assert.equal(verify(good, todayInMontevideo(new Date('2026-10-12T02:30:00Z')), key).verdict, 'VALID');
  assert.equal(verify(good, todayInMontevideo(new Date('2026-10-12T03:30:00Z')), key).verdict, 'EXPIRED');
});
