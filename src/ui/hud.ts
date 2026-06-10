// Top bar: simulated clock + mode badge.

import type { AuroraState } from '../data/types';

const clockEl = document.getElementById('sim-clock')!;
const badgeEl = document.getElementById('mode-badge')!;

const pad = (n: number) => String(n).padStart(2, '0');

export function updateClock(timeMs: number): void {
  const d = new Date(timeMs);
  clockEl.textContent =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

export type Mode = 'LIVE' | 'HISTORICAL' | 'FORECAST' | 'SIMULATION';

export function resolveMode(timeMs: number, state: AuroraState): Mode {
  if (state.source === 'scenario' || state.source === 'synthetic') return 'SIMULATION';
  if (Math.abs(timeMs - Date.now()) < 3600000) return 'LIVE';
  if (timeMs < Date.now()) return 'HISTORICAL';
  return 'FORECAST';
}

let currentMode: Mode | null = null;

export function updateBadge(mode: Mode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  badgeEl.textContent = mode;
  badgeEl.className = `badge ${mode.toLowerCase()}`;
}
