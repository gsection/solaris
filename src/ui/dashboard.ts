// The NOW dashboard: headline aurora verdict for the user's location, the
// next-24h strip, the 7-day outlook bars, the location history stats, and the
// location chip + popover. Pure presentation over data/localAurora.ts.

import type { KpProvider } from '../data/KpProvider';
import type { ArchiveData } from '../data/types';
import type { OvationGrid } from '../data/live';
import {
  bestWindowIndex,
  computeLocationStats,
  gLabel,
  isDark,
  kpThresholds,
  next24hStrip,
  next7Days,
  nextDarkTime,
  ovationProbPctAt,
  verdictFor,
  verdictRank,
  type KpThresholds,
  type LocationStats,
  type VerdictLevel,
} from '../data/localAurora';
import {
  DEFAULT_LOCATION,
  loadStoredLocation,
  locationFromUrl,
  parseLocationInput,
  requestGeolocation,
  saveLocation,
  suggestPlaces,
  type UserLocation,
} from '../core/location';
import { devState } from './devPanel';

export const VERDICT_COLORS: Record<VerdictLevel, string> = {
  NONE: '#5d6f7d',
  UNKNOWN: '#5d6f7d',
  LOW: '#3fa7c4',
  FAIR: '#ffe14d',
  GOOD: '#ffb000',
  HIGH: '#1aff8c',
};

const HOUR = 3600000;
const OVATION_FRESH_MS = 45 * 60000;

const pad = (n: number) => String(n).padStart(2, '0');
const localHHMM = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const utcDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const fmtThreshold = (kp: number) => (kp > 9 ? '>9' : kp.toFixed(1));

export interface DashboardDeps {
  provider: KpProvider;
  archive: ArchiveData;
  getOvation: () => OvationGrid | null;
  onLocationChanged: (loc: UserLocation) => void;
}

export interface Dashboard {
  update(tMs: number): void;
  setLocation(loc: UserLocation): void;
  getLocation(): UserLocation;
}

