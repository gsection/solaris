// Solaris production server: zero-dependency static file server for dist/
// plus /api proxy-cache endpoints for the non-CORS upstreams (GFZ Kp, NASA DONKI)
// and an allowlisted NOAA SWPC text proxy. Container entrypoint.
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
const cacheDir = join(root, 'server', 'cache');
await mkdir(cacheDir, { recursive: true });

const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const SWPC_ALLOWLIST = new Set([
  '/text/3-day-geomag-forecast.txt',
  '/text/27-day-outlook.txt',
]);

// ---------------- upstream fetch with disk cache ----------------

async function cachedFetch(key, url, maxAgeMs, transform = (t) => t) {
  const file = join(cacheDir, key);
  let stale = null;
  try {
    const s = await stat(file);
    const body = await readFile(file, 'utf8');
    if (Date.now() - s.mtimeMs < maxAgeMs) return body;
    stale = body;
  } catch { /* no cache yet */ }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = transform(await res.text());
    await writeFile(file, body);
    return body;
  } catch (err) {
    console.error(`upstream failed for ${key}: ${err.message}`);
    if (stale !== null) return stale; // serve stale on failure
    throw err;
  }
}

// ---------------- /api handlers ----------------

async function kpExtension(startIso) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new Error('bad start');
  // align to the 3h grid
  start.setUTCHours(Math.floor(start.getUTCHours() / 3) * 3, 0, 0, 0);
  const end = new Date().toISOString().slice(0, 19) + 'Z';
  const url = `https://kp.gfz.de/app/json/?start=${start.toISOString().slice(0, 19)}Z&end=${end}&index=Kp`;
  return cachedFetch('kp-ext.json', url, 3 * 3600 * 1000, (text) => {
    const json = JSON.parse(text);
    const startSec = Math.floor(Date.parse(json.datetime[0]) / 1000);
    const kp = json.Kp.map((v) => (v == null ? -1 : Math.round(v * 100) / 100));
    return JSON.stringify({ start: startSec, stepSec: 10800, kp });
  });
}

async function flaresExtension(startIso) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new Error('bad start');
  const s = start.toISOString().slice(0, 10);
  const e = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const url = `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR?startDate=${s}&endDate=${e}`;
  return cachedFetch('flr-ext.json', url, 3 * 3600 * 1000, (text) => {
    const json = text.trim() ? JSON.parse(text) : [];
    const mapped = (Array.isArray(json) ? json : []).map((f) => ({
      b: Math.floor(Date.parse(f.beginTime) / 1000),
      p: f.peakTime ? Math.floor(Date.parse(f.peakTime) / 1000) : null,
      e: f.endTime ? Math.floor(Date.parse(f.endTime) / 1000) : null,
      c: (f.classType ?? '?').charAt(0),
      m: parseFloat((f.classType ?? '').slice(1)) || 1,
      loc: f.sourceLocation ?? null,
      ar: f.activeRegionNum ?? null,
    })).filter((f) => Number.isFinite(f.b));
    return JSON.stringify(mapped);
  });
}

// ---------------- static serving ----------------

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file = normalize(join(distDir, rel));
  if (!file.startsWith(distDir)) {
    res.writeHead(403).end();
    return;
  }
  let s;
  try {
    s = await stat(file);
  } catch {
    // SPA fallback
    file = join(distDir, 'index.html');
    try {
      s = await stat(file);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
  }
  const ext = extname(file);
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : ext === '.jpg' || ext === '.png'
        ? 'public, max-age=86400'
        : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// ---------------- server ----------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;
  try {
    if (p === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else if (p === '/api/kp-extension') {
      const body = await kpExtension(url.searchParams.get('start') ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(body);
    } else if (p === '/api/flares-extension') {
      const body = await flaresExtension(url.searchParams.get('start') ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(body);
    } else if (p === '/api/swpc-proxy') {
      const path = url.searchParams.get('path') ?? '';
      if (!SWPC_ALLOWLIST.has(path)) {
        res.writeHead(403).end('path not allowed');
        return;
      }
      const body = await cachedFetch(
        `swpc-${path.replaceAll('/', '_')}`,
        `https://services.swpc.noaa.gov${path}`,
        10 * 60 * 1000,
      );
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }).end(body);
    } else if (p.startsWith('/api/')) {
      res.writeHead(404).end('unknown api');
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(req, res, p);
    } else {
      res.writeHead(405).end();
    }
  } catch (err) {
    console.error(`${p}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('upstream error');
  }
});

server.listen(PORT, () => console.log(`solaris serving on :${PORT}`));
