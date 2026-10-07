// Draws the app icons (a stylised QR mark on green) without any image tooling:
// writes icons/icon.svg, icons/icon-192.png and icons/icon-512.png.
// Run: `npm run icons`. The artwork fits the maskable-icon safe zone.
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const GREEN = [0x15, 0x6b, 0x35];
const WHITE = [0xff, 0xff, 0xff];

// Shapes on a 100x100 canvas: [x, y, w, h, colour].
const shapes = [];
const finder = (x, y) => {
  shapes.push([x, y, 18, 18, WHITE], [x + 3, y + 3, 12, 12, GREEN], [x + 6, y + 6, 6, 6, WHITE]);
};
finder(25, 25);
finder(57, 25);
finder(25, 57);
for (const [x, y] of [[57, 57], [66, 57], [57, 66], [69, 69], [62, 72], [72, 62]]) {
  shapes.push([x, y, 6, 6, WHITE]);
}

const hex = ([r, g, b]) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
const svg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
  `<rect width="100" height="100" rx="22" fill="${hex(GREEN)}"/>`,
  ...shapes.map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hex(c)}"/>`),
  '</svg>',
  '',
].join('\n');

function png(size) {
  const image = new PNG({ width: size, height: size });
  const scale = size / 100;
  const paint = (x0, y0, w, h, [r, g, b]) => {
    for (let y = Math.round(y0 * scale); y < Math.round((y0 + h) * scale); y++) {
      for (let x = Math.round(x0 * scale); x < Math.round((x0 + w) * scale); x++) {
        const i = (y * size + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
  };
  // PNGs are full-bleed squares so they also work as maskable icons.
  paint(0, 0, 100, 100, GREEN);
  for (const s of shapes) paint(...s);
  return PNG.sync.write(image);
}

const dir = new URL('../icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('icon.svg', dir), svg);
writeFileSync(new URL('icon-192.png', dir), png(192));
writeFileSync(new URL('icon-512.png', dir), png(512));
console.log('wrote icons/icon.svg, icons/icon-192.png, icons/icon-512.png');