export function mountDashboard(deps: DashboardDeps): Dashboard {
  const el = {
    chip: document.getElementById('loc-chip') as HTMLButtonElement,
    locLabel: document.getElementById('now-loc-label')!,
    verdict: document.getElementById('now-verdict')!,
    verdictSub: document.getElementById('now-verdict-sub')!,
    kp: document.getElementById('now-kp')!,
    kpHorizon: document.getElementById('now-kp-horizon')!,
    kpOverhead: document.getElementById('now-kp-overhead')!,
    ovation: document.getElementById('now-ovation')!,
    strip: document.getElementById('strip24') as HTMLCanvasElement,
    stripBest: document.getElementById('strip24-best')!,
    week: document.getElementById('week-bars') as HTMLCanvasElement,
    statLast: document.getElementById('stat-last')!,
    statStrongest: document.getElementById('stat-strongest')!,
    statNext: document.getElementById('stat-next')!,
    popover: document.getElementById('loc-popover')!,
    useGeo: document.getElementById('loc-use-geo') as HTMLButtonElement,
    input: document.getElementById('loc-input') as HTMLInputElement,
    suggest: document.getElementById('loc-suggest')!,
  };

  let loc: UserLocation = locationFromUrl() ?? loadStoredLocation() ?? DEFAULT_LOCATION;
  let th: KpThresholds = kpThresholds(loc.latDeg, loc.lonDeg);
  let magLatSign: 1 | -1 = th.magLatDeg >= 0 ? 1 : -1;

  let lastUpdate = 0;
  let stripKey = '';
  let weekKey = '';
  let statsKey = '';
  let stats: LocationStats | null = null;

  function applyLocation(next: UserLocation, persist: boolean): void {
    loc = next;
    th = kpThresholds(loc.latDeg, loc.lonDeg);
    magLatSign = th.magLatDeg >= 0 ? 1 : -1;
    stripKey = weekKey = statsKey = '';
    lastUpdate = 0;
    if (persist) saveLocation(loc);
    renderChip();
    deps.onLocationChanged(loc);
  }

  // ------------------------------------------------------------ chip + popover

  function renderChip(): void {
    el.chip.textContent = `⌖ ${loc.label}`;
    el.locLabel.textContent = loc.label;
  }

  function closePopover(): void {
    el.popover.hidden = true;
    el.input.value = '';
    el.suggest.innerHTML = '';
  }

  el.chip.addEventListener('click', () => {
    el.popover.hidden = !el.popover.hidden;
    if (!el.popover.hidden) el.input.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (el.popover.hidden) return;
    const t = e.target as Node;
    if (!el.popover.contains(t) && t !== el.chip) closePopover();
  });

  el.useGeo.addEventListener('click', async () => {
    el.useGeo.textContent = '⌖ LOCATING…';
    el.useGeo.disabled = true;
    const geo = await requestGeolocation();
    el.useGeo.textContent = '⌖ USE MY LOCATION';
    el.useGeo.disabled = false;
    if (geo) {
      applyLocation(geo, true);
      closePopover();
    } else {
      el.useGeo.textContent = '⌖ UNAVAILABLE — TYPE A PLACE';
    }
  });

  function renderSuggestions(): void {
    const text = el.input.value;
    el.suggest.innerHTML = '';
    const coords = parseLocationInput(text);
    const places = suggestPlaces(text);
    const add = (label: string, pick: UserLocation) => {
      const li = document.createElement('li');
      li.textContent = label;
      li.addEventListener('click', () => {
        applyLocation(pick, true);
        closePopover();
      });
      el.suggest.appendChild(li);
    };
    for (const p of places) {
      add(p.name, { latDeg: p.latDeg, lonDeg: p.lonDeg, label: p.name.toUpperCase(), source: 'manual' });
    }
    if (coords && places.length === 0) add(`use ${coords.label}`, coords);
  }
  el.input.addEventListener('input', renderSuggestions);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const parsed = parseLocationInput(el.input.value);
      if (parsed) {
        applyLocation(parsed, true);
        closePopover();
      }
    } else if (e.key === 'Escape') {
      closePopover();
    }
  });

  renderChip();

  // ------------------------------------------------------------ headline

  function updateHeadline(tMs: number): void {
    const kpNow = devState.kpOverride >= 0 ? devState.kpOverride : deps.provider.kpAt(tMs).kp;
    const dark = isDark(loc.latDeg, loc.lonDeg, tMs);

    // freshness keys off Forecast Time — the product's validity moment;
    // Observation Time is the solar-wind basis and can lag hours behind
    const grid = deps.getOvation();
    const fresh = grid !== null && Math.abs(Date.now() - grid.forecastMs) < OVATION_FRESH_MS;
    const ovationPct = grid && fresh ? ovationProbPctAt(grid, loc.latDeg, loc.lonDeg, magLatSign) : undefined;

    const v = verdictFor(kpNow, th, dark, ovationPct);
    el.verdict.textContent = v.level;
    el.verdict.className = `big-readout verdict-${v.level.toLowerCase()}`;

    let sub: string;
    if (th.kpHorizon > 9) {
      sub = 'BELOW AURORAL LATITUDES — KP 9+ REQUIRED';
    } else if (!v.dark) {
      const nd = nextDarkTime(loc.latDeg, loc.lonDeg, tMs);
      const wouldBe = verdictRank(v.geomagneticLevel) >= verdictRank('FAIR') ? ` — ${v.geomagneticLevel} ONCE DARK` : '';
      sub = nd === null ? 'NO DARKNESS <36H — MIDNIGHT SUN' : `DAYLIGHT — NEXT DARK ${localHHMM(nd)}${wouldBe}`;
    } else if (verdictRank(v.level) >= verdictRank('LOW')) {
      const dir = magLatSign > 0 ? 'NORTH' : 'SOUTH';
      sub = `LOOK ${dir}${kpNow >= th.kpOverhead ? ' — OVERHEAD' : ' — LOW ON HORIZON'}`;
    } else {
      sub = 'GEOMAGNETIC FIELD TOO QUIET';
    }
    el.verdictSub.textContent = sub;

    el.kp.textContent = Number.isFinite(kpNow) ? kpNow.toFixed(1) : '–';
    el.kpHorizon.textContent = fmtThreshold(th.kpHorizon);
    el.kpOverhead.textContent = fmtThreshold(th.kpOverhead);
    el.ovation.textContent = grid ? (fresh ? `${ovationPct!.toFixed(0)}%` : 'STALE') : '—';
  }

  // ------------------------------------------------------------ canvas helpers

  function prepCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // ------------------------------------------------------------ 24h strip

  function updateStrip(nowMs: number): void {
    const key = `${loc.latDeg},${loc.lonDeg}|${deps.provider.forecast3d?.startMs ?? 'x'}|${Math.floor(nowMs / HOUR)}|${el.strip.clientWidth}`;
    if (key === stripKey) return;
    stripKey = key;

    const slots = next24hStrip(deps.provider.forecast3d, loc, th, nowMs);
    const best = bestWindowIndex(slots);
    const { ctx, w, h } = prepCanvas(el.strip);

    const t0 = nowMs;
    const t1 = nowMs + 24 * HOUR;
    const xOf = (t: number) => ((t - t0) / (t1 - t0)) * w;
    const barTop = 12;
    const barH = h - 26;

    for (const s of slots) {
      const x0 = Math.max(0, xOf(s.t0Ms));
      const x1 = Math.min(w, xOf(s.t1Ms));
      if (x1 <= x0) continue;
      // darkness backdrop: dark = near-black, daylight = faint amber wash
      ctx.fillStyle = `rgba(255, 176, 0, ${0.16 * (1 - s.darkFrac)})`;
      ctx.fillRect(x0, barTop, x1 - x0, barH);
      ctx.fillStyle = 'rgba(0, 2, 8, 0.55)';
      ctx.fillRect(x0, barTop, (x1 - x0) * s.darkFrac, barH);
      // verdict block
      ctx.fillStyle = VERDICT_COLORS[s.verdict];
      ctx.globalAlpha = s.verdict === 'NONE' || s.verdict === 'UNKNOWN' ? 0.35 : 0.85;
      const blockH = Number.isFinite(s.kp) ? Math.max(4, (Math.min(9, s.kp) / 9) * barH) : 4;
      ctx.fillRect(x0 + 1, barTop + barH - blockH, x1 - x0 - 2, blockH);
      ctx.globalAlpha = 1;
      // kp value
      if (Number.isFinite(s.kp) && x1 - x0 > 18) {
        ctx.fillStyle = 'rgba(234,255,255,0.85)';
        ctx.font = '9px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(s.kp.toFixed(1), (x0 + x1) / 2, barTop + 9);
      }
    }

    // local-time labels every 6 h
    ctx.fillStyle = 'rgba(200,244,255,0.6)';
    ctx.font = '9px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const t = nowMs + i * 6 * HOUR;
      const x = Math.min(xOf(t), w - 30);
      ctx.fillText(i === 0 ? 'NOW' : localHHMM(t), x + 1, h - 3);
      ctx.fillStyle = 'rgba(0,229,255,0.25)';
      ctx.fillRect(xOf(t), barTop, 1, barH);
      ctx.fillStyle = 'rgba(200,244,255,0.6)';
    }

    // best-window bracket
    if (best >= 0) {
      const s = slots[best];
      const x0 = Math.max(0, xOf(s.t0Ms));
      const x1 = Math.min(w, xOf(s.t1Ms));
      ctx.strokeStyle = VERDICT_COLORS[s.verdict];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, barTop - 4);
      ctx.lineTo(x0, barTop - 8);
      ctx.lineTo(x1, barTop - 8);
      ctx.lineTo(x1, barTop - 4);
      ctx.stroke();
      el.stripBest.textContent = `BEST ${localHHMM(Math.max(s.t0Ms, nowMs))}–${localHHMM(s.t1Ms)} · KP ${s.kp.toFixed(1)}`;
      (el.stripBest as HTMLElement).style.color = VERDICT_COLORS[s.verdict];
    } else {
      const hasData = slots.some((s) => s.verdict !== 'UNKNOWN');
      el.stripBest.textContent = hasData ? 'NO VISIBLE WINDOW' : 'NO FORECAST DATA';
      (el.stripBest as HTMLElement).style.color = '';
    }
  }

  // ------------------------------------------------------------ week bars

  function updateWeek(nowMs: number): void {
    const key = `${loc.latDeg},${loc.lonDeg}|${deps.provider.forecast3d?.startMs ?? 'x'}|${deps.provider.outlook27d?.startMs ?? 'x'}|${Math.floor(nowMs / 86400000)}|${el.week.clientWidth}`;
    if (key === weekKey) return;
    weekKey = key;

    const days = next7Days(deps.provider.forecast3d, deps.provider.outlook27d, loc, th, nowMs);
    const { ctx, w, h } = prepCanvas(el.week);
    const gap = 6;
    const barW = (w - gap * 6) / 7;
    const barMaxH = h - 26;

    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const x = i * (barW + gap);
      const known = Number.isFinite(d.maxKp);
      const frac = known ? Math.min(9, Math.max(0.6, d.maxKp)) / 9 : 0.25;
      const bh = Math.max(3, frac * barMaxH);
      ctx.fillStyle = VERDICT_COLORS[d.verdict];
      ctx.globalAlpha = d.verdict === 'NONE' || d.verdict === 'UNKNOWN' ? 0.35 : 0.85;
      ctx.fillRect(x, 12 + barMaxH - bh, barW, bh);
      ctx.globalAlpha = 1;
      if (!known) {
        // hatch unknown bars
        ctx.strokeStyle = 'rgba(93,111,125,0.5)';
        ctx.beginPath();
        for (let hx = x - barMaxH; hx < x + barW; hx += 5) {
          ctx.moveTo(Math.max(x, hx), 12 + barMaxH);
          ctx.lineTo(Math.min(x + barW, hx + barMaxH), 12 + barMaxH - Math.min(barMaxH, x + barW - Math.max(x, hx)));
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(234,255,255,0.85)';
      ctx.font = '9px "Share Tech Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(known ? d.maxKp.toFixed(1) : '?', x + barW / 2, 9);
      ctx.fillStyle = i === 0 ? 'rgba(26,255,140,0.9)' : 'rgba(200,244,255,0.6)';
      ctx.fillText(i === 0 ? 'TODAY' : WEEKDAYS[new Date(d.dayStartMs).getUTCDay()], x + barW / 2, h - 3);
    }
  }

  // ------------------------------------------------------------ history stats

  function updateStats(nowMs: number): void {
    const key = `${loc.latDeg},${loc.lonDeg}|${deps.archive.snapshotEndMs}|${deps.provider.forecast3d?.startMs ?? 'x'}|${deps.provider.outlook27d?.startMs ?? 'x'}|${Math.floor(nowMs / (3 * HOUR))}`;
    if (key === statsKey) return;
    statsKey = key;

    stats = computeLocationStats(deps.archive.kp, deps.provider.forecast3d, deps.provider.outlook27d, loc, th, nowMs);

    if (th.kpHorizon > 9) {
      el.statLast.textContent = 'NEVER AT THIS LATITUDE';
      el.statStrongest.textContent = 'NEVER AT THIS LATITUDE';
      el.statNext.textContent = 'KP 9+ REQUIRED';
      return;
    }

    if (stats.lastVisible) {
      const daysAgo = Math.floor((nowMs - stats.lastVisible.tMs) / 86400000);
      const ago = daysAgo === 0 ? 'TODAY' : daysAgo === 1 ? '1D AGO' : `${daysAgo}D AGO`;
      el.statLast.textContent = `${utcDate(stats.lastVisible.tMs)} — KP ${stats.lastVisible.kp.toFixed(1)} (${gLabel(stats.lastVisible.kp)}) · ${ago}`;
    } else {
      el.statLast.textContent = 'NOT SINCE 2010';
    }

    el.statStrongest.textContent = stats.strongest
      ? `${utcDate(stats.strongest.tMs)} — KP ${stats.strongest.kp.toFixed(1)} (${stats.strongest.gLabel})`
      : 'NONE ON RECORD';

    if (stats.nextWindow) {
      const d = new Date(stats.nextWindow.tMs);
      const day = WEEKDAYS[d.getUTCDay()];
      el.statNext.textContent =
        stats.nextWindow.source === 'forecast'
          ? `${day} ${pad(d.getUTCHours())}:00 UT — KP ${stats.nextWindow.kp.toFixed(1)}`
          : `${day} ${utcDate(stats.nextWindow.tMs).slice(5)} — KP ${stats.nextWindow.kp.toFixed(0)} (27-DAY OUTLOOK)`;
    } else {
      el.statNext.textContent =
        deps.provider.forecast3d || deps.provider.outlook27d ? 'NONE IN NEXT 27 DAYS' : 'FORECAST UNAVAILABLE';
    }
  }

  // ------------------------------------------------------------ public

  return {
    update(tMs: number): void {
      const now = performance.now();
      if (now - lastUpdate < 1000) return; // 1 Hz is plenty; canvases also key-cache
      lastUpdate = now;
      updateHeadline(tMs);
      updateStrip(Date.now());
      updateWeek(Date.now());
      updateStats(Date.now());
    },
    setLocation(next: UserLocation): void {
      applyLocation(next, next.source !== 'url');
    },
    getLocation(): UserLocation {
      return loc;
    },
  };
}
