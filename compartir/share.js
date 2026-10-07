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

const WHATSAPP_WEB_URL = 'https://web.whatsapp.com/';

let pngFile = null;
let pngUrl = null;

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

function fallbackShare() {
  downloadPng();
  $('fallback').hidden = false;
  $('fallback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** Phones share the image through the share sheet; computers go through WhatsApp Web. */
function isPhone() {
  if (navigator.userAgentData) return navigator.userAgentData.mobile;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function showDesktopHint(copied) {
  $('desktop-copied').hidden = !copied;
  $('desktop-downloaded').hidden = copied;
  $('desktop-paste').hidden = !copied;
  $('desktop-attach').hidden = copied;
  $('desktop-hint').hidden = false;
}

// WhatsApp Web can't receive an image through a link, so the image goes to the clipboard
// (or is downloaded) and the user pastes it into the chat. The named target reuses an
// already open WhatsApp Web tab. The hint's own link covers a blocked popup.
function shareOnDesktop() {
  const open = () => window.open(WHATSAPP_WEB_URL, 'whatsapp-web');
  const copy = navigator.clipboard && window.ClipboardItem
    ? navigator.clipboard.write([new ClipboardItem({ 'image/png': pngFile })])
    : Promise.reject(new Error('no image clipboard'));
  copy.then(
    () => { showDesktopHint(true); open(); },
    () => { downloadPng(); showDesktopHint(false); open(); },
  );
}

// Only the image, no text: some apps (WhatsApp on iPhone in particular) drop the image or
// fail when a share carries both. The image already has the dates written on it.
function share() {
  const data = { files: [pngFile] };
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
  // Inside a frame (e.g. Google's) the share sheet and clipboard are blocked: the button
  // reopens this page as its own tab instead.
  if (window.top !== window.self) {
    $('share').addEventListener('click', () => window.open(location.href, '_blank', 'noopener'));
  }
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

  // Built before any tap, so the share call runs inside the user gesture.
  const canvas = drawCard(code, shortLabel);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  pngFile = new File([blob], `ceibos-pase-${from}.png`, { type: 'image/png' });
  pngUrl = URL.createObjectURL(blob);
  $('pass-image').src = pngUrl;
  $('pass').hidden = false;

  if (window.top !== window.self) {
    // Handled at the top of main().
  } else if (isPhone()) {
    $('share').addEventListener('click', share);
  } else {
    $('share').textContent = 'Compartir por WhatsApp Web';
    if (/Mac/.test(navigator.platform || navigator.userAgent)) $('paste-keys').textContent = '⌘V';
    $('share').addEventListener('click', shareOnDesktop);
  }
}

// Only the fragment changes when a new code is opened in the same tab; start over.
addEventListener('hashchange', () => location.reload());

main().catch(err => showError(`Algo salió mal: ${err.message}`));
