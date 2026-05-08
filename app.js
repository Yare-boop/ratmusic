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
let songs       = [];
let currentIdx  = -1;
let isPlaying   = false;
let isShuffle   = false;
let repeatMode  = 0;
let shuffleQueue= [];

// ── Audio ─────────────────────────────────────────────────
const audio         = new Audio();
audio.volume        = 0.8;
let currentObjectUrl= null;

// ── Web Audio API ─────────────────────────────────────────
let audioCtx  = null;
let analyser  = null;
let sourceNode= null;
let animFrame = null;

// ── DOM helpers ───────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const el = {
  npTitle       : $('np-title'),
  npMeta        : $('np-sub'),           // era np-meta
  timeCur       : $('time-cur'),
  timeTot       : $('time-dur'),         // era time-tot
  progressTrack : $('progress-track'),
  progressFill  : $('progress-fill'),
  progressThumb : $('progress-thumb'),
  volTrack      : $('vol-track'),
  volFill       : $('vol-fill'),
  volThumb      : $('vol-thumb'),
  btnPlay       : $('btn-play'),
  btnPrev       : $('btn-prev'),
  btnNext       : $('btn-next'),
  btnShuffle    : $('btn-shuffle'),
  btnRepeat     : $('btn-repeat'),
  songList      : $('song-list'),
  libCount      : $('pill-count'),       // era lib-count
  btnClear      : $('btn-clear-all'),    // era btn-clear
  dropZone      : $('drop-zone'),
  fileInput     : $('file-input'),
  urlInput      : $('url-input'),        // era yt-url
  btnUrl        : $('btn-url'),          // era yt-dl
  urlStatus     : $('url-status'),       // era yt-status
  storageInfo   : $('storage-info'),
  ratFact       : $('rat-fact'),
  searchInput   : $('search-input'),
  toastContainer: $('toast-container'),
};

updateVolBar(audio.volume);

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
  updateStorageInfo();
}

let searchQuery = '';

function renderLibrary() {
  const filtered = searchQuery
    ? songs.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : songs;

  const count = songs.length;
  el.libCount.textContent = `${count} ${count === 1 ? 'track' : 'tracks'}`;

  if (filtered.length === 0) {
    el.songList.innerHTML = `
      <li class="song-empty">
        <span>🐭</span>
        <p>${searchQuery ? 'Sin resultados' : 'Biblioteca vacía'}</p>
        <small>${searchQuery ? 'Prueba otra búsqueda' : 'Agrega canciones desde ➕'}</small>
      </li>`;
    return;
  }

  el.songList.innerHTML = filtered.map((s, i) => {
    const realIdx = songs.indexOf(s);
    return `
    <li class="song-item ${realIdx === currentIdx ? 'active' : ''}" data-i="${realIdx}">
      <span class="snum">${realIdx === currentIdx ? '♪' : i + 1}</span>
      <div class="sinfo">
        <div class="sname">${escHtml(s.title)}</div>
        <div class="ssize">${fmtBytes(s.size)}</div>
      </div>
      <span class="sdur">${s.duration || '--:--'}</span>
      <button class="sdel" data-id="${s.id}" aria-label="Eliminar">✕</button>
    </li>`;
  }).join('');

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

el.searchInput.addEventListener('input', e => {
  searchQuery = e.target.value;
  renderLibrary();
});

// ═══════════════════════════════════════════════════════════
//  Player
// ═══════════════════════════════════════════════════════════

async function playSong(idx) {
  if (idx < 0 || idx >= songs.length) return;

  currentIdx = idx;
  const song = songs[idx];

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }

  const blob = new Blob([song.audioData], { type: song.mimeType || 'audio/mpeg' });
  currentObjectUrl = URL.createObjectURL(blob);

  audio.src  = currentObjectUrl;
  audio.load();

  try {
    await audio.play();
    isPlaying = true;
  } catch(e) {
    isPlaying = false;
  }

  updatePlayBtn();
  updateNowPlaying(song);
  updateMediaSession(song);
  renderLibrary();
}

