// Legendary geomagnetic storms, hand-authored from literature estimates.
// Each scenario is a piecewise-linear time series of Kp (and optional explicit
// aurora-boundary / red-glow overrides for events beyond the Kp scale),
// anchored at hour-offset 0 = eruption on the Sun.

import type { FlareClass } from './types';

export interface ScenarioPoint {
  h: number; // hours from anchor
  kp: number;
  boundaryLat?: number; // explicit equatorward boundary override (mag lat, deg)
  red?: number; // red-glow boost 0..1
}

export interface ScenarioFlare {
  h: number;
  cls: FlareClass;
  mag: number;
}

export interface Scenario {
  id: string;
  name: string;
  historicalDateIso: string | null; // null => synthetic what-if only
  blurb: string;
  dstMin: number;
  durationH: number;
  points: ScenarioPoint[];
  flares: ScenarioFlare[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'carrington-1859',
    name: 'CARRINGTON EVENT — 1859',
    historicalDateIso: '1859-09-01T11:15:00Z',
    blurb: 'The most intense geomagnetic storm on record. Telegraph systems failed worldwide; auroras seen at 18° latitude. Est. Dst −1760 nT.',
    dstMin: -1760,
    durationH: 60,
    points: [
      { h: 0, kp: 2 },
      { h: 17.0, kp: 2.5 }, // CME transit was a record ~17.6 h
      { h: 17.6, kp: 8, boundaryLat: 45 },
      { h: 19, kp: 9, boundaryLat: 32, red: 0.5 },
      { h: 22, kp: 9, boundaryLat: 20, red: 1.0 }, // blood-red skies, Caribbean auroras
      { h: 30, kp: 9, boundaryLat: 18, red: 1.0 },
      { h: 38, kp: 8.5, boundaryLat: 26, red: 0.8 },
      { h: 48, kp: 7, boundaryLat: 38, red: 0.4 },
      { h: 60, kp: 4, boundaryLat: 55 },
    ],
    flares: [{ h: 0, cls: 'X', mag: 45 }],
  },
  {
    id: 'railroad-1921',
    name: 'NY RAILROAD STORM — 1921',
    historicalDateIso: '1921-05-13T00:00:00Z',
    blurb: 'Most intense storm of the 20th century. Telegraph and railroad signal fires in New York. Est. Dst −907 nT.',
    dstMin: -907,
    durationH: 72,
    points: [
      { h: 0, kp: 3 },
      { h: 22, kp: 6, boundaryLat: 50 },
      { h: 30, kp: 8, boundaryLat: 38, red: 0.4 },
      { h: 40, kp: 9, boundaryLat: 28, red: 0.9 },
      { h: 50, kp: 9, boundaryLat: 30, red: 0.8 },
      { h: 60, kp: 7, boundaryLat: 42, red: 0.3 },
      { h: 72, kp: 4, boundaryLat: 56 },
    ],
    flares: [{ h: 0, cls: 'X', mag: 20 }],
  },
  {
    id: 'quebec-1989',
    name: 'QUÉBEC BLACKOUT — 1989',
    historicalDateIso: '1989-03-10T19:00:00Z',
    blurb: 'CME from an X4.5 flare collapsed the Hydro-Québec grid in 92 seconds, blacking out 6 million people for 9 hours. Dst −589 nT.',
    dstMin: -589,
    durationH: 96,
    points: [
      { h: 0, kp: 3 },
      { h: 54, kp: 5 }, // arrival 13 March 01:27 UT
      { h: 56, kp: 8, boundaryLat: 48 },
      { h: 62, kp: 9, boundaryLat: 40, red: 0.5 }, // blackout 13 Mar 07:44 UT
      { h: 72, kp: 9, boundaryLat: 42, red: 0.4 },
      { h: 84, kp: 7, boundaryLat: 50 },
      { h: 96, kp: 4, boundaryLat: 58 },
    ],
    flares: [{ h: 0, cls: 'X', mag: 4.5 }],
  },
  {
    id: 'halloween-2003',
    name: 'HALLOWEEN STORMS — 2003',
    historicalDateIso: '2003-10-28T11:10:00Z',
    blurb: 'A barrage of X-class flares including the record X28+. Satellites safed, aviation rerouted, Swedish grid failure. Dst −383 nT.',
    dstMin: -383,
    durationH: 96,
    points: [
      { h: 0, kp: 4 },
      { h: 18, kp: 6, boundaryLat: 52 }, // first CME arrives in ~19 h
      { h: 20, kp: 9, boundaryLat: 44, red: 0.5 },
      { h: 30, kp: 8, boundaryLat: 48 },
      { h: 42, kp: 9, boundaryLat: 43, red: 0.5 }, // second CME
      { h: 54, kp: 8, boundaryLat: 48 },
      { h: 72, kp: 6, boundaryLat: 54 },
      { h: 96, kp: 4, boundaryLat: 58 },
    ],
    flares: [
      { h: 0, cls: 'X', mag: 17.2 },
      { h: 25.5, cls: 'X', mag: 10 },
      { h: 170, cls: 'X', mag: 28 }, // 4 Nov — mostly a glancing blow, shown for drama
    ],
  },
  {
    id: 'gannon-2024',
    name: 'GANNON STORM — MAY 2024',
    historicalDateIso: '2024-05-08T05:09:00Z',
    blurb: 'Strongest storm in 21 years. Six CMEs merged; auroras photographed from the tropics. Dst −412 nT.',
    dstMin: -412,
    durationH: 96,
    points: [
      { h: 0, kp: 3 },
      { h: 59, kp: 5 }, // arrival 10 May ~16:30 UT
      { h: 61, kp: 8, boundaryLat: 48 },
      { h: 66, kp: 9, boundaryLat: 40, red: 0.5 },
      { h: 78, kp: 9, boundaryLat: 41, red: 0.5 },
      { h: 90, kp: 7, boundaryLat: 50 },
      { h: 96, kp: 5, boundaryLat: 56 },
    ],
    flares: [
      { h: 0, cls: 'X', mag: 1.0 },
      { h: 16.8, cls: 'X', mag: 2.2 },
      { h: 40.7, cls: 'X', mag: 4.5 },
      { h: 145, cls: 'X', mag: 8.7 }, // 14 May — biggest flare of cycle 25 at the time
    ],
  },
];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Interpolated scenario state at hours-from-anchor h, or null outside the window. */
export function scenarioStateAt(s: Scenario, h: number): { kp: number; boundaryLat?: number; red: number } | null {
  const pts = s.points;
  if (h < pts[0].h || h > pts[pts.length - 1].h) return null;
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].h <= h) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const lerp = (x?: number, y?: number) => (x === undefined || y === undefined ? undefined : x + (y - x) * t);
  return {
    kp: a.kp + (b.kp - a.kp) * t,
    boundaryLat: lerp(a.boundaryLat, b.boundaryLat) ?? a.boundaryLat ?? b.boundaryLat,
    red: lerp(a.red ?? 0, b.red ?? 0) ?? 0,
  };
}
