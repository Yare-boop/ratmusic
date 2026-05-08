# 🐀 RatMusic PWA

**El reproductor de las ratas** — música offline para Android

---

## Archivos del proyecto

```
ratmusic/
├── index.html            ← App principal
├── style.css             ← Estilos (sewer punk aesthetic)
├── app.js                ← Lógica del reproductor + IndexedDB
├── sw.js                 ← Service Worker (modo offline)
├── manifest.json         ← Configuración PWA
├── rat-icon.svg          ← Ícono de la app
├── ratmusic-server.py    ← Servidor Termux (para YouTube)
└── README.md
```

---

## Opción A — Instalar en tu Android (deploy en Netlify/GitHub Pages)

### 1. Subir a Netlify (gratis, 2 minutos)

1. Ve a https://netlify.com → "Add new site" → "Deploy manually"
2. Arrastra la carpeta `ratmusic/` al área de drop
3. Netlify te da una URL: `https://tuapp.netlify.app`

### 2. Instalar en el celular

1. Abre Chrome en Android
2. Ve a tu URL de Netlify
3. Chrome muestra banner "Añadir a pantalla de inicio" → acepta
4. La app aparece en tu launcher como app nativa

> ⚠️ Requiere HTTPS para que el Service Worker funcione.
> Netlify/GitHub Pages proveen HTTPS gratis automáticamente.

---

## Opción B — Deploy local con Termux (sin internet)

```bash
# En Termux
pkg install nodejs
npx serve /sdcard/ratmusic -l 8080

# Luego en Chrome: http://localhost:8080
```

---

## Opción C — GitHub Pages

```bash
# En tu PC
git init ratmusic && cd ratmusic
# copia los archivos aquí
git add . && git commit -m "🐀 RatMusic v1"
git remote add origin https://github.com/tuuser/ratmusic.git
git push -u origin main

# En GitHub: Settings → Pages → Source: main → /root
# URL: https://tuuser.github.io/ratmusic
```

---

## Servidor Termux (descargas YouTube)

Esto es **opcional** — solo necesario para la pestaña YouTube.

```bash
# 1. Instalar Termux desde F-Droid (NO Play Store)
# 2. En Termux:
pkg update
pkg install python yt-dlp ffmpeg
pip install flask flask-cors
termux-setup-storage   # da permisos de almacenamiento

# 3. Copiar el servidor
cp /sdcard/ratmusic/ratmusic-server.py ~/ratmusic-server.py

# 4. Ejecutar
python ~/ratmusic-server.py
```

El servidor corre en `http://127.0.0.1:5000`.  
Los archivos se guardan en `~/storage/music/RatMusic/`.  
Luego impórtalos desde la pestaña 📥 de la app.

---

## Funcionalidades

| Feature | Estado |
|---|---|
| Reproductor offline | ✅ |
| Importar MP3/M4A/OGG/FLAC/WAV | ✅ |
| Biblioteca con IndexedDB | ✅ |
| Visualizador de audio | ✅ |
| Controles en pantalla de bloqueo | ✅ (Media Session API) |
| Shuffle y repeat | ✅ |
| Atajos de teclado | ✅ |
| Modo oscuro permanente | ✅ |
| Instalable como app | ✅ (PWA) |
| Descarga desde YouTube | ⚠️ Requiere Termux |

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| Espacio | Play / Pause |
| ← | Canción anterior |
| → | Canción siguiente |
| S | Toggle shuffle |
| R | Cambiar modo repeat |

---

*🐀 Hecho con amor rata • plantamuerta.art × dragondejardin*
