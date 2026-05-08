// ═══════════════════════════════════════════════════════════
//  RatMusic PWA — app.js
//  🐀 El reproductor de las ratas
// ═══════════════════════════════════════════════════════════
'use strict';

// ── IndexedDB config ──────────────────────────────────────
const DB_NAME    = 'RatMusicDB';
const DB_VERSION = 1;
const STORE      = 'songs';

// ── State ─────────────────────────────────────────────────
let db          = null;
let songs       = [];          // array of song metadata from DB
let currentIdx  = -1;
let isPlaying   = false;
let isShuffle   = false;
let repeatMode  = 0;           // 0=off  1=all  2=one
let shuffleQueue= [];

// ── Audio ─────────────────────────────────────────────────
const audio         = new Audio();
audio.volume        = 0.8;
let currentObjectUrl= null;

// ── Web Audio API (visualizer) ────────────────────────────
let audioCtx  = null;
let analyser  = null;
let sourceNode= null;
let animFrame = null;

// ── DOM helpers ───────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const el = {
  npTitle    : $('np-title'),
  npMeta     : $('np-meta'),
  timeCur    : $('time-cur'),
  timeTot    : $('time-tot'),
  progress   : $('progress'),
  pbarFill   : $('pbar-fill'),
  volume     : $('volume'),
  btnPlay    : $('btn-play'),
  btnPrev    : $('btn-prev'),
  btnNext    : $('btn-next'),
  btnShuffle : $('btn-shuffle'),
  btnRepeat  : $('btn-repeat'),
  songList   : $('song-list'),
  libCount   : $('lib-count'),
  btnClear   : $('btn-clear'),
  dropZone   : $('drop-zone'),
  fileInput  : $('file-input'),
  importLog  : $('import-log'),
  ytUrl      : $('yt-url'),
  ytFormat   : $('yt-format'),
  ytDl       : $('yt-dl'),
  ytStatus   : $('yt-status'),
  visualizer : $('visualizer'),
  ratIdle    : $('rat-idle'),
};

// ═══════════════════════════════════════════════════════════
//  IndexedDB
// ═══════════════════════════════════════════════════════════

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror  = () => reject('IndexedDB error');
    req.onsuccess= (e) => { db = e.target.result; resolve(); };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const s = d.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
        s.createIndex('title', 'title', { unique: false });
        s.createIndex('date',  'date',  { unique: false });
      }
    };
  });
}

function dbGetAll() {
  return new Promise(res => {
    const req = db.transaction(STORE,'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => res([]);
  });
}

function dbAdd(song) {
  return new Promise((res, rej) => {
    const req = db.transaction(STORE,'readwrite').objectStore(STORE).add(song);
    req.onsuccess = (e) => res(e.target.result);
    req.onerror   = ()  => rej('Error al guardar');
  });
}

function dbPut(song) {
  return new Promise(res => {
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(song);
    tx.oncomplete = res;
  });
}

function dbDelete(id) {
  return new Promise(res => {
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = res;
  });
}

function dbClear() {
  return new Promise(res => {
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = res;
  });
}

// ═══════════════════════════════════════════════════════════
//  Library
// ═══════════════════════════════════════════════════════════

async function loadSongs() {
  songs = await dbGetAll();
  renderLibrary();
}

function renderLibrary() {
  el.libCount.textContent = `${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'}`;

  if (songs.length === 0) {
    el.songList.innerHTML = `
      <li class="empty-state">
        <div>🐀</div>
        <div>Biblioteca vacía</div>
        <div>Importa archivos desde la pestaña 📥</div>
      </li>`;
    return;
  }

  el.songList.innerHTML = songs.map((s, i) => `
    <li class="song-item ${i === currentIdx ? 'active' : ''}" data-i="${i}">
      <span class="snum">${i === currentIdx ? '♪' : i + 1}</span>
      <div class="sinfo">
        <div class="sname">${escHtml(s.title)}</div>
        <div class="ssize">${fmtBytes(s.size)}</div>
      </div>
      <span class="sdur">${s.duration || '--:--'}</span>
      <button class="sdel" data-id="${s.id}" aria-label="Eliminar">✕</button>
    </li>
  `).join('');

  el.songList.querySelectorAll('.song-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('sdel')) return;
      playSong(parseInt(item.dataset.i));
    });
  });

  el.songList.querySelectorAll('.sdel').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeSong(parseInt(btn.dataset.id));
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  Player
// ═══════════════════════════════════════════════════════════

