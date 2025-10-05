const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());

// Home page route
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Universal CORS Proxy</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
        * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
        body { margin: 0; padding: 0; background: #f4f6f8; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
        .container { background: #fff; margin-top: 50px; padding: 30px; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.1); width: 450px; }
        h1 { text-align: center; margin-bottom: 25px; color: #333; }
        label { display: block; margin: 15px 0 5px; font-weight: 600; color: #555; }
        input, textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
        textarea { resize: none; }
        .btn { margin-top: 15px; padding: 12px; width: 100%; background: #007bff; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; transition: 0.3s; }
        .btn:hover { background: #0056b3; }
        .row { display: flex; gap: 10px; margin-top: 5px; }
        .row button { flex: 1; padding: 10px; font-size: 14px; border-radius: 8px; border: none; cursor: pointer; transition: 0.3s; }
        .copy-btn { background: #28a745; color: #fff; }
        .copy-btn:hover { background: #1e7e34; }
        .paste-btn { background: #ffc107; color: #fff; }
        .paste-btn:hover { background: #e0a800; }

        /* Toast notifications */
        .toast {
          visibility: hidden;
          min-width: 200px;
          margin-left: -100px;
          background-color: #333;
          color: #fff;
          text-align: center;
          border-radius: 8px;
          padding: 12px;
          position: fixed;
          z-index: 999;
          left: 50%;
          bottom: 30px;
          font-size: 14px;
          opacity: 0;
          transition: opacity 0.5s, bottom 0.5s;
        }
        .toast.show {
          visibility: visible;
          opacity: 1;
          bottom: 50px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Universal CORS Proxy</h1>

        <label for="input-url">Enter File URL:</label>
        <input type="text" id="input-url" placeholder="Paste any file URL here">

        <div class="row">
          <button class="paste-btn" id="paste-btn">Paste from Clipboard</button>
          <button class="copy-btn" id="copy-btn">Copy Input</button>
        </div>

        <label for="filename">Optional Filename:</label>
        <input type="text" id="filename" placeholder="Leave blank to use original filename">

        <button class="btn" id="convert-btn">Generate CORS-Free URL</button>

        <label for="output-url">CORS-Free URL:</label>
        <textarea id="output-url" readonly placeholder="Your CORS-free URL will appear here"></textarea>

        <div class="row">
          <button class="copy-btn" id="copy-output">Copy URL</button>
        </div>
      </div>

      <!-- Toast notification -->
      <div id="toast" class="toast"></div>

      <script>
        const input = document.getElementById('input-url');
        const filenameInput = document.getElementById('filename');
        const output = document.getElementById('output-url');
        const convertBtn = document.getElementById('convert-btn');
        const copyInputBtn = document.getElementById('copy-btn');
        const pasteBtn = document.getElementById('paste-btn');
        const copyOutputBtn = document.getElementById('copy-output');
        const toast = document.getElementById('toast');

        // Show toast messages
        function showToast(message) {
          toast.textContent = message;
          toast.className = "toast show";
          setTimeout(() => { toast.className = "toast"; }, 2000);
        }

        // Detect Google Drive file URLs and convert to UC link
        function convertDriveUrl(url) {
          try {
            const driveRegex = /https:\\/\\/drive\\.google\\.com\\/(?:file\\/d\\/|open\\?id=)([A-Za-z0-9_-]{28,})/;
            const match = url.match(driveRegex);
            if (match && match[1]) {
              const id = match[1];
              return 'http://localhost:3000/proxy?url=' + encodeURIComponent('https://drive.google.com/uc?id=' + id);
            }
          } catch (err) {}
          return null;
        }

        // Generate CORS-free URL
        convertBtn.addEventListener('click', () => {
          let url = input.value.trim();
          if (!url) return showToast('Please enter a URL!');

          const driveUrl = convertDriveUrl(url);
          if (driveUrl) {
            output.value = driveUrl;
            showToast('Google Drive URL detected and converted!');
            return;
          }

          const filename = filenameInput.value.trim();
          let corsUrl = '/proxy?url=' + encodeURIComponent(url);
          if (filename) corsUrl += '&filename=' + encodeURIComponent(filename);
          output.value = window.location.origin + corsUrl;
          showToast('CORS-free URL generated!');
        });

        // Copy input URL
        copyInputBtn.addEventListener('click', () => {
          input.select();
          document.execCommand('copy');
          showToast('Input URL copied!');
        });

        // Paste from clipboard
        pasteBtn.addEventListener('click', async () => {
          try {
            const text = await navigator.clipboard.readText();
            input.value = text;
            showToast('Pasted from clipboard!');
          } catch (err) {
            showToast('Failed to read clipboard');
          }
        });

        // Copy output URL
        copyOutputBtn.addEventListener('click', () => {
          output.select();
          document.execCommand('copy');
          showToast('CORS-free URL copied!');
        });
      </script>
    </body>
    </html>
  `);
});

// Universal proxy endpoint
app.get('/proxy', async (req, res) => {
  try {
    let fileUrl = req.query.url;
    const filenameParam = req.query.filename;

    if (!fileUrl) return res.status(400).send('Missing url parameter');

    // Normalize Google Drive URLs
    const driveViewRegex = /https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{28,})(?:\/view.*)?/;
    const driveOpenRegex = /https:\/\/drive\.google\.com\/open\?id=([A-Za-z0-9_-]{28,})/;

    let match;
    if ((match = fileUrl.match(driveViewRegex))) {
      const id = match[1];
      fileUrl = `https://drive.google.com/uc?id=${id}`;
    } else if ((match = fileUrl.match(driveOpenRegex))) {
      const id = match[1];
      fileUrl = `https://drive.google.com/uc?id=${id}`;
    }

    // Fetch the file
    const response = await fetch(fileUrl);
    if (!response.ok) return res.status(500).send(`Failed to fetch file: ${response.statusText}`);

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const dispositionHeader = response.headers.get('content-disposition') || '';
    const filename =
      filenameParam ||
      dispositionHeader.match(/filename="?(.+?)"?$/)?.[1] ||
      'file';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});


app.listen(PORT, () => console.log(`CORS-free proxy running at http://localhost:${PORT}`));