function updateNowPlaying(song) {
  el.npTitle.textContent = song.title;
  el.npTitle.classList.toggle('playing', isPlaying);
  el.npMeta.textContent  = `🐀 ${fmtBytes(song.size)}`;
}

function updatePlayBtn() {
  const iconPlay  = el.btnPlay.querySelector('.icon-play');
  const iconPause = el.btnPlay.querySelector('.icon-pause');
  if (iconPlay && iconPause) {
    iconPlay.style.display  = isPlaying ? 'none' : '';
    iconPause.style.display = isPlaying ? ''     : 'none';
  } else {
    el.btnPlay.textContent = isPlaying ? '⏸' : '▶';
  }
}

function togglePlay() {
  if (songs.length === 0) return;
  if (currentIdx === -1) { playSong(0); return; }

  if (isPlaying) {
    audio.pause();
    isPlaying = false;
    cancelAnimationFrame(animFrame);
  } else {
    audio.play().then(() => { isPlaying = true; }).catch(() => {});
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
    idx = shuffleQueue[(pos + 1) % shuffleQueue.length];
  } else {
    const nxt = currentIdx + 1;
    if (nxt >= songs.length) {
      if (repeatMode === 1) idx = 0;
      else return;
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
  el.btnRepeat.classList.toggle('active', repeatMode > 0);
  el.btnRepeat.title = ['Sin repetir', 'Repetir todo', 'Repetir una'][repeatMode];
}

// ── Audio Events ──────────────────────────────────────────

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  updateProgressBar(pct);
  el.timeCur.textContent = fmtTime(audio.currentTime);
});

audio.addEventListener('loadedmetadata', () => {
  el.timeTot.textContent = fmtTime(audio.duration);
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
  playNext(true);
});

audio.addEventListener('error', () => {
  isPlaying = false;
  updatePlayBtn();
  el.npMeta.textContent = '❌ Error al reproducir';
});

// ── Progress (div custom) ─────────────────────────────────

function updateProgressBar(pct) {
  if (el.progressFill)  el.progressFill.style.width = `${pct}%`;
  if (el.progressThumb) el.progressThumb.style.left  = `${pct}%`;
}

function seekFromEvent(e) {
  const rect = el.progressTrack.getBoundingClientRect();
  const x    = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const pct  = Math.max(0, Math.min(1, x / rect.width));
  if (audio.duration) {
    audio.currentTime = pct * audio.duration;
    updateProgressBar(pct * 100);
  }
}

let isDraggingProgress = false;
el.progressTrack.addEventListener('mousedown',  e => { isDraggingProgress = true;  seekFromEvent(e); });
el.progressTrack.addEventListener('touchstart', e => { isDraggingProgress = true;  seekFromEvent(e); }, { passive: true });
document.addEventListener('mousemove',  e => { if (isDraggingProgress) seekFromEvent(e); });
document.addEventListener('touchmove',  e => { if (isDraggingProgress) seekFromEvent(e); }, { passive: true });
document.addEventListener('mouseup',   () => { isDraggingProgress = false; });
document.addEventListener('touchend',  () => { isDraggingProgress = false; });

// ── Volume (div custom) ───────────────────────────────────

function updateVolBar(vol) {
  const pct = vol * 100;
  if (el.volFill)  el.volFill.style.width = `${pct}%`;
  if (el.volThumb) el.volThumb.style.left  = `${pct}%`;
}

function volFromEvent(e) {
  const rect = el.volTrack.getBoundingClientRect();
  const x    = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const vol  = Math.max(0, Math.min(1, x / rect.width));
  audio.volume = vol;
  updateVolBar(vol);
}

let isDraggingVol = false;
el.volTrack.addEventListener('mousedown',  e => { isDraggingVol = true;  volFromEvent(e); });
el.volTrack.addEventListener('touchstart', e => { isDraggingVol = true;  volFromEvent(e); }, { passive: true });
document.addEventListener('mousemove',  e => { if (isDraggingVol) volFromEvent(e); });
document.addEventListener('touchmove',  e => { if (isDraggingVol) volFromEvent(e); }, { passive: true });
document.addEventListener('mouseup',   () => { isDraggingVol = false; });
document.addEventListener('touchend',  () => { isDraggingVol = false; });