async function playSong(idx) {
  if (idx < 0 || idx >= songs.length) return;

  currentIdx = idx;
  const song = songs[idx];

  // Clean up previous blob URL
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  // Create blob URL from stored ArrayBuffer
  const blob = new Blob([song.audioData], { type: song.mimeType || 'audio/mpeg' });
  currentObjectUrl = URL.createObjectURL(blob);

  audio.src  = currentObjectUrl;
  audio.load();

  try {
    await audio.play();
    isPlaying = true;
  } catch(e) {
    // autoplay blocked — user can press play
    isPlaying = false;
  }

  updatePlayBtn();
  updateNowPlaying(song);
  setupVisualizer();
  renderLibrary();
}

function updateNowPlaying(song) {
  el.npTitle.textContent = song.title;
  el.npTitle.classList.toggle('playing', isPlaying);
  el.npMeta.textContent  = `🐀 ${fmtBytes(song.size)}`;
}

function updatePlayBtn() {
  el.btnPlay.textContent = isPlaying ? '⏸' : '▶';
}

function togglePlay() {
  if (songs.length === 0) return;

  if (currentIdx === -1) {
    playSong(0);
    return;
  }

  if (isPlaying) {
    audio.pause();
    isPlaying = false;
    cancelAnimationFrame(animFrame);
  } else {
    audio.play().then(() => {
      isPlaying = true;
      if (analyser) kickVisualizer();
    }).catch(() => {});
  }
  updatePlayBtn();
  el.npTitle.classList.toggle('playing', isPlaying);
}

function playPrev() {
  if (!songs.length) return;
  let idx;
  if (isShuffle) {
    const pos = shuffleQueue.indexOf(currentIdx);
    idx = shuffleQueue[pos > 0 ? pos - 1 : shuffleQueue.length - 1];
  } else {
    idx = currentIdx <= 0 ? songs.length - 1 : currentIdx - 1;
  }
  playSong(idx);
}

function playNext(auto = false) {
  if (!songs.length) return;

  if (repeatMode === 2 && auto) { playSong(currentIdx); return; }

  let idx;
  if (isShuffle) {
    const pos = shuffleQueue.indexOf(currentIdx);
    const nxt = (pos + 1) % shuffleQueue.length;
    idx = shuffleQueue[nxt];
  } else {
    const nxt = currentIdx + 1;
    if (nxt >= songs.length) {
      if (repeatMode === 1) idx = 0;
      else return; // playlist ended
    } else {
      idx = nxt;
    }
  }
  playSong(idx);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  if (isShuffle) {
    shuffleQueue = [...songs.keys()].sort(() => Math.random() - 0.5);
  }
  el.btnShuffle.classList.toggle('active', isShuffle);
}

function toggleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  const icons = { 0:'↻', 1:'↺', 2:'↻¹' };
  el.btnRepeat.textContent = icons[repeatMode];
  el.btnRepeat.classList.toggle('active', repeatMode > 0);
}

// ── Audio Events ──────────────────────────────────────────

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  el.pbarFill.style.width = `${pct}%`;
  el.progress.value       = pct;
  el.timeCur.textContent  = fmtTime(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  el.timeTot.textContent = fmtTime(audio.duration);
  // Persist duration in DB
  if (currentIdx >= 0) {
    const song = songs[currentIdx];
    const dur  = fmtTime(audio.duration);
    if (song.duration !== dur) {
      song.duration = dur;
      dbPut(song).catch(() => {});
    }
  }
});

audio.addEventListener('ended', () => {
  isPlaying = false;
  updatePlayBtn();
  el.npTitle.classList.remove('playing');
  cancelAnimationFrame(animFrame);
  el.ratIdle.style.opacity = '1';
  playNext(true);
});

audio.addEventListener('error', () => {
  isPlaying = false;
  updatePlayBtn();
  el.npMeta.textContent = '❌ Error al reproducir';
});

// Progress seek
el.progress.addEventListener('input', e => {
  if (audio.duration)
    audio.currentTime = (e.target.value / 100) * audio.duration;
});

// Volume
el.volume.addEventListener('input', e => {
  audio.volume = parseFloat(e.target.value);
});

// ═══════════════════════════════════════════════════════════
//  Visualizer
// ═══════════════════════════════════════════════════════════

