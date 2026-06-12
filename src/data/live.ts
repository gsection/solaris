// Live NOAA SWPC data: OVATION aurora grid, 1-minute Kp, GOES X-ray flux,
// and the two text forecast products. SWPC JSON endpoints are CORS-enabled;
// text products fall back to the server's allowlisted proxy if direct fetch fails.

import { parse27DayOutlook, parse3DayForecast, type ForecastSeries } from './forecastText';

const SWPC = 'https://services.swpc.noaa.gov';

async function fetchTextWithProxyFallback(path: string): Promise<string> {
  try {
    const res = await fetch(`${SWPC}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    const res = await fetch(`/api/swpc-proxy?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
    return await res.text();
  }
}

export interface OvationGrid {
  observationMs: number;
  forecastMs: number;
  values: Uint8Array; // 360 x 181, index (lat+90)*360 + lon, value 0..255 (scaled from 0..100)
}

export async function fetchOvation(): Promise<OvationGrid> {
  const res = await fetch(`${SWPC}/json/ovation_aurora_latest.json`);
  if (!res.ok) throw new Error(`OVATION HTTP ${res.status}`);
  const json = await res.json();
  const values = new Uint8Array(360 * 181);
  for (const [lon, lat, v] of json.coordinates as [number, number, number][]) {
    const x = ((Math.round(lon) % 360) + 360) % 360;
    const y = Math.round(lat) + 90;
    if (y >= 0 && y <= 180) values[y * 360 + x] = Math.min(255, Math.round(v * 2.55));
  }
  return {
    observationMs: Date.parse(json['Observation Time']),
    forecastMs: Date.parse(json['Forecast Time']),
    values,
  };
}

export interface LiveKpSample { tMs: number; kp: number }

export async function fetchLiveKp(): Promise<LiveKpSample[]> {
  const res = await fetch(`${SWPC}/json/planetary_k_index_1m.json`);
  if (!res.ok) throw new Error(`Kp HTTP ${res.status}`);
  const json = (await res.json()) as { time_tag: string; estimated_kp: number }[];
  const samples = json.map((r) => ({ tMs: Date.parse(r.time_tag + (r.time_tag.endsWith('Z') ? '' : 'Z')), kp: r.estimated_kp }));
  // NOAA publishes 0 placeholders for the newest minute(s) before the estimate
  // lands; a real estimate can't step to exactly 0, so trim trailing zeros
  // (a genuinely quiet feed loses nothing — its neighbours are ~0 anyway)
  if (samples.some((s) => s.kp > 0)) {
    while (samples.length > 0 && samples[samples.length - 1].kp === 0) samples.pop();
  }
  return samples;
}

export interface XraySample { tMs: number; flux: number }

export async function fetchXray(): Promise<XraySample[]> {
  const res = await fetch(`${SWPC}/json/goes/primary/xrays-1-day.json`);
  if (!res.ok) throw new Error(`X-ray HTTP ${res.status}`);
  const json = (await res.json()) as { time_tag: string; flux: number; energy: string }[];
  return json
    .filter((r) => r.energy === '0.1-0.8nm') // the long band defines flare class
    .map((r) => ({ tMs: Date.parse(r.time_tag), flux: r.flux }));
}

export async function fetch3DayForecast(): Promise<ForecastSeries | null> {
  try {
    return parse3DayForecast(await fetchTextWithProxyFallback('/text/3-day-geomag-forecast.txt'));
  } catch {
    return null;
  }
}

export async function fetch27DayOutlook(): Promise<ForecastSeries | null> {
  try {
    return parse27DayOutlook(await fetchTextWithProxyFallback('/text/27-day-outlook.txt'));
  } catch {
    return null;
  }
}
