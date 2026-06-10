// Deterministic synthetic space weather for the far future (beyond the 27-day outlook).
// Time is split into 27-day blocks (one Carrington rotation) anchored to a fixed epoch;
// each block is generated from a seeded RNG so scrubbing back and forth is stable.
// Flare rates scale with the predicted sunspot number; big flares spawn CMEs that
// arrive 1.5–3 days later as Kp surges with exponential decay.

import { mulberry32 } from '../core/rng';
import type { FlareEvent } from './types';

const BLOCK_MS = 27 * 86400000;
const EPOCH_MS = Date.UTC(2010, 0, 1);

export type SsnLookup = (tMs: number) => number; // predicted sunspot number for the month of t

interface CmeSurge {
  arriveMs: number;
  peakKp: number;
}

interface Block {
  flares: FlareEvent[];
  surges: CmeSurge[];
  bgNodes: number[]; // daily background-Kp control points (28 nodes, linear interp)
}

const blockCache = new Map<number, Block>();

function blockIndex(tMs: number): number {
  return Math.floor((tMs - EPOCH_MS) / BLOCK_MS);
}

function generateBlock(idx: number, ssnLookup: SsnLookup): Block {
  const cached = blockCache.get(idx);
  if (cached) return cached;

  const rng = mulberry32(0x50f1a2e ^ idx);
  const t0 = EPOCH_MS + idx * BLOCK_MS;
  const ssn = Math.max(5, ssnLookup(t0 + BLOCK_MS / 2) || 50);

  // expected flare counts for the 27-day block
  const expected: Array<[FlareEvent['cls'], number, number]> = [
    // [class, expected count, pareto alpha]
    ['C', (27 * ssn) / 12, 2.2],
    ['M', (27 * ssn) / 40, 1.9],
    ['X', (27 * ssn) / 400, 1.6],
  ];

  const flares: FlareEvent[] = [];
  const surges: CmeSurge[] = [];

  for (const [cls, mean, alpha] of expected) {
    // Poisson via inversion would be nicer; simple rounded-jitter count is fine here
    const count = Math.max(0, Math.round(mean * (0.6 + rng() * 0.8)));
    for (let i = 0; i < count; i++) {
      const begin = t0 + rng() * BLOCK_MS;
      let mag = Math.min(9.9, Math.pow(1 - rng(), -1 / alpha));
      if (cls === 'X' && rng() < 0.04) mag = 10 + rng() * 15; // rare monster
      const riseMs = (8 + rng() * 15) * 60000;
      const decayMs = (15 + rng() * 45) * 60000;
      flares.push({
        beginMs: begin,
        peakMs: begin + riseMs,
        endMs: begin + riseMs + decayMs,
        cls,
        mag: Math.round(mag * 10) / 10,
        synthetic: true,
      });

      // geoeffective CME chance for big flares
      const big = cls === 'X' || (cls === 'M' && mag >= 5);
      if (big && rng() < (cls === 'X' ? 0.6 : 0.4)) {
        const flux = (cls === 'X' ? 1e-4 : 1e-5) * mag;
        // bigger flare -> faster CME
        const transitH = 36 + rng() * 36 - Math.min(24, 8 * Math.log10(flux / 1e-5));
        const peakKp = Math.min(9, 6 + 2.2 * Math.log10(flux / 5e-5) + (rng() - 0.5));
        if (peakKp > 3.5) {
          surges.push({ arriveMs: begin + transitH * 3600000, peakKp });
        }
      }
    }
  }
  flares.sort((a, b) => a.beginMs - b.beginMs);

  // quiet background: daily control nodes, climatology scaled gently by SSN
  const bgBase = 1.2 + (ssn / 200) * 1.2;
  const bgNodes: number[] = [];
  for (let i = 0; i < 28; i++) bgNodes.push(Math.max(0.3, bgBase + (rng() - 0.4) * 2.2));

  const block: Block = { flares, surges, bgNodes };
  blockCache.set(idx, block);
  if (blockCache.size > 200) {
    const first = blockCache.keys().next().value;
    if (first !== undefined) blockCache.delete(first);
  }
  return block;
}

export function syntheticKpAt(tMs: number, ssnLookup: SsnLookup): number {
  const idx = blockIndex(tMs);
  // surges can originate in the previous block (CME transit + decay tail < 27 d)
  const blocks = [generateBlock(idx - 1, ssnLookup), generateBlock(idx, ssnLookup)];

  const cur = blocks[1];
  const dayF = (tMs - (EPOCH_MS + idx * BLOCK_MS)) / 86400000;
  const i = Math.max(0, Math.min(26, Math.floor(dayF)));
  const frac = dayF - i;
  let kp = cur.bgNodes[i] * (1 - frac) + cur.bgNodes[i + 1] * frac;

  for (const b of blocks) {
    for (const s of b.surges) {
      const dt = tMs - s.arriveMs;
      if (dt < -6 * 3600000 || dt > 60 * 3600000) continue;
      let env: number;
      if (dt < 0) env = 1 + dt / (6 * 3600000); // 6 h linear rise (sudden commencement-ish)
      else env = Math.exp(-dt / (18 * 3600000)); // 18 h decay
      kp = Math.max(kp, s.peakKp * Math.max(0, env));
    }
  }
  return Math.min(9, kp);
}

export function syntheticFlaresIn(t0: number, t1: number, ssnLookup: SsnLookup): FlareEvent[] {
  const out: FlareEvent[] = [];
  for (let idx = blockIndex(t0); idx <= blockIndex(t1); idx++) {
    for (const f of generateBlock(idx, ssnLookup).flares) {
      if (f.endMs >= t0 && f.beginMs <= t1) out.push(f);
    }
  }
  return out;
}