function setupVisualizer() {
  try {
    if (!audioCtx) {
      audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode = audioCtx.createMediaElementSource(audio);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    el.ratIdle.style.opacity = '0';
    cancelAnimationFrame(animFrame);
    kickVisualizer();
  } catch(e) {
    // Visualizer unavailable — keep idle animation
  }
}

function kickVisualizer() {
  const canvas = el.visualizer;
  const ctx    = canvas.getContext('2d');

  // Hi-DPI sizing
  const dpr = devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth;
  const H   = 80;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const bufLen  = analyser.frequencyBinCount;
  const data    = new Uint8Array(bufLen);
  const barW    = (W / bufLen) * 2.2;

  function draw() {
    animFrame = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);

    ctx.clearRect(0, 0, W, H);

    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v     = data[i] / 255;
      const barH  = v * H;
      const hue   = 42 + v * 22;        // warm gold → orange
      const alpha = 0.5 + v * 0.5;
      ctx.fillStyle = `hsla(${hue},100%,55%,${alpha})`;
      ctx.fillRect(x, H - barH, barW - 1, barH);
      x += barW;
    }
  }
  draw();
}

// ═══════════════════════════════════════════════════════════
//  File Import
// ═══════════════════════════════════════════════════════════

async function importFiles(files) {
  const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));

  if (!audioFiles.length) {
    setLog('❌ Ningún archivo de audio encontrado', 'err');
    return;
  }

  setLog(`⌛ Importando ${audioFiles.length} archivo(s)...`, 'warn');

  let ok = 0, fail = 0;

  for (const file of audioFiles) {
    try {
      const buffer = await file.arrayBuffer();
      await dbAdd({
        title    : cleanTitle(file.name),
        mimeType : file.type || 'audio/mpeg',
        size     : file.size,
        audioData: buffer,
        duration : null,
        date     : new Date().toISOString(),
      });
      ok++;
    } catch(e) {
      fail++;
      console.warn('Import error:', file.name, e);
    }
  }

  await loadSongs();

  const msg = fail
    ? `✅ ${ok} importadas  ❌ ${fail} con error`
    : `✅ ${ok} canción${ok !== 1 ? 'es' : ''} importada${ok !== 1 ? 's' : ''}`;
  setLog(msg, ok ? 'ok' : 'err');
}

function setLog(msg, cls = '') {
  el.importLog.className = `import-log ${cls ? 'log-' + cls : ''}`;
  el.importLog.textContent = msg;
}

// ── Drag & Drop ───────────────────────────────────────────

el.dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  el.dropZone.classList.add('over');
});
el.dropZone.addEventListener('dragleave', () => {
  el.dropZone.classList.remove('over');
});
el.dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  el.dropZone.classList.remove('over');
  await importFiles(e.dataTransfer.files);
});
el.dropZone.addEventListener('click', e => {
  if (!['LABEL','INPUT'].includes(e.target.tagName))
    el.fileInput.click();
});
el.fileInput.addEventListener('change', async e => {
  if (e.target.files.length) {
    await importFiles(e.target.files);
    e.target.value = '';
  }
});

// ═══════════════════════════════════════════════════════════
//  Remove Songs
// ═══════════════════════════════════════════════════════════

async function removeSong(id) {
  const idx = songs.findIndex(s => s.id === id);

  if (idx === currentIdx) {
    audio.pause();
    audio.src = '';
    isPlaying = false;
    currentIdx = -1;
    cancelAnimationFrame(animFrame);
    el.ratIdle.style.opacity = '1';
    el.npTitle.textContent = '— sin canción —';
    el.npTitle.classList.remove('playing');
    el.npMeta.textContent  = '🐀 elige algo de la biblioteca';
    el.timeCur.textContent = '0:00';
    el.timeTot.textContent = '0:00';
    el.pbarFill.style.width = '0%';
    updatePlayBtn();
  } else if (idx < currentIdx) {
    currentIdx--;
  }

  await dbDelete(id);
  await loadSongs();
}

el.btnClear.addEventListener('click', async () => {
  if (!songs.length) return;
  if (!confirm(`¿Eliminar las ${songs.length} canciones de la biblioteca?\n(Los archivos originales no se borran)`)) return;
  audio.pause(); audio.src = '';
  isPlaying = false; currentIdx = -1;
  cancelAnimationFrame(animFrame);
  el.ratIdle.style.opacity = '1';
  el.npTitle.textContent = '— sin canción —';
  el.npTitle.classList.remove('playing');
  el.pbarFill.style.width = '0%';
  updatePlayBtn();
  await dbClear();
  await loadSongs();
});

