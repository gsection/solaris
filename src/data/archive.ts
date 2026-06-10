// Loads the baked archive from /data/*.json and extends it toward "now"
// via the server's /api endpoints (graceful no-op if unavailable, e.g. plain `vite dev`).

import type { ArchiveData, FlareEvent, KpArchive, SolarCycleMonth } from './types';

interface RawFlare {
  b: number; p: number | null; e: number | null;
  c: string; m: number; loc: string | null; ar: number | null;
}

function mapFlare(f: RawFlare): FlareEvent {
  const beginMs = f.b * 1000;
  const peakMs = (f.p ?? f.b + 600) * 1000;
  return {
    beginMs,
    peakMs,
    endMs: (f.e ?? (f.p ?? f.b + 600) + 1200) * 1000,
    cls: 'ABCMX'.includes(f.c) ? (f.c as FlareEvent['cls']) : 'C',
    mag: f.m,
    location: f.loc,
    ar: f.ar,
  };
}

export async function loadArchive(): Promise<ArchiveData> {
  const [kp, rawFlares, cycle, meta] = await Promise.all([
    fetch('/data/kp_archive.json').then((r) => r.json()) as Promise<KpArchive>,
    fetch('/data/flares.json').then((r) => r.json()) as Promise<RawFlare[]>,
    fetch('/data/solar_cycle.json').then((r) => r.json()) as Promise<SolarCycleMonth[]>,
    fetch('/data/meta.json').then((r) => r.json()) as Promise<{ snapshotEnd: string }>,
  ]);

  const data: ArchiveData = {
    kp,
    flares: rawFlares.map(mapFlare),
    cycle,
    snapshotEndMs: Date.parse(meta.snapshotEnd),
  };

  await extendArchive(data).catch(() => undefined); // best-effort
  return data;
}

/** Pull the snapshot-end -> now gap from the server proxy cache, if present. */
async function extendArchive(data: ArchiveData): Promise<void> {
  const startIso = new Date(data.snapshotEndMs).toISOString();

  const kpRes = await fetch(`/api/kp-extension?start=${encodeURIComponent(startIso)}`);
  if (kpRes.ok) {
    const ext = (await kpRes.json()) as { start: number; stepSec: number; kp: number[] };
    if (Array.isArray(ext.kp) && ext.kp.length > 0 && ext.stepSec === data.kp.stepSec) {
      // splice: extension samples replace/append after the archive
      const offset = Math.round((ext.start - data.kp.start) / data.kp.stepSec);
      for (let i = 0; i < ext.kp.length; i++) {
        if (offset + i >= 0 && ext.kp[i] >= 0) data.kp.kp[offset + i] = ext.kp[i];
      }
      const endSec = data.kp.start + (data.kp.kp.length - 1) * data.kp.stepSec;
      data.snapshotEndMs = Math.max(data.snapshotEndMs, endSec * 1000);
    }
  }

  const flrRes = await fetch(`/api/flares-extension?start=${encodeURIComponent(startIso)}`);
  if (flrRes.ok) {
    const raw = (await flrRes.json()) as RawFlare[];
    if (Array.isArray(raw)) {
      const existing = new Set(data.flares.map((f) => f.beginMs));
      for (const f of raw) {
        const mapped = mapFlare(f);
        if (!existing.has(mapped.beginMs)) data.flares.push(mapped);
      }
      data.flares.sort((a, b) => a.beginMs - b.beginMs);
    }
  }
}

/** Kp at time t from the 3-hourly archive, linearly interpolated. NaN if out of range. */
export function archiveKpAt(kp: KpArchive, tMs: number): number {
  const stepMs = kp.stepSec * 1000;
  const x = (tMs - kp.start * 1000) / stepMs;
  if (x < 0 || x > kp.kp.length - 1) return NaN;
  const i = Math.floor(x);
  const a = kp.kp[i];
  const b = kp.kp[Math.min(i + 1, kp.kp.length - 1)];
  if (a < 0 && b < 0) return NaN;
  if (a < 0) return b;
  if (b < 0) return a;
  return a + (b - a) * (x - i);
}

/** SSN for the month containing t (predicted months included); NaN if unknown. */
export function ssnAt(cycle: SolarCycleMonth[], tMs: number): number {
  const d = new Date(tMs);
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  // cycle is sorted; binary search would be overkill for ~3k entries once
  const row = cycle.find((c) => c.ym === ym);
  if (row) return row.ssn;
  const last = cycle[cycle.length - 1];
  return last ? last.ssn : NaN;
}
