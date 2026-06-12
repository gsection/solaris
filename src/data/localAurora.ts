// Local-aurora math: visibility thresholds for a location, darkness tests,
// the qualitative verdict, OVATION sampling, the 24-hour strip, the 7-day
// outlook, and the location history scans. Pure functions, no DOM.

import { magneticLatDeg } from '../astro/geomag';
import { subsolarPoint } from '../astro/solar';
import { forecastKpAt, type ForecastSeries } from './forecastText';
import type { OvationGrid } from './live';
import type { KpArchive } from './types';
import type { UserLocation } from '../core/location';

const DEG = Math.PI / 180;
const HOUR = 3600000;
const DAY = 86400000;

// Must match the oval boundary formula in auroraFromKp (types.ts):
//   equatorward boundary (mag lat) = 66.5 − 2.0·Kp
export const BOUNDARY_A = 66.5;
export const BOUNDARY_B = 2.0;
/** Aurora low on the poleward horizon is visible with the oval edge this many degrees poleward of you. */
export const HORIZON_ALLOWANCE_DEG = 5;
/** Sun elevation below which aurora becomes naked-eye visible (between civil and nautical dusk). */
export const DARK_SUN_ELEV_DEG = -8;

// ---------------------------------------------------------------- thresholds

export interface KpThresholds {
  magLatDeg: number; // signed
  kpOverhead: number; // Kp needed for the oval edge to reach your magnetic latitude
  kpHorizon: number; // Kp needed to see it low on the poleward horizon
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function kpThresholds(latDeg: number, lonDeg: number): KpThresholds {
  const magLat = magneticLatDeg(latDeg, lonDeg);
  const m = Math.abs(magLat);
  // ceiling 12 (not 9) so the UI can honestly render "Kp >9 — effectively never"
  return {
    magLatDeg: magLat,
    kpOverhead: clamp((BOUNDARY_A - m) / BOUNDARY_B, 0, 12),
    kpHorizon: clamp((BOUNDARY_A - m - HORIZON_ALLOWANCE_DEG) / BOUNDARY_B, 0, 12),
  };
}

// ---------------------------------------------------------------- darkness

export function sunElevationDeg(latDeg: number, lonDeg: number, tMs: number): number {
  const sp = subsolarPoint(tMs);
  const sinElev =
    Math.sin(latDeg * DEG) * Math.sin(sp.latDeg * DEG) +
    Math.cos(latDeg * DEG) * Math.cos(sp.latDeg * DEG) * Math.cos((lonDeg - sp.lonDeg) * DEG);
  return Math.asin(clamp(sinElev, -1, 1)) / DEG;
}

export function isDark(latDeg: number, lonDeg: number, tMs: number): boolean {
  return sunElevationDeg(latDeg, lonDeg, tMs) < DARK_SUN_ELEV_DEG;
}

export function anyDarkInRange(latDeg: number, lonDeg: number, t0Ms: number, t1Ms: number, stepMs = 30 * 60000): boolean {
  for (let t = t0Ms; t < t1Ms; t += stepMs) {
    if (isDark(latDeg, lonDeg, t)) return true;
  }
  return isDark(latDeg, lonDeg, t1Ms);
}

export function darkFraction(latDeg: number, lonDeg: number, t0Ms: number, t1Ms: number, samples = 7): number {
  let dark = 0;
  for (let i = 0; i < samples; i++) {
    if (isDark(latDeg, lonDeg, t0Ms + ((i + 0.5) / samples) * (t1Ms - t0Ms))) dark++;
  }
  return dark / samples;
}

/** Next time it gets dark at the location (10-min steps); null = no darkness within the horizon (midnight sun). */
export function nextDarkTime(latDeg: number, lonDeg: number, fromMs: number, horizonMs = 36 * HOUR): number | null {
  const step = 10 * 60000;
  for (let t = fromMs; t <= fromMs + horizonMs; t += step) {
    if (isDark(latDeg, lonDeg, t)) return t;
  }
  return null;
}

// ---------------------------------------------------------------- verdict

export type VerdictLevel = 'NONE' | 'LOW' | 'FAIR' | 'GOOD' | 'HIGH' | 'UNKNOWN';

export interface Verdict {
  level: VerdictLevel; // final, darkness applied
  geomagneticLevel: VerdictLevel; // ignoring darkness ("would be GOOD once dark")
  dark: boolean;
}

const RANK: Record<VerdictLevel, number> = { UNKNOWN: -1, NONE: 0, LOW: 1, FAIR: 2, GOOD: 3, HIGH: 4 };

export function verdictRank(level: VerdictLevel): number {
  return RANK[level];
}

function geomagneticBand(kp: number, th: KpThresholds): VerdictLevel {
  if (!Number.isFinite(kp)) return 'UNKNOWN';
  if (kp < th.kpHorizon - 0.5) return 'NONE';
  if (kp < th.kpHorizon + 0.5) return 'LOW';
  if (kp < th.kpOverhead) return 'FAIR';
  if (kp < th.kpOverhead + 1.5) return 'GOOD';
  return 'HIGH';
}

/**
 * Qualitative verdict from Kp vs thresholds + darkness. The OVATION nowcast
 * probability (when fresh) can only upgrade the geomagnetic band — it is a
 * trustworthy short-term model, but its absence means nothing.
 */
export function verdictFor(kp: number, th: KpThresholds, dark: boolean, ovationProbPct?: number): Verdict {
  let geo = geomagneticBand(kp, th);
  if (geo !== 'UNKNOWN' && ovationProbPct !== undefined) {
    let floor: VerdictLevel | null = null;
    if (ovationProbPct >= 85) floor = 'HIGH';
    else if (ovationProbPct >= 60) floor = 'GOOD';
    else if (ovationProbPct >= 30) floor = 'FAIR';
    if (floor && RANK[floor] > RANK[geo]) geo = floor;
  }
  const level: VerdictLevel = geo === 'UNKNOWN' ? 'UNKNOWN' : dark ? geo : 'NONE';
  return { level, geomagneticLevel: geo, dark };
}

// ---------------------------------------------------------------- OVATION

/**
 * OVATION visibility probability (%) at a location, allowing for aurora a few
 * degrees poleward (toward the relevant magnetic pole) being visible from there.
 */
export function ovationProbPctAt(grid: OvationGrid, latDeg: number, lonDeg: number, magLatSign: 1 | -1): number {
  const lonIdx = ((Math.round(lonDeg) % 360) + 360) % 360;
  let max = 0;
  for (let d = 0; d <= 8; d++) {
    const lat = clamp(Math.round(latDeg) + magLatSign * d, -90, 90);
    const v = grid.values[(lat + 90) * 360 + lonIdx];
    if (v > max) max = v;
  }
  return max / 2.55;
}

// ---------------------------------------------------------------- 24h strip

export interface StripSlot {
  t0Ms: number;
  t1Ms: number;
  kp: number; // NaN if unknown
  darkFrac: number;
  verdict: VerdictLevel;
}

/** 3-hourly slots (aligned to the forecast grid) covering [now, now+24h]. */
export function next24hStrip(
  f3: ForecastSeries | null,
  loc: UserLocation,
  th: KpThresholds,
  nowMs: number,
): StripSlot[] {
  const stepMs = f3?.stepMs ?? 3 * HOUR;
  const origin = f3?.startMs ?? Math.floor(nowMs / stepMs) * stepMs;
  const firstSlot = origin + Math.floor((nowMs - origin) / stepMs) * stepMs;
  const slots: StripSlot[] = [];
  for (let t0 = firstSlot; t0 < nowMs + 24 * HOUR; t0 += stepMs) {
    const t1 = t0 + stepMs;
    const kp = f3 ? forecastKpAt(f3, t0 + stepMs / 2) : NaN;
    const dark = anyDarkInRange(loc.latDeg, loc.lonDeg, t0, t1);
    slots.push({
      t0Ms: t0,
      t1Ms: t1,
      kp,
      darkFrac: darkFraction(loc.latDeg, loc.lonDeg, t0, t1),
      verdict: Number.isFinite(kp) ? verdictFor(kp, th, dark).level : 'UNKNOWN',
    });
  }
  return slots;
}

/** Index of the best viewing window; −1 if every slot is NONE/UNKNOWN. */
export function bestWindowIndex(slots: StripSlot[]): number {
  let best = -1;
  let bestRank = 0; // must beat NONE
  let bestScore = -Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const r = RANK[s.verdict];
    const score = (Number.isFinite(s.kp) ? s.kp : 0) * s.darkFrac;
    if (r > bestRank || (r === bestRank && r > 0 && score > bestScore)) {
      best = i;
      bestRank = r;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 7 days

export interface DayOutlook {
  dayStartMs: number; // UTC midnight
  maxKp: number; // NaN if no data
  verdict: VerdictLevel;
  source: 'forecast' | 'outlook' | 'none';
}

export function next7Days(
  f3: ForecastSeries | null,
  f27: ForecastSeries | null,
  loc: UserLocation,
  th: KpThresholds,
  nowMs: number,
): DayOutlook[] {
  const out: DayOutlook[] = [];
  const day0 = Math.floor(nowMs / DAY) * DAY;
  for (let d = 0; d < 7; d++) {
    const dayStart = day0 + d * DAY;
    let maxKp = NaN;
    let source: DayOutlook['source'] = 'none';
    if (f3) {
      // max over the 3-h slots of this day that the forecast covers
      for (let t = dayStart; t < dayStart + DAY; t += f3.stepMs) {
        const kp = forecastKpAt(f3, t + f3.stepMs / 2);
        if (Number.isFinite(kp) && (!Number.isFinite(maxKp) || kp > maxKp)) {
          maxKp = kp;
          source = 'forecast';
        }
      }
    }
    if (!Number.isFinite(maxKp) && f27) {
      const kp = forecastKpAt(f27, dayStart + DAY / 2); // outlook IS the daily max
      if (Number.isFinite(kp)) {
        maxKp = kp;
        source = 'outlook';
      }
    }
    const dark = anyDarkInRange(loc.latDeg, loc.lonDeg, dayStart, dayStart + DAY);
    out.push({
      dayStartMs: dayStart,
      maxKp,
      verdict: Number.isFinite(maxKp) ? verdictFor(maxKp, th, dark).level : 'UNKNOWN',
      source,
    });
  }
  return out;
}

// ---------------------------------------------------------------- history / next

export interface LocationStats {
  lastVisible: { tMs: number; kp: number } | null;
  strongest: { tMs: number; kp: number; gLabel: string } | null;
  nextWindow: { tMs: number; kp: number; source: 'forecast' | 'outlook' } | null;
}

export function gLabel(kp: number): string {
  if (kp >= 9) return 'G5';
  if (kp >= 8) return 'G4';
  if (kp >= 7) return 'G3';
  if (kp >= 6) return 'G2';
  if (kp >= 5) return 'G1';
  return `Kp ${kp.toFixed(0)}`;
}

/** A 3-h archive slot qualifies if Kp reached the horizon threshold AND it was dark at some point in the slot. */
function slotQualifies(loc: UserLocation, th: KpThresholds, kp: number, slotStartMs: number, stepMs: number): boolean {
  if (kp < 0 || kp < th.kpHorizon) return false; // -1 = missing sample
  // archive slots are UTC — local darkness can occur anywhere within
  return (
    isDark(loc.latDeg, loc.lonDeg, slotStartMs) ||
    isDark(loc.latDeg, loc.lonDeg, slotStartMs + HOUR) ||
    isDark(loc.latDeg, loc.lonDeg, slotStartMs + 2 * HOUR) ||
    isDark(loc.latDeg, loc.lonDeg, slotStartMs + stepMs - 60000)
  );
}

export function computeLocationStats(
  kpArchive: KpArchive,
  f3: ForecastSeries | null,
  f27: ForecastSeries | null,
  loc: UserLocation,
  th: KpThresholds,
  nowMs: number,
): LocationStats {
  const stats: LocationStats = { lastVisible: null, strongest: null, nextWindow: null };
  if (th.kpHorizon > 9) return stats; // effectively never at this latitude

  // ---- backward scan over the archive (~47k slots; cheap kp test first) ----
  const stepMs = kpArchive.stepSec * 1000;
  const startMs = kpArchive.start * 1000;
  const lastIdx = Math.min(kpArchive.kp.length - 1, Math.floor((nowMs - startMs) / stepMs));
  for (let i = lastIdx; i >= 0; i--) {
    const kp = kpArchive.kp[i];
    if (kp < th.kpHorizon) continue;
    const slotStart = startMs + i * stepMs;
    if (!slotQualifies(loc, th, kp, slotStart, stepMs)) continue;
    if (!stats.lastVisible) stats.lastVisible = { tMs: slotStart, kp };
    // ties go to the more recent event (we scan newest-first, so strictly greater replaces)
    if (!stats.strongest || kp > stats.strongest.kp) {
      stats.strongest = { tMs: slotStart, kp, gLabel: gLabel(kp) };
    }
  }

  // ---- forward scan: 3-day forecast slots, then 27-day outlook days ----
  if (f3) {
    for (let i = 0; i < f3.kp.length; i++) {
      const t0 = f3.startMs + i * f3.stepMs;
      if (t0 + f3.stepMs <= nowMs) continue;
      const kp = f3.kp[i];
      if (!Number.isFinite(kp) || kp < th.kpHorizon) continue;
      if (anyDarkInRange(loc.latDeg, loc.lonDeg, Math.max(t0, nowMs), t0 + f3.stepMs)) {
        stats.nextWindow = { tMs: t0, kp, source: 'forecast' };
        break;
      }
    }
  }
  if (!stats.nextWindow && f27) {
    const f3End = f3 ? f3.startMs + f3.kp.length * f3.stepMs : nowMs;
    for (let i = 0; i < f27.kp.length; i++) {
      const t0 = f27.startMs + i * f27.stepMs;
      if (t0 + f27.stepMs <= Math.max(nowMs, f3End)) continue;
      const kp = f27.kp[i];
      if (!Number.isFinite(kp) || kp < th.kpHorizon) continue;
      if (anyDarkInRange(loc.latDeg, loc.lonDeg, t0, t0 + f27.stepMs)) {
        stats.nextWindow = { tMs: t0, kp, source: 'outlook' };
        break;
      }
    }
  }
  return stats;
}
