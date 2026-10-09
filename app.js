// UI + camera for the gatekeeper scanner. All verification logic lives in verify.js.
import { verify, todayInMontevideo, decodePublicKey, TIME_ZONE } from './verify.js';
import { PUBLIC_KEY, PLACEHOLDER_PUBLIC_KEY, TEST_PUBLIC_KEY } from './config.js';
import './vendor/jsqr/jsQR.js'; // UMD: attaches to self.jsQR (fallback decoder)

const RESULT_MS = 3000; // how long a verdict stays on screen
const SAME_CODE_COOLDOWN_MS = 1500; // ignore the code just shown for a moment after returning
const SCAN_INTERVAL_MS = 120;
const JSQR_MAX_SIDE = 800; // downscale frames for jsQR to keep it fast on old phones

const $ = id => document.getElementById(id);
const screens = ['loading', 'config', 'start', 'camera-error', 'scan', 'result'];
const video = $('video');

let state = 'idle'; // idle | starting | scanning | result | paused
let stream = null;
let detector = null; // BarcodeDetector when available
let scanTimer = null;
let resultTimer = null;
let lastText = null;
let ignoreLastUntil = 0;
let wakeLock = null;
let audioCtx = null;
let frameCanvas = null;
let startAttempt = 0;

// ---------- screens ----------

function show(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
}

// ---------- configuration ----------

const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function configProblem() {
  if (!PUBLIC_KEY || PUBLIC_KEY === PLACEHOLDER_PUBLIC_KEY) {
    return 'En config.js, PUBLIC_KEY todavía tiene el texto de ejemplo.';
  }
  try {
    decodePublicKey(PUBLIC_KEY);
  } catch {
    return 'La clave de config.js no tiene el formato correcto (deben ser 43 caracteres en base64url).';
  }
  if (PUBLIC_KEY === TEST_PUBLIC_KEY && !isLocalhost) {
    return 'config.js tiene la clave de PRUEBA. Hay que poner la clave real del generador.';
  }
  return null;
}

// ---------- clock (always visible so a wrong phone clock is noticed) ----------

const clockFormat = new Intl.DateTimeFormat('es-UY', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function startClock() {
  const tick = () => {
    $('clock').textContent = `Hora del celular: ${clockFormat.format(new Date())}`;
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- offline support ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => {
    $('offline-status').textContent = 'Funciona sin señal';
  });
}

// ---------- camera ----------

async function cameraAlreadyGranted() {
  try {
    const status = await navigator.permissions.query({ name: 'camera' });
    return status.state === 'granted';
  } catch {
    return false; // not supported (e.g. Firefox, older Safari): ask with the button
  }
}

async function setUpDetector() {
  if (detector || !('BarcodeDetector' in window)) return;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    detector = null;
  }
}

async function startScanning() {
  if (state === 'starting' || state === 'scanning') return;
  state = 'starting';
  const attempt = ++startAttempt; // superseded if the camera is stopped meanwhile
  unlockAudio();

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showCameraError('insecure');
    return;
  }
  let newStream;
  try {
    newStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    if (attempt === startAttempt) showCameraError(err?.name);
    return;
  }
  if (attempt !== startAttempt) {
    // The page went to the background while the permission prompt was open.
    for (const track of newStream.getTracks()) track.stop();
    return;
  }
  stream = newStream;
  for (const track of stream.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (track.readyState === 'ended' && stream === newStream) showCameraError('ended');
    });
  }
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // autoplay of a muted inline video normally succeeds; frames are polled anyway
  }
  await setUpDetector();
  if (attempt !== startAttempt) return;
  requestWakeLock();
  backToScanning();
}

function stopCamera() {
  startAttempt++;
  clearTimeout(scanTimer);
  clearTimeout(resultTimer);
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  video.srcObject = null;
  releaseWakeLock();
}

const CAMERA_ERRORS = {
  denied: {
    title: 'No hay permiso para usar la cámara',
    body: `
      <p class="lead">Sin la cámara no se pueden leer los QR. Para habilitarla:</p>
      <p><strong>Android (Chrome):</strong></p>
      <ol>
        <li>Tocá el ícono que está a la izquierda de la dirección de la página, arriba.</li>
        <li>Entrá en <strong>Permisos</strong> → <strong>Cámara</strong> y elegí <strong>Permitir</strong>.</li>
      </ol>
      <p><strong>iPhone (Safari):</strong></p>
      <ol>
        <li>Tocá <strong>aA</strong> en la barra de dirección → <strong>Configuración del sitio web</strong>.</li>
        <li>En <strong>Cámara</strong>, elegí <strong>Permitir</strong>.</li>
        <li>Si no aparece: <strong>Ajustes</strong> → <strong>Safari</strong> → <strong>Cámara</strong> → <strong>Permitir</strong>.</li>
      </ol>
      <p>Después tocá <strong>Reintentar</strong>.</p>`,
  },
  notfound: {
    title: 'No encontramos una cámara',
    body: '<p class="lead">Este dispositivo no parece tener cámara disponible. Probá con otro celular.</p>',
  },
  busy: {
    title: 'La cámara está ocupada',
    body: '<p class="lead">Otra app está usando la cámara. Cerrala (por ejemplo, la app de cámara o una videollamada) y tocá <strong>Reintentar</strong>.</p>',
  },
  insecure: {
    title: 'La página no puede usar la cámara',
    body: '<p class="lead">El navegador solo permite la cámara en páginas seguras. Abrí la dirección que empieza con <strong>https://</strong>.</p>',
  },
  ended: {
    title: 'Se cortó la cámara',
    body: '<p class="lead">La cámara dejó de funcionar. Tocá <strong>Reintentar</strong>.</p>',
  },
  other: {
    title: 'No pudimos usar la cámara',
    body: '<p class="lead">Algo falló al abrir la cámara. Tocá <strong>Reintentar</strong>; si sigue igual, cerrá y volvé a abrir la página.</p>',
  },
};