// ═══════════════════════════════════════════════════════════
//  YouTube Download (via Termux server)
// ═══════════════════════════════════════════════════════════

el.ytDl.addEventListener('click', async () => {
  const url = el.ytUrl.value.trim();
  const fmt = el.ytFormat.value;

  if (!url) { setYt('❌ Ingresa una URL de YouTube', 'err'); return; }

  setYt('🐀 Conectando con servidor Termux en localhost:5000...', 'loading');

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 300_000); // 5 min

    const res = await fetch(
      `http://127.0.0.1:5000/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(fmt)}`,
      { signal: controller.signal }
    );
    clearTimeout(tid);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.status === 'ok') {
      setYt(`✅ Descargado: "${data.title}"\nAhora impórtalo desde la pestaña 📥`, 'ok');
    } else {
      throw new Error(data.error || 'Error desconocido');
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      setYt('⏱️ Timeout — la descarga tardó demasiado', 'err');
    } else if (e.name === 'TypeError') {
      setYt('❌ No se encontró el servidor Termux.\n¿Está corriendo ratmusic-server.py?', 'err');
    } else {
      setYt(`❌ ${e.message}`, 'err');
    }
  }
});

function setYt(msg, cls = '') {
  el.ytStatus.textContent = msg;
  el.ytStatus.className   = `yt-status ${cls}`;
}

// ═══════════════════════════════════════════════════════════
//  Tab Navigation
// ═══════════════════════════════════════════════════════════

$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

// ═══════════════════════════════════════════════════════════
//  Controls Binding
// ═══════════════════════════════════════════════════════════

el.btnPlay.addEventListener('click', togglePlay);
el.btnPrev.addEventListener('click', playPrev);
el.btnNext.addEventListener('click', () => playNext(false));
el.btnShuffle.addEventListener('click', toggleShuffle);
el.btnRepeat.addEventListener('click', toggleRepeat);

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  switch(e.key) {
    case ' ':          e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':  playPrev();          break;
    case 'ArrowRight': playNext(false);     break;
    case 's':          toggleShuffle();     break;
    case 'r':          toggleRepeat();      break;
  }
});

// ── Media Session API (lock screen controls) ──────────────
function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title : song.title,
    artist: 'RatMusic 🐀',
    album : 'Colección Rata',
  });
  navigator.mediaSession.setActionHandler('play',         togglePlay);
  navigator.mediaSession.setActionHandler('pause',        togglePlay);
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack',    () => playNext(false));
}

// Call when song starts
const origPlaySong = playSong;
// Patch to also update media session
async function playSong(idx) {
  await origPlaySong(idx);
  if (songs[idx]) updateMediaSession(songs[idx]);
}

// ═══════════════════════════════════════════════════════════
//  Utility Functions
// ═══════════════════════════════════════════════════════════

function fmtTime(s) {
  if (!s || isNaN(s) || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function fmtBytes(b) {
  if (!b) return '';
  if (b < 1048576) return `${(b/1024).toFixed(0)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

function cleanTitle(filename) {
  return filename
    .replace(/\.[^.]+$/, '')           // remove extension
    .replace(/[_-]+/g, ' ')            // underscores/dashes → spaces
    .replace(/\s{2,}/g, ' ')           // collapse spaces
    .trim();
}

function escHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ═══════════════════════════════════════════════════════════
//  Service Worker Registration
// ═══════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('🐀 SW registrado, scope:', reg.scope);
        // Check for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('🐀 Nueva versión disponible');
            }
          });
        });
      })
      .catch(e => console.error('SW error:', e));
  });
}

// ═══════════════════════════════════════════════════════════
//  Init
// ═══════════════════════════════════════════════════════════

(async () => {
  try {
    await initDB();
    await loadSongs();
    console.log('%c🐀 RatMusic listo. ¡Que comience la fiesta rata! 🧀',
      'color:#ffd700;font-size:16px;font-family:monospace;');
  } catch(e) {
    console.error('Init error:', e);
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="background:#f87171;color:#fff;padding:12px;text-align:center;font-family:monospace;">
        Error iniciando RatMusic: ${e}
      </div>`);
  }
})();
