const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Caching Configuration ---
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_DURATION_SECONDS = 24 * 60 * 60; // 1 day

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Cache directory created at ${CACHE_DIR}`);
}

// --- Automatic Cache Cleanup ---
const CLEANUP_INTERVAL_MINUTES = 60; // Check for old files every hour
const MAX_CACHE_AGE_SECONDS = 2 * 24 * 60 * 60; // Delete files older than 2 days

function cleanupCache() {
  console.log('[CACHE_CLEANUP] Running cleanup...');
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) {
      console.error('[CACHE_CLEANUP] Error reading cache directory:', err);
      return;
    }
    if (files.length === 0) {
      console.log('[CACHE_CLEANUP] Cache is empty, nothing to do.');
      return;
    }
    let deletedCount = 0;
    files.forEach(file => {
      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        const ageInSeconds = (Date.now() - stats.mtime.getTime()) / 1000;
        if (ageInSeconds > MAX_CACHE_AGE_SECONDS) {
          fs.unlink(filePath, err => {
            if (!err) {
              deletedCount++;
              console.log(`[CACHE_CLEANUP] Deleted old file: ${file}`);
            }
          });
        }
      });
    });
    if (deletedCount > 0) {
        console.log(`[CACHE_CLEANUP] Finished. Deleted ${deletedCount} files.`);
    } else {
        console.log('[CACHE_CLEANUP] Finished. No old files found to delete.');
    }
  });
}
setInterval(cleanupCache, CLEANUP_INTERVAL_MINUTES * 60 * 1000);
cleanupCache();

// Enable CORS
app.use(cors({
  exposedHeaders: ['Content-Disposition', 'X-Cache-Status']
}));

// -----------------------------
// HOME PAGE (Modern UI)
// -----------------------------
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Universal CORS Proxy</title>
  <style>
    body { font-family: 'Inter', sans-serif; background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    h1 { font-size: 1.8rem; margin-bottom: 20px; color: #38bdf8; }
    .card { background: #1e293b; padding: 30px; border-radius: 16px; box-shadow: 0 0 25px rgba(0,0,0,0.3); width: 90%; max-width: 550px; text-align: center; }
    input, textarea { width: 100%; background: #334155; border: none; outline: none; color: #f8fafc; padding: 12px; margin: 8px 0; border-radius: 8px; resize: none; }
    button { background: #38bdf8; color: #0f172a; font-weight: bold; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; transition: 0.2s; margin: 6px; }
    button:hover { background: #0ea5e9; }
    .row { display: flex; gap: 8px; justify-content: center; }
    #toast { visibility: hidden; min-width: 200px; background-color: #38bdf8; color: #0f172a; text-align: center; border-radius: 8px; padding: 12px; position: fixed; bottom: 30px; font-weight: 600; left: 50%; transform: translateX(-50%); z-index: 1; transition: all 0.4s; opacity: 0; }
    #toast.show { visibility: visible; opacity: 1; bottom: 50px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🌐 Universal CORS Proxy</h1>
    <input type="text" id="input-url" placeholder="Enter file URL (Google Drive supported)" />
    <div class="row">
      <button id="paste-btn">📋 Paste</button>
      <button id="copy-btn">📄 Copy Input</button>
    </div>
    <input type="text" id="filename" placeholder="Optional: Desired filename" />
    <button id="convert-btn">⚡ Generate CORS-Free URL</button>
    <textarea id="output-url" rows="3" readonly placeholder="Your CORS-Free URL will appear here..."></textarea>
    <button id="copy-output">📎 Copy Output</button>
  </div>
  <div id="toast"></div>

<script>
const input = document.getElementById('input-url');
const filenameInput = document.getElementById('filename');
const output = document.getElementById('output-url');
const convertBtn = document.getElementById('convert-btn');
const copyInputBtn = document.getElementById('copy-btn');
const pasteBtn = document.getElementById('paste-btn');
const copyOutputBtn = document.getElementById('copy-output');
const toast = document.getElementById('toast');
const BASE_PROXY = window.location.origin;
function showToast(message) {
  toast.textContent = message;
  toast.className = "show";
  setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 2000);
}
function convertDriveUrl(url) {
  try {
    const fileMatch = url.match(/https:\\/\\/drive\\.google\\.com\\/file\\/d\\/([A-Za-z0-9_-]+)/);
    const openMatch = url.match(/https:\\/\\/drive\\.google\\.com\\/open\\?id=([A-Za-z0-9_-]+)/);
    if (fileMatch) return 'https://drive.google.com/uc?id=' + fileMatch[1];
    if (openMatch) return 'https://drive.google.com/uc?id=' + openMatch[1];
  } catch (err) {}
  return null;
}
convertBtn.addEventListener('click', () => {
  let url = input.value.trim();
  if (!url) return showToast('Please enter a URL!');
  const driveConverted = convertDriveUrl(url);
  if (driveConverted) {
    showToast('Detected Google Drive URL – converted automatically!');
    url = driveConverted;
  }
  const filename = filenameInput.value.trim();
  let corsUrl = BASE_PROXY + '/proxy?url=' + encodeURIComponent(url);
  if (filename) corsUrl += '&filename=' + encodeURIComponent(filename);
  output.value = corsUrl;
  showToast('CORS-Free URL generated!');
});
copyInputBtn.addEventListener('click', () => {
  input.select(); document.execCommand('copy');
  showToast('Input URL copied!');
});
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    input.value = text;
    showToast('Pasted from clipboard!');
  } catch {
    showToast('Clipboard access denied');
  }
});
copyOutputBtn.addEventListener('click', () => {
  output.select(); document.execCommand('copy');
  showToast('CORS-Free URL copied!');
});
</script>
</body>
</html>`);
});