function showCameraError(errorName) {
  stopCamera();
  state = 'idle';
  const kind =
    {
      NotAllowedError: 'denied',
      SecurityError: 'denied',
      PermissionDeniedError: 'denied',
      NotFoundError: 'notfound',
      DevicesNotFoundError: 'notfound',
      OverconstrainedError: 'notfound',
      NotReadableError: 'busy',
      TrackStartError: 'busy',
      AbortError: 'busy',
      insecure: 'insecure',
      ended: 'ended',
    }[errorName] ?? 'other';
  $('camera-error-title').textContent = CAMERA_ERRORS[kind].title;
  $('camera-error-body').innerHTML = CAMERA_ERRORS[kind].body; // static strings only
  show('camera-error');
}

// ---------- decoding ----------

async function decodeFrame() {
  if (video.readyState < 2 || !video.videoWidth) return null;

  if (detector) {
    try {
      const codes = await detector.detect(video);
      return codes.length ? codes[0].rawValue : null;
    } catch {
      detector = null; // broken implementation: fall back to jsQR from now on
    }
  }

  const scale = Math.min(1, JSQR_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  frameCanvas ??= document.createElement('canvas');
  if (frameCanvas.width !== width) frameCanvas.width = width;
  if (frameCanvas.height !== height) frameCanvas.height = height;
  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const code = self.jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
  return code ? code.data : null;
}

async function scanLoop() {
  if (state !== 'scanning') return;
  let text = null;
  try {
    text = await decodeFrame();
  } catch {
    text = null;
  }
  if (state !== 'scanning') return;
  const isCooldownRepeat = text === lastText && Date.now() < ignoreLastUntil;
  if (text !== null && !isCooldownRepeat) {
    showResult(text);
  } else {
    scanTimer = setTimeout(scanLoop, SCAN_INTERVAL_MS);
  }
}

function backToScanning() {
  clearTimeout(resultTimer);
  clearTimeout(scanTimer);
  if (state === 'result') ignoreLastUntil = Date.now() + SAME_CODE_COOLDOWN_MS;
  state = 'scanning';
  show('scan');
  scanTimer = setTimeout(scanLoop, SCAN_INTERVAL_MS);
}

// ---------- verdict ----------

const WEEKDAYS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** `2026-10-09` -> `viernes 09/10` */
function longDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = WEEKDAYS_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

// Icons drawn with currentColor (static markup only).
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

const VERDICT_UI = {
  VALID: { icon: ICON.check, word: 'Acceso autorizado', detail: (f, t) => `Pase vigente hasta el ${longDay(t)}` },
  NOT_YET: { icon: ICON.clock, word: 'Pase aún no vigente', detail: (f, t) => `Vigente del ${longDay(f)} al ${longDay(t)}` },
  EXPIRED: { icon: ICON.cross, word: 'Pase vencido', detail: (f, t) => `Tuvo vigencia del ${longDay(f)} al ${longDay(t)}` },
  INVALID: { icon: ICON.cross, word: 'Código no válido', detail: () => 'El código no corresponde a un pase del Campo Deportivo Los Ceibos' },
};

function showResult(text) {
  lastText = text;
  const { verdict, from, to } = verify(text, todayInMontevideo(new Date()), PUBLIC_KEY);
  const ui = VERDICT_UI[verdict];

  const screen = $('screen-result');
  screen.className = `screen result verdict-${verdict}`;
  $('result-icon').innerHTML = ui.icon; // static strings only
  $('result-word').textContent = ui.word;
  $('result-detail').textContent = ui.detail(from, to);
  state = 'result';
  show('result');
  feedback(verdict);
  resultTimer = setTimeout(backToScanning, RESULT_MS);
}

// ---------- sound + vibration ----------

function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

/** Plays [frequencyHz, durationMs] tones back to back with a short gap. */
function beep(tones) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  let t = audioCtx.currentTime;
  for (const [freq, ms] of tones) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    t += ms / 1000 + 0.07;
  }
}

const FEEDBACK = {
  VALID: { tones: [[1320, 160]], vibrate: [200] },
  NOT_YET: { tones: [[660, 140], [660, 140]], vibrate: [150, 100, 150] },
  EXPIRED: { tones: [[300, 220], [220, 320]], vibrate: [400, 120, 400] },
  INVALID: { tones: [[300, 220], [220, 320]], vibrate: [400, 120, 400] },
};

function feedback(verdict) {
  const { tones, vibrate } = FEEDBACK[verdict];
  try {
    navigator.vibrate?.(vibrate);
  } catch {
    // vibration unsupported (iPhone): ignore
  }
  beep(tones);
}

// ---------- keep the screen on while scanning ----------

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ---------- startup ----------

async function init() {
  startClock();
  registerServiceWorker();

  const problem = configProblem();
  if (problem) {
    $('config-detail').textContent = problem;
    show('config');
    return;
  }
  if (PUBLIC_KEY === TEST_PUBLIC_KEY) {
    $('offline-status').textContent = 'CLAVE DE PRUEBA';
  }

  $('start-button').addEventListener('click', startScanning);
  $('retry-button').addEventListener('click', startScanning);
  $('screen-result').addEventListener('click', backToScanning);
  // Browsers only allow sound after a user gesture; any tap unlocks it.
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  // Release the camera in the background; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'scanning' || state === 'result' || state === 'starting') {
        stopCamera();
        state = 'paused';
      }
    } else if (state === 'paused') {
      state = 'idle';
      startScanning();
    }
  });

  if (await cameraAlreadyGranted()) {
    startScanning();
  } else {
    show('start');
  }
}

init();