// ═══════════════════════════════════════════════════════════
//  File Import
// ═══════════════════════════════════════════════════════════

async function importFiles(files) {
  const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
  if (!audioFiles.length) { showToast('❌ Ningún archivo de audio encontrado', 'err'); return; }

  showToast(`⌛ Importando ${audioFiles.length} archivo(s)...`);
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
  showToast(msg, ok ? 'ok' : 'err');
}

el.dropZone.addEventListener('dragover', e => { e.preventDefault(); el.dropZone.classList.add('over'); });
el.dropZone.addEventListener('dragleave', () => el.dropZone.classList.remove('over'));
el.dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  el.dropZone.classList.remove('over');
  await importFiles(e.dataTransfer.files);
});
el.dropZone.addEventListener('click', e => {
  if (!['LABEL','INPUT'].includes(e.target.tagName)) el.fileInput.click();
});
el.fileInput.addEventListener('change', async e => {
  if (e.target.files.length) { await importFiles(e.target.files); e.target.value = ''; }
});

// ── URL import (solo audio directo, NO YouTube) ───────────

const YT_PATTERNS = [
  /youtu\.be\//i,
  /youtube\.com\/watch/i,
  /youtube\.com\/shorts/i,
  /music\.youtube\.com/i,
];

function isYouTubeUrl(url) {
  return YT_PATTERNS.some(p => p.test(url));
}

el.btnUrl.addEventListener('click', async () => {
  const url = el.urlInput.value.trim();
  if (!url) { setUrlStatus('❌ Ingresa una URL', 'err'); return; }

  // Detectar YouTube y dar instrucciones claras
  if (isYouTubeUrl(url)) {
    setUrlStatus(
      '🚫 YouTube bloquea descargas directas desde el navegador (CORS). ' +
      'Descarga el MP3 con yt-dlp o una app como NewPipe, luego impórtalo desde "Agregar archivos" ⬆️',
      'err'
    );
    return;
  }

  setUrlStatus('⌛ Descargando...', 'loading');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream'))
      throw new Error('La URL no apunta a un archivo de audio directo (.mp3, .ogg, .flac, etc.)');

    const buffer   = await res.arrayBuffer();
    const filename = url.split('/').pop().split('?')[0] || 'cancion.mp3';

    await dbAdd({
      title    : cleanTitle(filename),
      mimeType : contentType.split(';')[0],
      size     : buffer.byteLength,
      audioData: buffer,
      duration : null,
      date     : new Date().toISOString(),
    });

    await loadSongs();
    setUrlStatus('✅ Canción agregada', 'ok');
    el.urlInput.value = '';
  } catch(e) {
    // Dar mensaje más útil si es CORS
    const msg = e.message.includes('Failed to fetch') || e.message.includes('NetworkError')
      ? 'No se pudo acceder a la URL. Puede ser CORS (el servidor no permite acceso externo) o la URL no existe.'
      : e.message;
    setUrlStatus(`❌ ${msg}`, 'err');
  }
});

el.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') el.btnUrl.click(); });

function setUrlStatus(msg, cls = '') {
  el.urlStatus.textContent = msg;
  el.urlStatus.className   = `status-msg ${cls}`;
}

// ═══════════════════════════════════════════════════════════
//  Remove Songs
// ═══════════════════════════════════════════════════════════

async function removeSong(id) {
  const idx = songs.findIndex(s => s.id === id);

  if (idx === currentIdx) {
    audio.pause(); audio.src = '';
    isPlaying = false; currentIdx = -1;
    cancelAnimationFrame(animFrame);
    el.npTitle.textContent = 'Ninguna canción';
    el.npTitle.classList.remove('playing');
    el.npMeta.textContent  = 'Carga un archivo para empezar';
    el.timeCur.textContent = '0:00';
    el.timeTot.textContent = '0:00';
    updateProgressBar(0);
    updatePlayBtn();
  } else if (idx < currentIdx) {
    currentIdx--;
  }

  await dbDelete(id);
  await loadSongs();
}

