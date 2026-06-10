export type FlareClass = 'A' | 'B' | 'C' | 'M' | 'X';

export interface FlareEvent {
  beginMs: number;
  peakMs: number;
  endMs: number;
  cls: FlareClass;
  mag: number; // e.g. X1.5 -> 1.5
  location?: string | null;
  ar?: number | null;
  synthetic?: boolean;
  scenario?: string;
}

export type AuroraSource = 'archive' | 'live' | 'forecast' | 'outlook' | 'synthetic' | 'scenario';

export interface AuroraState {
  kp: number;
  boundaryLatDeg: number; // equatorward edge of the oval, magnetic latitude
  ovalWidthDeg: number;
  intensity: number; // 0..~2
  redFraction: number; // 0 green -> 1 storm-red
  useOvation: boolean;
  source: AuroraSource;
}

export interface KpArchive {
  start: number; // epoch seconds of first sample
  stepSec: number; // 10800 (3h)
  kp: number[]; // -1 = missing
}

export interface SolarCycleMonth {
  ym: string; // "2026-06"
  ssn: number;
  pred: boolean;
}

export interface ArchiveData {
  kp: KpArchive;
  flares: FlareEvent[];
  cycle: SolarCycleMonth[];
  snapshotEndMs: number;
}

/** Map Kp to the parametric aurora state (scenarios may override fields). */
export function auroraFromKp(kp: number, source: AuroraSource): AuroraState {
  const k = Math.max(0, Math.min(9.5, kp));
  return {
    kp: k,
    boundaryLatDeg: Math.max(40, Math.min(67, 66.5 - 2.0 * k)),
    ovalWidthDeg: 3 + 1.3 * k,
    intensity: Math.pow(0.25 + k / 9, 1.5),
    redFraction: smoothstep(5, 9, k),
    useOvation: false,
    source,
  };
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function flareFlux(cls: FlareClass, mag: number): number {
  const base: Record<FlareClass, number> = { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 };
  return base[cls] * mag;
}

export function fluxToClass(flux: number): { cls: FlareClass; mag: number } {
  if (flux >= 1e-4) return { cls: 'X', mag: flux / 1e-4 };
  if (flux >= 1e-5) return { cls: 'M', mag: flux / 1e-5 };
  if (flux >= 1e-6) return { cls: 'C', mag: flux / 1e-6 };
  if (flux >= 1e-7) return { cls: 'B', mag: flux / 1e-7 };
  return { cls: 'A', mag: Math.max(0.1, flux / 1e-8) };
}