// -----------------------------
// PROXY ENDPOINT WITH CACHING
// -----------------------------
app.get('/proxy', async (req, res) => {
  try {
    const fileUrl = req.query.url;
    const filenameParam = req.query.filename;
    if (!fileUrl) return res.status(400).send('Missing url parameter');

    const cacheKeySource = `${fileUrl}|${filenameParam || ''}`;
    const cacheKey = crypto.createHash('md5').update(cacheKeySource).digest('hex');
    const cacheFilePath = path.join(CACHE_DIR, cacheKey);
    const metadataPath = cacheFilePath + '.meta.json';

    res.setHeader('Cache-Control', `public, max-age=${CACHE_DURATION_SECONDS}, immutable`);

    if (fs.existsSync(cacheFilePath) && fs.existsSync(metadataPath)) {
      const stats = fs.statSync(cacheFilePath);
      const ageInSeconds = (Date.now() - stats.mtime.getTime()) / 1000;
      if (ageInSeconds < CACHE_DURATION_SECONDS) {
        console.log(`[CACHE HIT] Serving ${fileUrl}`);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('Content-Type', metadata.contentType);
        res.setHeader('Content-Disposition', metadata.contentDisposition);
        fs.createReadStream(cacheFilePath).pipe(res);
        return;
      }
    }

    console.log(`[CACHE MISS] Fetching ${fileUrl}`);
    res.setHeader('X-Cache-Status', 'MISS');
    const upstreamResponse = await fetch(fileUrl);
    if (!upstreamResponse.ok) {
      return res.status(502).send(`Failed to fetch: ${upstreamResponse.statusText}`);
    }

    const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
    const disposition = upstreamResponse.headers.get('content-disposition') || '';
    const cdMatch = disposition.match(/filename\\*?=(?:UTF-8''|)["']?([^"';]+)["']?/i);
    const headerFilename = cdMatch ? decodeURIComponent(cdMatch[1]) : null;
    const urlFilename = path.basename(new URL(fileUrl).pathname);
    const filename = filenameParam || headerFilename || (urlFilename !== '/' ? urlFilename : 'file');
    const safeName = encodeURIComponent(filename).replace(/['()]/g, escape);
    const finalDisposition = `attachment; filename="${filename}"; filename*=UTF-8''${safeName}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', finalDisposition);
    
    const fileStream = fs.createWriteStream(cacheFilePath);
    upstreamResponse.body.pipe(fileStream);
    const metadata = { contentType, contentDisposition: finalDisposition };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
    upstreamResponse.body.pipe(res);

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Error: ' + err.message);
  }
});

// -----------------------------
// START SERVER + KEEP ALIVE
// -----------------------------
app.listen(PORT, () => {
  const localUrl = `http://localhost:${PORT}`;
  const publicUrl = 'https://corsproxy-bppd.onrender.com'; // Hardcoded public URL

  console.log(`✅ Server listening on ${localUrl}`);
  console.log(`✅ Public URL for keep-alive: ${publicUrl}`);

  // Keep Render's free tier awake by pinging the public URL
  setInterval(() => {
    console.log(`Pinging ${publicUrl} to keep alive...`);
    fetch(publicUrl)
      .then(res => {
        if (res.ok) {
          console.log('🔄 Keep-alive ping successful.');
        } else {
          console.log(`⚠️ Keep-alive ping failed with status: ${res.status}`);
        }
      })
      .catch(err => console.log(`⚠️ Keep-alive ping failed: ${err.message}`));
  }, 10 * 1000);
});