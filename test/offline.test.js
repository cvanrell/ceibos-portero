// Guards the offline promise: every runtime file is precached by sw.js and every
// precached file exists, so a missing entry can't silently break the gate offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const assets = JSON.parse(
  sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'),
);

const NOT_SERVED = new Set(['sw.js', 'package.json', 'package-lock.json']);
const NOT_SERVED_DIRS = new Set(['node_modules', 'test', 'tools']);
// Served, but deliberately online-only: the generator short link and the privacy page.
const ONLINE_ONLY_DIRS = new Set(['pase', 'privacidad']);

function runtimeFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return NOT_SERVED_DIRS.has(name) || ONLINE_ONLY_DIRS.has(name) ? [] : runtimeFiles(path);
    }
    const rel = relative(root, path);
    return NOT_SERVED.has(rel) || name === 'LICENSE' || name.startsWith('.') ? [] : [rel];
  });
}

test('every precached asset exists', () => {
  for (const asset of assets) {
    if (asset === './') continue;
    assert.ok(existsSync(join(root, asset)), `missing ${asset}`);
  }
});

test('every runtime file is precached', () => {
  for (const file of runtimeFiles(root)) {
    assert.ok(assets.includes(`./${file}`), `${file} is not in sw.js ASSETS`);
  }
});

test('no runtime file loads anything from another origin', () => {
  for (const file of ['index.html', 'app.js', 'verify.js', 'config.js', 'styles.css', 'manifest.webmanifest']) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /(src|href)=["']https?:|import\s[^;]*["']https?:|url\(["']?https?:/, file);
  }
});

test('the service worker only handles the scanner page and its own files', () => {
  // Run sw.js with a minimal worker global and record which fetches it answers.
  const scope = 'https://example.github.io/ceibos-portero/';
  const listeners = {};
  const self = {
    location: new URL(`${scope}sw.js`),
    registration: { scope },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  // Cache calls never settle: this test is about routing, not caching.
  const pending = () => new Promise(() => {});
  new Function('self', 'caches', 'fetch', sw)(self, { open: pending, keys: pending }, pending);
  const handled = (path, mode = 'no-cors') => {
    let answered = false;
    listeners.fetch({ request: { method: 'GET', url: scope + path, mode }, respondWith: () => { answered = true; } });
    return answered;
  };

  assert.ok(handled('', 'navigate'));
  assert.ok(handled('index.html', 'navigate'));
  assert.ok(handled('?v=1', 'navigate'));
  assert.ok(handled('app.js'));
  assert.ok(handled('verify.js'));
  assert.ok(handled('vendor/jsqr/jsQR.js'));
  assert.ok(!handled('pase/', 'navigate'));
  assert.ok(!handled('pase/index.html'));

  assert.ok(existsSync(join(root, 'pase', 'index.html')));
  assert.ok(!assets.some(asset => /^\.\/pase\//.test(asset)), 'online-only pages must not be precached');
});
