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