el.btnClear.addEventListener('click', async () => {
  if (!songs.length) return;
  if (!confirm(`¿Eliminar las ${songs.length} canciones?\n(Los archivos originales no se borran)`)) return;
  audio.pause(); audio.src = '';
  isPlaying = false; currentIdx = -1;
  cancelAnimationFrame(animFrame);
  el.npTitle.textContent = 'Ninguna canción';
  el.npTitle.classList.remove('playing');
  updateProgressBar(0);
  updatePlayBtn();
  await dbClear();
  await loadSongs();
});

// ═══════════════════════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════════════════════

$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach(b => b.classList.remove('tab--active'));
    $$('.panel').forEach(p => p.classList.remove('panel--active'));
    btn.classList.add('tab--active');
    const panel = $(`panel-${btn.dataset.tab}`);
    if (panel) panel.classList.add('panel--active');
  });
});

// ═══════════════════════════════════════════════════════════
//  Controls
// ═══════════════════════════════════════════════════════════

el.btnPlay.addEventListener('click', togglePlay);
el.btnPrev.addEventListener('click', playPrev);
el.btnNext.addEventListener('click', () => playNext(false));
el.btnShuffle.addEventListener('click', toggleShuffle);
el.btnRepeat.addEventListener('click', toggleRepeat);

document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  switch(e.key) {
    case ' ':          e.preventDefault(); togglePlay();  break;
    case 'ArrowLeft':  playPrev();                        break;
    case 'ArrowRight': playNext(false);                   break;
    case 's':          toggleShuffle();                   break;
    case 'r':          toggleRepeat();                    break;
  }
});

function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title : song.title,
    artist: 'RatMusic 🐀',
    album : 'Colección Rata',
  });
  navigator.mediaSession.setActionHandler('play',          togglePlay);
  navigator.mediaSession.setActionHandler('pause',         togglePlay);
  navigator.mediaSession.setActionHandler('previoustrack', playPrev);
  navigator.mediaSession.setActionHandler('nexttrack',     () => playNext(false));
}

// ═══════════════════════════════════════════════════════════
//  Storage Info
// ═══════════════════════════════════════════════════════════

async function updateStorageInfo() {
  if (!el.storageInfo) return;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      el.storageInfo.textContent = `${fmtBytes(usage)} usados de ${fmtBytes(quota)} disponibles`;
    } else {
      el.storageInfo.textContent = 'No disponible en este navegador';
    }
  } catch(e) {
    el.storageInfo.textContent = 'No disponible';
  }
}

// ═══════════════════════════════════════════════════════════
//  Toast notifications
// ═══════════════════════════════════════════════════════════

function showToast(msg, type = '') {
  if (!el.toastContainer) { console.log(msg); return; }
  const toast = document.createElement('div');
  toast.className = `toast${type ? ' toast--' + type : ''}`;
  toast.textContent = msg;
  Object.assign(toast.style, {
    background: type === 'err' ? '#f87171' : type === 'ok' ? '#4ade80' : '#ffd700',
    color: '#111',
    padding: '10px 16px',
    borderRadius: '8px',
    marginTop: '8px',
    fontFamily: 'monospace',
    fontSize: '14px',
    opacity: '0',
    transition: 'opacity .3s',
  });
  el.toastContainer.appendChild(toast);
  setTimeout(() => (toast.style.opacity = '1'), 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// ═══════════════════════════════════════════════════════════
//  Utility
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
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function escHtml(s) {
  return s.replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

// ── Fix meta deprecated ───────────────────────────────────
if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
  const m = document.createElement('meta');
  m.name = 'mobile-web-app-capable';
  m.content = 'yes';
  document.head.appendChild(m);
}

// ═══════════════════════════════════════════════════════════
//  Service Worker
// ═══════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('🐀 SW registrado, scope:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller)
              showToast('🐀 Nueva versión disponible. Recarga para actualizar.');
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
