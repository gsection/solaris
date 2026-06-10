// The heart of the time engine: resolves any simulated time to a Kp value,
// an aurora state, and the set of flare events — across archive, live data,
// forecasts, the synthetic far future, and active scenarios.

import { archiveKpAt, ssnAt } from './archive';
import type { ForecastSeries } from './forecastText';
import { forecastKpAt } from './forecastText';
import { getScenario, scenarioStateAt, type Scenario } from './scenarios';
import { syntheticFlaresIn, syntheticKpAt } from './synthetic';
import {
  auroraFromKp,
  type ArchiveData,
  type AuroraSource,
  type AuroraState,
  type FlareEvent,
} from './types';
import type { LiveKpSample } from './live';

export interface ActiveScenario {
  scenario: Scenario;
  anchorMs: number; // sim time of hour-offset 0
}

export class KpProvider {
  forecast3d: ForecastSeries | null = null;
  outlook27d: ForecastSeries | null = null;
  liveKp: LiveKpSample[] = [];
  activeScenario: ActiveScenario | null = null;
  ovationReady = false;

  constructor(private archive: ArchiveData) {}

  get snapshotEndMs(): number {
    return this.archive.snapshotEndMs;
  }

  private ssnLookup = (tMs: number) => ssnAt(this.archive.cycle, tMs);

  kpAt(tMs: number): { kp: number; source: AuroraSource } {
    const sc = this.scenarioAt(tMs);
    if (sc) return { kp: sc.kp, source: 'scenario' };

    const nowMs = Date.now();

    if (tMs <= this.archive.snapshotEndMs) {
      const kp = archiveKpAt(this.archive.kp, tMs);
      if (Number.isFinite(kp)) return { kp, source: 'archive' };
      // pre-2010: quiet baseline (scenarios provide the drama back there)
      return { kp: 2, source: 'archive' };
    }

    // gap between snapshot end and now: live 1-min Kp if we have it
    if (tMs <= nowMs + 60000) {
      const kp = this.liveKpAt(tMs);
      if (Number.isFinite(kp)) return { kp, source: 'live' };
    }

    if (this.forecast3d) {
      const kp = forecastKpAt(this.forecast3d, tMs);
      if (Number.isFinite(kp)) return { kp, source: 'forecast' };
    }
    if (this.outlook27d) {
      const kp = forecastKpAt(this.outlook27d, tMs);
      if (Number.isFinite(kp)) return { kp, source: 'outlook' };
    }
    if (tMs <= nowMs) {
      // recent past with no live data yet: fall back to last archive sample
      const last = this.archive.kp.kp[this.archive.kp.kp.length - 1];
      return { kp: last >= 0 ? last : 2, source: 'archive' };
    }
    return { kp: syntheticKpAt(tMs, this.ssnLookup), source: 'synthetic' };
  }

  private liveKpAt(tMs: number): number {
    const samples = this.liveKp;
    if (samples.length === 0) return NaN;
    if (tMs < samples[0].tMs - 3600000 || tMs > samples[samples.length - 1].tMs + 3600000) return NaN;
    // nearest sample (1-min cadence, no need to interpolate)
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].tMs <= tMs) lo = mid;
      else hi = mid;
    }
    return Math.abs(samples[lo].tMs - tMs) < Math.abs(samples[hi].tMs - tMs) ? samples[lo].kp : samples[hi].kp;
  }

  private scenarioAt(tMs: number): { kp: number; boundaryLat?: number; red: number } | null {
    if (!this.activeScenario) return null;
    const h = (tMs - this.activeScenario.anchorMs) / 3600000;
    return scenarioStateAt(this.activeScenario.scenario, h);
  }

  auroraStateAt(tMs: number): AuroraState {
    const sc = this.scenarioAt(tMs);
    if (sc) {
      const st = auroraFromKp(sc.kp, 'scenario');
      if (sc.boundaryLat !== undefined) {
        st.boundaryLatDeg = sc.boundaryLat;
        // widen the oval as it pushes equatorward beyond the Kp formula's reach
        st.ovalWidthDeg = Math.max(st.ovalWidthDeg, (66.5 - sc.boundaryLat) * 0.35);
      }
      st.redFraction = Math.max(st.redFraction, sc.red);
      st.intensity *= 1 + sc.red * 0.5;
      return st;
    }

    const { kp, source } = this.kpAt(tMs);
    const st = auroraFromKp(kp, source);
    // use the real OVATION grid when the sim is within ±45 min of wall-clock now
    st.useOvation = this.ovationReady && Math.abs(tMs - Date.now()) < 45 * 60000;
    return st;
  }

  /** Flares overlapping [t0, t1], across archive + synthetic + scenario. */
  flaresIn(t0: number, t1: number): FlareEvent[] {
    const out: FlareEvent[] = [];
    const flares = this.archive.flares;
    // binary search for the first flare ending after t0
    let lo = 0;
    let hi = flares.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (flares[mid].beginMs < t0 - 6 * 3600000) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < flares.length && flares[i].beginMs <= t1; i++) {
      if (flares[i].endMs >= t0) out.push(flares[i]);
    }

    const synthStart = Math.max(t0, this.outlookEndMs());
    if (t1 > synthStart) {
      out.push(...syntheticFlaresIn(synthStart, t1, this.ssnLookup).filter((f) => f.endMs >= t0));
    }

    if (this.activeScenario) {
      const { scenario, anchorMs } = this.activeScenario;
      for (const f of scenario.flares) {
        const begin = anchorMs + f.h * 3600000;
        const peak = begin + 10 * 60000;
        const end = begin + 40 * 60000;
        if (end >= t0 && begin <= t1) {
          out.push({ beginMs: begin, peakMs: peak, endMs: end, cls: f.cls, mag: f.mag, scenario: scenario.id });
        }
      }
    }
    out.sort((a, b) => a.beginMs - b.beginMs);
    return out;
  }

  outlookEndMs(): number {
    if (this.outlook27d) {
      return this.outlook27d.startMs + this.outlook27d.kp.length * this.outlook27d.stepMs;
    }
    return Date.now() + 86400000;
  }

  startScenario(id: string, anchorMs: number): ActiveScenario | null {
    const scenario = getScenario(id);
    if (!scenario) return null;
    this.activeScenario = { scenario, anchorMs };
    return this.activeScenario;
  }

  clearScenario(): void {
    this.activeScenario = null;
  }
}
