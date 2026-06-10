// Side panels: Kp gauge, X-ray flux readout + trace, active flare list,
// event log ticker, solar-cycle sparkline, scenario launcher.

import type { KpProvider } from '../data/KpProvider';
import type { SimClock } from '../core/SimClock';
import type { Timeline } from './Timeline';
import { SCENARIOS } from '../data/scenarios';
import { flareFlux, fluxToClass, type AuroraState, type FlareEvent } from '../data/types';
import { ssnAt } from '../data/archive';
import type { SolarCycleMonth } from '../data/types';
import type { XraySample } from '../data/live';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// ---------------------------------------------------------------- Kp gauge

const gaugeEl = document.getElementById('kp-gauge')!;
const kpReadout = document.getElementById('kp-readout')!;
const kpStormLabel = document.getElementById('kp-storm-label')!;

const GAUGE_R = 70;

function buildGauge(): { needle: SVGLineElement } {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '170');
  svg.setAttribute('height', '95');
  svg.setAttribute('viewBox', '-85 -85 170 95');

  // colored arc segments 0..9
  for (let k = 0; k < 9; k++) {
    const a0 = Math.PI * (1 - k / 9);
    const a1 = Math.PI * (1 - (k + 0.92) / 9);
    const path = document.createElementNS(ns, 'path');
    const x0 = Math.cos(a0) * GAUGE_R;
    const y0 = -Math.sin(a0) * GAUGE_R;
    const x1 = Math.cos(a1) * GAUGE_R;
    const y1 = -Math.sin(a1) * GAUGE_R;
    path.setAttribute('d', `M ${x0} ${y0} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${x1} ${y1}`);
    const colors = ['#1faf5a', '#1faf5a', '#1faf5a', '#52c45a', '#c9d44e', '#f5d73c', '#ff9628', '#ff463c', '#ff28a0'];
    path.setAttribute('stroke', colors[k]);
    path.setAttribute('stroke-width', '9');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', '0.75');
    svg.appendChild(path);
    const label = document.createElementNS(ns, 'text');
    const am = Math.PI * (1 - (k + 0.5) / 9);
    label.setAttribute('x', String(Math.cos(am) * (GAUGE_R - 16)));
    label.setAttribute('y', String(-Math.sin(am) * (GAUGE_R - 16) + 3));
    label.setAttribute('fill', 'rgba(200,244,255,0.5)');
    label.setAttribute('font-size', '8');
    label.setAttribute('text-anchor', 'middle');
    label.textContent = String(k);
    svg.appendChild(label);
  }

  const needle = document.createElementNS(ns, 'line');
  needle.setAttribute('x1', '0');
  needle.setAttribute('y1', '0');
  needle.setAttribute('x2', String(-GAUGE_R + 22));
  needle.setAttribute('y2', '0');
  needle.setAttribute('stroke', '#eaffff');
  needle.setAttribute('stroke-width', '2');
  needle.style.filter = 'drop-shadow(0 0 4px #00e5ff)';
  svg.appendChild(needle);

  const hub = document.createElementNS(ns, 'circle');
  hub.setAttribute('r', '4');
  hub.setAttribute('fill', '#00e5ff');
  svg.appendChild(hub);

  gaugeEl.appendChild(svg);
  return { needle };
}

const { needle } = buildGauge();

function stormLabel(kp: number): string {
  if (kp >= 9) return 'G5 EXTREME STORM';
  if (kp >= 8) return 'G4 SEVERE STORM';
  if (kp >= 7) return 'G3 STRONG STORM';
  if (kp >= 6) return 'G2 MODERATE STORM';
  if (kp >= 5) return 'G1 MINOR STORM';
  if (kp >= 4) return 'ACTIVE';
  return 'QUIET';
}

function updateKpGauge(kp: number): void {
  const angle = Math.min(1, kp / 9) * 180;
  needle.setAttribute('transform', `rotate(${angle})`);
  kpReadout.textContent = kp.toFixed(1);
  kpStormLabel.textContent = stormLabel(kp);
  kpStormLabel.style.color = kp >= 7 ? '#ff3b54' : kp >= 5 ? '#ffb000' : 'rgba(200,244,255,0.7)';
}

// ---------------------------------------------------------------- X-ray

const xrayClass = document.getElementById('xray-class')!;
const xrayFlux = document.getElementById('xray-flux')!;
const xrayTrace = document.getElementById('xray-trace') as HTMLCanvasElement;

export let liveXray: XraySample[] = [];
export function setLiveXray(samples: XraySample[]): void {
  liveXray = samples;
}

/** Background + flare envelope flux at sim time (used outside the live window). */
function synthFluxAt(tMs: number, flares: FlareEvent[], ssn: number): number {
  let flux = 1.5e-8 + Math.max(0, ssn) * 1.2e-9;
  for (const f of flares) {
    if (tMs < f.beginMs - 600000 || tMs > f.endMs + 3 * 3600000) continue;
    const peak = flareFlux(f.cls, f.mag);
    let env = 0;
    if (tMs <= f.peakMs) {
      const rise = Math.max(60000, f.peakMs - f.beginMs);
      env = Math.max(0, 1 - (f.peakMs - tMs) / rise);
      env = env * env;
    } else {
      const tau = Math.max(300000, (f.endMs - f.peakMs) * 0.9);
      env = Math.exp(-(tMs - f.peakMs) / tau);
    }
    flux = Math.max(flux, peak * env);
  }
  return flux;
}

