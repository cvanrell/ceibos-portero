// Copies the runtime libraries from node_modules into vendor/ (committed), so the
// scanner loads nothing from a CDN. Run after `npm install`: `npm run vendor`.
import { copyFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const files = [
  ['node_modules/tweetnacl/nacl-fast.js', 'vendor/tweetnacl/nacl-fast.js'],
  ['node_modules/tweetnacl/LICENSE', 'vendor/tweetnacl/LICENSE'],
  ['node_modules/jsqr/dist/jsQR.js', 'vendor/jsqr/jsQR.js'],
  ['node_modules/jsqr/LICENSE', 'vendor/jsqr/LICENSE'],
];

for (const [from, to] of files) {
  mkdirSync(new URL(to.slice(0, to.lastIndexOf('/') + 1), root), { recursive: true });
  copyFileSync(new URL(from, root), new URL(to, root));
  console.log(`${from} -> ${to}`);
}
