const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  exposedHeaders: ['Content-Disposition']
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

function showToast(message) {
  toast.textContent = message;
  toast.className = "show";
  setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 2000);
}

// Detect & convert Google Drive links
function convertDriveUrl(url) {
  try {
    const fileMatch = url.match(/https:\\/\\/drive\\.google\\.com\\/file\\/d\\/([A-Za-z0-9_-]+)/);
    const openMatch = url.match(/https:\\/\\/drive\\.google\\.com\\/open\\?id=([A-Za-z0-9_-]+)/);
    if (fileMatch) return 'https://drive.google.com/uc?id=' + fileMatch[1];
    if (openMatch) return 'https://drive.google.com/uc?id=' + openMatch[1];
  } catch (err) {}
  return null;
}

// Generate CORS-free URL
convertBtn.addEventListener('click', () => {
  let url = input.value.trim();
  if (!url) return showToast('Please enter a URL!');

  const driveConverted = convertDriveUrl(url);
  if (driveConverted) {
    showToast('Detected Google Drive URL – converted automatically!');
    url = driveConverted;
  }

  const filename = filenameInput.value.trim();
  let corsUrl = '/proxy?url=' + encodeURIComponent(url);
  if (filename) corsUrl += '&filename=' + encodeURIComponent(filename);

  output.value = window.location.origin + corsUrl;
  showToast('CORS-Free URL generated!');
});

// Copy input
copyInputBtn.addEventListener('click', () => {
  input.select(); document.execCommand('copy');
  showToast('Input URL copied!');
});

// Paste clipboard
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    input.value = text;
    showToast('Pasted from clipboard!');
  } catch {
    showToast('Clipboard access denied');
  }
});

// Copy output
copyOutputBtn.addEventListener('click', () => {
  output.select(); document.execCommand('copy');
  showToast('CORS-Free URL copied!');
});
</script>
</body>
</html>`);
});

// -----------------------------
// PROXY ENDPOINT (Improved)
// -----------------------------
app.get('/proxy', async (req, res) => {
  try {
    let fileUrl = req.query.url;
    const filenameParam = req.query.filename;
    if (!fileUrl) return res.status(400).send('Missing url parameter');

    // Normalize Google Drive links
    const driveViewRegex = /https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)(?:\/view.*)?/;
    const driveOpenRegex = /https:\/\/drive\.google\.com\/open\?id=([A-Za-z0-9_-]+)/;
    const driveUcRegex = /https:\/\/drive\.google\.com\/uc\?id=([A-Za-z0-9_-]+)/;
    let match;
    if ((match = fileUrl.match(driveViewRegex))) {
      fileUrl = 'https://drive.google.com/uc?id=' + match[1];
    } else if ((match = fileUrl.match(driveOpenRegex))) {
      fileUrl = 'https://drive.google.com/uc?id=' + match[1];
    } else if ((match = fileUrl.match(driveUcRegex))) {
      fileUrl = fileUrl;
    }

    // Fetch target file
    const upstreamResponse = await fetch(fileUrl);
    if (!upstreamResponse.ok) {
      return res.status(502).send(`Failed to fetch: ${upstreamResponse.statusText}`);
    }

    // Extract headers
    const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
    const disposition = upstreamResponse.headers.get('content-disposition') || '';

    // Extract filename from Content-Disposition if available
    const cdMatch = disposition.match(/filename\\*?=(?:UTF-8''|)["']?([^"';]+)["']?/i);
    const headerFilename = cdMatch ? decodeURIComponent(cdMatch[1]) : null;

    // Infer from URL
    const urlFilename = (() => {
      try {
        const parsed = new URL(fileUrl);
        const name = path.basename(parsed.pathname);
        if (name && name !== '/') return name;
      } catch {}
      return null;
    })();

    // Final filename
    const filename = filenameParam || headerFilename || urlFilename || 'file';
    const safeName = encodeURIComponent(filename).replace(/['()]/g, escape);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${safeName}`);

    // Stream file to response
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
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`✅ CORS-free proxy running at ${url}`);

  // Keep Render/other hosts awake
  if (url.startsWith('https://')) {
    setInterval(() => {
      fetch(url)
        .then(() => console.log('🔄 Keep-alive ping sent'))
        .catch(() => console.log('⚠️ Keep-alive ping failed'));
    }, 10 * 1000);
  }
});