function xrayFluxAt(tMs: number, flares: FlareEvent[], ssn: number): number {
  if (liveXray.length > 0) {
    const first = liveXray[0].tMs;
    const last = liveXray[liveXray.length - 1].tMs;
    if (tMs >= first && tMs <= last + 5 * 60000) {
      let lo = 0;
      let hi = liveXray.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (liveXray[mid].tMs <= tMs) lo = mid;
        else hi = mid;
      }
      return liveXray[lo].flux;
    }
  }
  return synthFluxAt(tMs, flares, ssn);
}

function updateXray(tMs: number, flares: FlareEvent[], ssn: number): void {
  const flux = xrayFluxAt(tMs, flares, ssn);
  const { cls, mag } = fluxToClass(flux);
  xrayClass.textContent = `${cls}${mag.toFixed(1)}`;
  xrayClass.style.color = cls === 'X' ? '#ff3b54' : cls === 'M' ? '#ffb000' : '#eaffff';
  xrayFlux.textContent = `${flux.toExponential(1)} W/m²`;

  // 6-hour trace, log scale 1e-9..1e-3
  const ctx = xrayTrace.getContext('2d')!;
  const w = xrayTrace.width;
  const h = xrayTrace.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,229,255,0.15)';
  for (const e of [-8, -7, -6, -5, -4]) {
    const y = h - ((e + 9) / 6) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffe14d';
  ctx.shadowColor = '#ffe14d';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  const span = 6 * 3600000;
  for (let x = 0; x <= w; x++) {
    const t = tMs - span + (x / w) * span;
    const f = xrayFluxAt(t, flares, ssn);
    const y = h - ((Math.log10(f) + 9) / 6) * h;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------------------------------------------------------------- flare list

const flareList = document.getElementById('flare-list')!;

function updateFlareList(tMs: number, flares: FlareEvent[]): void {
  const active = flares.filter((f) => tMs >= f.beginMs && tMs <= f.endMs + 30 * 60000);
  active.sort((a, b) => flareFlux(b.cls, b.mag) - flareFlux(a.cls, a.mag));
  const items = active.slice(0, 6).map((f) => {
    const tag = f.scenario ? ' [SCN]' : f.synthetic ? ' [SYN]' : '';
    const loc = f.location ? ` ${f.location}` : '';
    const phase = tMs < f.peakMs ? '▲' : '▼';
    return `<li class="cls-${f.cls}">${f.cls}${f.mag.toFixed(1)} ${phase} ${fmtTime(f.beginMs)}${loc}${tag}</li>`;
  });
  flareList.innerHTML = items.length ? items.join('') : '<li class="dim">no active events</li>';
}

// ---------------------------------------------------------------- event log

const logEl = document.getElementById('event-log')!;
const logEntries: string[] = [];

export function logEvent(simMs: number, text: string, cls = ''): void {
  logEntries.push(`<li class="${cls}"><span class="t">${fmtDate(simMs)} ${fmtTime(simMs)}</span>${text}</li>`);
  if (logEntries.length > 60) logEntries.shift();
  logEl.innerHTML = logEntries.join('');
}

let prevSimMs: number | null = null;
let prevStormLevel = 0;

function detectEvents(tMs: number, provider: KpProvider, state: AuroraState): void {
  if (prevSimMs === null) {
    prevSimMs = tMs;
    return;
  }
  const dt = tMs - prevSimMs;
  // only log when moving forward at a follow-able pace (< 12h per frame)
  if (dt > 0 && dt < 12 * 3600000) {
    for (const f of provider.flaresIn(prevSimMs, tMs)) {
      if (f.beginMs > prevSimMs && f.beginMs <= tMs && (f.cls === 'M' || f.cls === 'X')) {
        const tag = f.scenario ? ' [SCENARIO]' : f.synthetic ? ' [SYNTHETIC]' : '';
        logEvent(f.beginMs, `FLARE ${f.cls}${f.mag.toFixed(1)} ERUPTING${f.location ? ' @ ' + f.location : ''}${tag}`, f.cls === 'X' ? 'alert' : 'warn');
      }
    }
    const level = state.kp >= 9 ? 5 : state.kp >= 8 ? 4 : state.kp >= 7 ? 3 : state.kp >= 6 ? 2 : state.kp >= 5 ? 1 : 0;
    if (level > prevStormLevel) {
      const names = ['', 'G1 MINOR', 'G2 MODERATE', 'G3 STRONG', 'G4 SEVERE', 'G5 EXTREME'];
      logEvent(tMs, `GEOMAGNETIC STORM ${names[level]} — Kp ${state.kp.toFixed(1)}`, level >= 3 ? 'alert' : 'warn');
    }
    prevStormLevel = level;
  } else if (dt !== 0) {
    prevStormLevel = 0; // jumped — reset crossing detection silently
  }
  prevSimMs = tMs;
}

// ---------------------------------------------------------------- sparkline

const sparkCanvas = document.getElementById('cycle-spark') as HTMLCanvasElement;

function drawSparkline(cycle: SolarCycleMonth[], tMs: number): void {
  const ctx = sparkCanvas.getContext('2d')!;
  const w = sparkCanvas.width;
  const h = sparkCanvas.height;
  ctx.clearRect(0, 0, w, h);
  // window: 2008 -> 2032 (cycles 24-25 + prediction)
  const t0 = Date.UTC(2008, 0, 1);
  const t1 = Date.UTC(2032, 0, 1);
  const rows = cycle.filter((c) => {
    const t = Date.parse(c.ym + '-01');
    return t >= t0 && t <= t1;
  });
  if (rows.length === 0) return;
  const maxSsn = Math.max(...rows.map((r) => r.ssn), 50);

  const drawSeg = (pred: boolean) => {
    ctx.beginPath();
    let started = false;
    for (const r of rows) {
      if (r.pred !== pred) continue;
      const t = Date.parse(r.ym + '-01');
      const x = ((t - t0) / (t1 - t0)) * w;
      const y = h - 4 - (r.ssn / maxSsn) * (h - 10);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = pred ? 'rgba(255,176,0,0.8)' : 'rgba(0,229,255,0.8)';
    ctx.setLineDash(pred ? [3, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  drawSeg(false);
  drawSeg(true);

  // cursor
  if (tMs >= t0 && tMs <= t1) {
    const x = ((tMs - t0) / (t1 - t0)) * w;
    ctx.strokeStyle = 'rgba(234,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- scenarios

export function buildScenarioButtons(
  provider: KpProvider,
  clock: SimClock,
  timeline: Timeline,
): void {
  const container = document.getElementById('scenario-buttons')!;

  for (const s of SCENARIOS) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '4px';

    const main = document.createElement('button');
    main.textContent = s.name;
    main.title = `${s.blurb}\n\nClick: replay at historical date.`;
    main.style.flex = '1';
    main.style.fontSize = '11px';
    main.addEventListener('click', () => {
      const anchor = s.historicalDateIso ? Date.parse(s.historicalDateIso) : Date.now();
      provider.startScenario(s.id, anchor);
      clock.setTime(anchor + (s.flares[0]?.h ?? 0) * 3600000 - 3600000);
      clock.setPlaying(true);
      timeline.focus(anchor - 12 * 3600000, anchor + s.durationH * 3600000);
      timeline.markDirty();
      logEvent(clock.timeMs, `SCENARIO ARMED: ${s.name} — ${s.blurb}`, 'warn');
    });

    const nowBtn = document.createElement('button');
    nowBtn.textContent = '⚡NOW';
    nowBtn.title = `What if it happened right now?\n${s.blurb}`;
    nowBtn.style.fontSize = '10px';
    nowBtn.addEventListener('click', () => {
      const anchor = Date.now();
      provider.startScenario(s.id, anchor);
      clock.setTime(anchor);
      clock.setPlaying(true);
      timeline.focus(anchor - 6 * 3600000, anchor + s.durationH * 3600000);
      timeline.markDirty();
      logEvent(clock.timeMs, `WHAT-IF ARMED: ${s.name} STRIKING NOW`, 'alert');
    });

    row.appendChild(main);
    row.appendChild(nowBtn);
    container.appendChild(row);
  }

  const clear = document.createElement('button');
  clear.textContent = 'DEACTIVATE SCENARIO';
  clear.style.fontSize = '10px';
  clear.style.opacity = '0.8';
  clear.addEventListener('click', () => {
    provider.clearScenario();
    timeline.markDirty();
    logEvent(clock.timeMs, 'SCENARIO DEACTIVATED — RESUMING REAL DATA');
  });
  container.appendChild(clear);
}

// ---------------------------------------------------------------- per-frame

const sourceEl = document.getElementById('aurora-source')!;
let lastPanelUpdate = 0;
let lastSparkUpdate = 0;

export function updatePanels(
  tMs: number,
  provider: KpProvider,
  state: AuroraState,
  cycle: SolarCycleMonth[],
): void {
  detectEvents(tMs, provider, state);

  const now = performance.now();
  if (now - lastPanelUpdate < 120) return; // ~8 Hz is plenty for DOM
  lastPanelUpdate = now;

  const windowFlares = provider.flaresIn(tMs - 12 * 3600000, tMs + 3600000);
  const ssn = ssnAt(cycle, tMs);

  updateKpGauge(state.kp);
  updateXray(tMs, windowFlares, ssn);
  updateFlareList(tMs, windowFlares);
  sourceEl.textContent = `AURORA SRC: ${state.useOvation ? 'OVATION-LIVE' : state.source.toUpperCase()}`;

  if (now - lastSparkUpdate > 1000) {
    lastSparkUpdate = now;
    drawSparkline(cycle, tMs);
  }
}
