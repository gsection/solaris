// Bakes the historical space-weather archive into public/data/.
//  - NASA DONKI solar flares 2010 -> now (6-month chunks, disk-cached resume: DONKI 500s are common)
//  - GFZ Potsdam Kp index 2010 -> now (definitive + nowcast tail)
//  - NOAA SWPC solar cycle observed + predicted sunspot numbers
// Outputs are small (~4 MB total) and committed to git so Docker builds are hermetic.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'public', 'data');
const cacheDir = join(root, 'scripts', '.cache');
await mkdir(dataDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const START = '2010-01-01';
const now = new Date();
const today = now.toISOString().slice(0, 10);

async function fetchJson(url, { retries = 3, backoffMs = 5000, timeoutMs = 60_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || !text.trim()) return null; // DONKI returns empty body for quiet windows
      return JSON.parse(text);
    } catch (err) {
      if (attempt > retries) throw err;
      console.warn(`  retry ${attempt}/${retries} after error: ${err.message}`);
      await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
}

// ---------- 1. DONKI flares, 6-month chunks with resume cache ----------
function* chunks(startIso, endIso) {
  let s = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso + 'T00:00:00Z');
  while (s < end) {
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 6, s.getUTCDate()));
    yield [s.toISOString().slice(0, 10), (e < end ? e : end).toISOString().slice(0, 10)];
    s = e;
  }
}

console.log('=== DONKI flares ===');
const flares = [];
for (const [s, e] of chunks(START, today)) {
  const cacheFile = join(cacheDir, `flr-${s}.json`);
  let chunk;
  // the final (current) chunk is never cached so reruns pick up new flares
  const isFinal = new Date(e + 'T00:00:00Z') >= new Date(today + 'T00:00:00Z');
  try {
    if (isFinal) throw new Error('final chunk, always refetch');
    chunk = JSON.parse(await readFile(cacheFile, 'utf8'));
    console.log(`cache ${s} -> ${e}: ${chunk.length} flares`);
  } catch {
    const url = `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR?startDate=${s}&endDate=${e}`;
    console.log(`fetch ${s} -> ${e}`);
    const json = (await fetchJson(url)) ?? [];
    chunk = json.map((f) => ({
      b: Math.floor(Date.parse(f.beginTime) / 1000),
      p: f.peakTime ? Math.floor(Date.parse(f.peakTime) / 1000) : null,
      e: f.endTime ? Math.floor(Date.parse(f.endTime) / 1000) : null,
      c: (f.classType ?? '?').charAt(0),
      m: parseFloat((f.classType ?? '').slice(1)) || 1,
      loc: f.sourceLocation ?? null,
      ar: f.activeRegionNum ?? null,
    })).filter((f) => Number.isFinite(f.b));
    await writeFile(cacheFile, JSON.stringify(chunk));
    console.log(`  ${chunk.length} flares`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  flares.push(...chunk);
}
flares.sort((a, b) => a.b - b.b);
await writeFile(join(dataDir, 'flares.json'), JSON.stringify(flares));
console.log(`flares.json: ${flares.length} events`);

// ---------- 2. GFZ Kp, definitive + nowcast tail ----------
console.log('=== GFZ Kp ===');
const gfzBase = 'https://kp.gfz.de/app/json/';
const endIso = now.toISOString().slice(0, 19) + 'Z';
const defUrl = `${gfzBase}?start=${START}T00:00:00Z&end=${endIso}&index=Kp&status=def`;
const def = await fetchJson(defUrl, { timeoutMs: 120_000 });
if (!def || !Array.isArray(def.datetime) || def.datetime.length === 0) {
  throw new Error('GFZ definitive Kp fetch returned nothing');
}
console.log(`definitive: ${def.datetime.length} samples (${def.datetime[0]} -> ${def.datetime.at(-1)})`);

// fill the gap from end of definitive data to now with nowcast values
const defEnd = def.datetime.at(-1);
const allUrl = `${gfzBase}?start=${defEnd}&end=${endIso}&index=Kp`;
let tailKp = [], tailDt = [];
try {
  const tail = await fetchJson(allUrl, { timeoutMs: 120_000 });
  if (tail && Array.isArray(tail.datetime)) {
    // skip the first sample (duplicate of defEnd)
    for (let i = 0; i < tail.datetime.length; i++) {
      if (tail.datetime[i] > defEnd) { tailDt.push(tail.datetime[i]); tailKp.push(tail.Kp[i]); }
    }
    console.log(`nowcast tail: ${tailDt.length} samples`);
  }
} catch (err) {
  console.warn(`nowcast tail failed (non-fatal): ${err.message}`);
}

const startSec = Math.floor(Date.parse(def.datetime[0]) / 1000);
const kpValues = [...def.Kp, ...tailKp].map((v) => (v == null ? -1 : Math.round(v * 100) / 100));
const kpArchive = { start: startSec, stepSec: 10800, kp: kpValues };
await writeFile(join(dataDir, 'kp_archive.json'), JSON.stringify(kpArchive));
console.log(`kp_archive.json: ${kpValues.length} samples`);

// ---------- 3. Solar cycle observed + predicted ----------
console.log('=== Solar cycle ===');
const observed = await fetchJson('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json');
const predicted = await fetchJson('https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json');
const cycle = [];
for (const row of observed ?? []) {
  // time-tag like "2010-01"; ssn field name varies: "ssn" / "smoothed_ssn"
  const ssn = row.ssn ?? row.smoothed_ssn;
  if (row['time-tag'] && ssn != null && ssn >= 0) cycle.push({ ym: row['time-tag'], ssn: Math.round(ssn * 10) / 10, pred: false });
}
const lastObserved = cycle.at(-1)?.ym ?? '1700-01';
for (const row of predicted ?? []) {
  const ssn = row.predicted_ssn ?? row.ssn;
  if (row['time-tag'] && ssn != null && row['time-tag'] > lastObserved) {
    cycle.push({ ym: row['time-tag'], ssn: Math.round(ssn * 10) / 10, pred: true });
  }
}
await writeFile(join(dataDir, 'solar_cycle.json'), JSON.stringify(cycle));
console.log(`solar_cycle.json: ${cycle.length} months (${cycle.filter((c) => c.pred).length} predicted)`);

// ---------- 4. meta ----------
const lastKpSec = startSec + (kpValues.length - 1) * 10800;
await writeFile(join(dataDir, 'meta.json'), JSON.stringify({
  snapshotEnd: new Date(lastKpSec * 1000).toISOString(),
  generated: now.toISOString(),
  flareCount: flares.length,
  kpSamples: kpValues.length,
}));
console.log('done.');
