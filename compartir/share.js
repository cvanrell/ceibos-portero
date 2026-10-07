// Share page for the weekend pass: draws the QR card for the code in the URL
// fragment and hands it to the phone's share sheet (WhatsApp).
import { verify, todayInMontevideo } from '../verify.js';
import { PUBLIC_KEY } from '../config.js';

const $ = id => document.getElementById(id);
const qrcode = globalThis.qrcode; // classic script: vendor/qrcode-generator/qrcode.js

const CARD_WIDTH = 1080;
const CARD_PADDING = 60;
const QUIET_ZONE_MODULES = 4;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let pngFile = null;
let pngUrl = null;
let waText = '';

function splitYmd(text) {
  const [year, month, day] = text.split('-').map(Number);
  return { year, month, day };
}

/** "Vale del viernes 9 al domingo 11 de octubre" (month named twice if it changes). */
function describeLong(from, to) {
  const f = splitYmd(from);
  const t = splitYmd(to);
  const fromPart = `viernes ${f.day}${f.month === t.month ? '' : ` de ${MONTHS[f.month - 1]}`}`;
  return `Vale del ${fromPart} al domingo ${t.day} de ${MONTHS[t.month - 1]}`;
}

/** "vale del vie 9/10 al dom 11/10" */
function describeShort(from, to) {
  const f = splitYmd(from);
  const t = splitYmd(to);
  return `vale del vie ${f.day}/${f.month} al dom ${t.day}/${t.month}`;
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}

/** QR on white plus a caption, at a fixed high resolution (same card as the generator). */
function drawCard(code, shortLabel) {
  const qr = qrcode(0, 'M');
  qr.addData(code);
  qr.make();
  const modules = qr.getModuleCount();
  const scale = Math.floor((CARD_WIDTH - 2 * CARD_PADDING) / (modules + 2 * QUIET_ZONE_MODULES));
  const qrSize = scale * (modules + 2 * QUIET_ZONE_MODULES);
  const qrLeft = Math.floor((CARD_WIDTH - qrSize) / 2);
  const qrTop = CARD_PADDING / 2;
  const height = qrTop + qrSize + 190;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  ctx.fillStyle = '#000000';
  const origin = QUIET_ZONE_MODULES * scale;
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(qrLeft + origin + col * scale, qrTop + origin + row * scale, scale, scale);
      }
    }
  }

  const caption = `Ceibos — ${shortLabel}`;
  const maxTextWidth = CARD_WIDTH - 2 * CARD_PADDING;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#111111';
  let size = 60;
  do {
    ctx.font = `bold ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    size -= 2;
  } while (ctx.measureText(caption).width > maxTextWidth && size > 20);
  ctx.fillText(caption, CARD_WIDTH / 2, qrTop + qrSize + 80);

  ctx.fillStyle = '#555555';
  ctx.font = '40px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Pase para entrar con el auto', CARD_WIDTH / 2, qrTop + qrSize + 145);
  return canvas;
}

function canShare(data) {
  try {
    return Boolean(navigator.canShare && navigator.canShare(data));
  } catch {
    return false;
  }
}

function downloadPng() {
  const a = document.createElement('a');
  a.href = pngUrl;
  a.download = pngFile.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// No window.open here: after an async share failure the tap no longer counts as a user
// gesture and the popup would be blocked, so the user taps "Abrir WhatsApp" instead.
function fallbackShare() {
  downloadPng();
  $('fallback').hidden = false;
  $('fallback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function share() {
  const withText = { files: [pngFile], text: waText };
  const data = canShare(withText) ? withText : { files: [pngFile] };
  if (!navigator.share || !canShare(data)) {
    fallbackShare();
    return;
  }
  navigator.share(data).catch(err => {
    if (err && err.name === 'AbortError') return; // the user closed the share sheet
    fallbackShare();
  });
}

async function main() {
  const code = decodeURIComponent(location.hash.slice(1));
  if (!code) {
    showError('Este enlace no trae ningún pase. Abrilo desde el generador del pase de fin de semana.');
    return;
  }
  const result = verify(code, todayInMontevideo(), PUBLIC_KEY);
  if (result.verdict === 'INVALID') {
    showError('Este enlace no tiene un pase válido de Ceibos. Abrilo de nuevo desde el generador.');
    return;
  }
  if (typeof qrcode !== 'function') {
    showError('No se pudo cargar el generador de QR. Recargá la página.');
    return;
  }

  const { from, to } = result;
  const shortLabel = describeShort(from, to);
  $('when').textContent = describeLong(from, to);
  if (result.verdict === 'EXPIRED') {
    $('expired').hidden = false;
    return;
  }

  waText = `Pase de Ceibos para entrar con el auto, ${shortLabel}. Mostrá el QR de la imagen en el portón.`;
  $('wa-link').href = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  // Built before any tap, so the share call runs inside the user gesture.
  const canvas = drawCard(code, shortLabel);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  pngFile = new File([blob], `ceibos-pase-${from}.png`, { type: 'image/png' });
  pngUrl = URL.createObjectURL(blob);
  $('pass-image').src = pngUrl;
  $('pass').hidden = false;

  $('share').addEventListener('click', share);
}

// Only the fragment changes when a new code is opened in the same tab; start over.
addEventListener('hashchange', () => location.reload());

main().catch(err => showError(`Algo salió mal: ${err.message}`));
