const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_DURATION_SECONDS = 24 * 60 * 60;
const CLEANUP_INTERVAL_MINUTES = 60;
const MAX_CACHE_AGE_SECONDS = 2 * 24 * 60 * 60;

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cleanupCache() {
  fs.readdir(CACHE_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      if (file.endsWith('.json')) return;
      const filePath = path.join(CACHE_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        const ageInSeconds = (Date.now() - stats.mtime.getTime()) / 1000;
        if (ageInSeconds > MAX_CACHE_AGE_SECONDS) {
          fs.unlink(filePath, () => {});
          fs.unlink(filePath + '.meta.json', () => {});
        }
      });
    });
  });
}

setInterval(cleanupCache, CLEANUP_INTERVAL_MINUTES * 60 * 1000);
cleanupCache();

app.use(cors({
  exposedHeaders: ['Content-Disposition', 'X-Cache-Status']
}));

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

convertBtn.addEventListener('click', () => {
  const url = input.value.trim();
  if (!url) return showToast('Please enter a URL!');

  const filename = filenameInput.value.trim();
  // Build the proxy URL on the client side. Use window.location.origin to match BASE_PROXY
  let corsUrl = window.location.origin + '/proxy?url=' + encodeURIComponent(url);
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
</html>
`);
});

app.get('/proxy', async (req, res) => {
  try {
    const originalUrl = req.query.url;
    const filenameParam = req.query.filename;
    if (!originalUrl) return res.status(400).send('Missing url parameter');

    const cacheKey = crypto.createHash('md5').update(`${originalUrl}|${filenameParam || ''}`).digest('hex');
    const cacheFilePath = path.join(CACHE_DIR, cacheKey);
    const metadataPath = cacheFilePath + '.meta.json';

    res.setHeader('Cache-Control', `public, max-age=${CACHE_DURATION_SECONDS}, immutable`);

    // Serve from cache if available
    if (fs.existsSync(cacheFilePath) && fs.existsSync(metadataPath)) {
      const stats = fs.statSync(cacheFilePath);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      res.setHeader('X-Cache-Status', 'HIT');
      res.setHeader('Content-Type', metadata.contentType);
      res.setHeader('Content-Disposition', metadata.contentDisposition);
      fs.createReadStream(cacheFilePath).pipe(res);
      return;
    }

    res.setHeader('X-Cache-Status', 'MISS');

    // --- Fetch upstream ---
    let upstreamResponse;
    let targetUrl = originalUrl;

    const driveMatch = targetUrl.match(/https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/);
    if (driveMatch) {
      const fileId = driveMatch[1];
      const firstResponse = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { redirect: 'follow' });
      const contentTypeHeader = firstResponse.headers.get('content-type') || '';

      if (contentTypeHeader.includes('text/html')) {
        const body = await firstResponse.text();
        const cookies = firstResponse.headers.get('set-cookie');
        const confirmMatch = body.match(/<form id="download-form" action="([^"]+)"/);
        if (confirmMatch && confirmMatch[1] && cookies) {
          const finalUrl = `https://drive.google.com${confirmMatch[1].replace(/&amp;/g, '&')}`;
          upstreamResponse = await fetch(finalUrl, { headers: { 'Cookie': cookies } });
        } else return res.status(404).send('Google Drive file not found or confirmation failed.');
      } else {
        upstreamResponse = firstResponse;
      }
    } else {
      upstreamResponse = await fetch(targetUrl);
    }

    if (!upstreamResponse.ok) return res.status(upstreamResponse.status).send(`Failed to fetch: ${upstreamResponse.statusText}`);

    const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';

    // -----------------------
    // OLD LOGIC FOR FILENAME
    // -----------------------
    const disposition = upstreamResponse.headers.get('content-disposition') || '';
    const cdMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
    let headerFilename = null;
    if (cdMatch && cdMatch[1]) {
        try { headerFilename = decodeURIComponent(cdMatch[1].replace(/["']/g, '')); }
        catch (e) { headerFilename = cdMatch[1].replace(/["']/g, ''); }
    }

    const urlFilename = path.basename(new URL(originalUrl).pathname);
    let filename = filenameParam || headerFilename || (urlFilename !== '/' && urlFilename !== '' ? urlFilename : 'downloaded-file');

    // Ensure correct extension using mime-types
    const mime = require('mime-types');
    const ext = mime.extension(contentType);
    if (ext && !filename.includes('.')) filename += '.' + ext;

    const safeName = encodeURIComponent(filename).replace(/'/g, '%27');
    const finalDisposition = `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${safeName}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', finalDisposition);

    // --- Stream to client & cache ---
    const { PassThrough } = require('stream');
    const passthrough = new PassThrough();
    upstreamResponse.body.pipe(passthrough);

    const fileStream = fs.createWriteStream(cacheFilePath);
    passthrough.pipe(fileStream);
    passthrough.pipe(res);

    fileStream.on('finish', () => {
      const metadata = { contentType, contentDisposition: finalDisposition };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata), 'utf8');
      console.log(`[CACHE SET] Cached response for ${originalUrl}`);
    });

    fileStream.on('error', (err) => console.error('[CACHE ERROR] Could not write to cache:', err));

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send('Error: ' + err.message);
  }
});


app.listen(PORT, () => {
  console.log(`✅ Google Drive Proxy running on http://localhost:${PORT}`);
});

const KEEP_ALIVE_URL = 'https://corsproxy-bppd.onrender.com/';
setInterval(async () => {
  try {
    const res = await fetch(KEEP_ALIVE_URL);
    console.log(`Keep-alive ping: ${res.status} at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    console.warn('Keep-alive error:', err.message);
  }
}, 10 * 1000);
