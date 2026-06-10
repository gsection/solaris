// Parsers for NOAA SWPC fixed-format text products:
//   3-day geomagnetic forecast (8 × 3h Kp values per day, 3 days)
//   27-day outlook (daily largest expected Kp)

export interface ForecastSeries {
  startMs: number;
  stepMs: number;
  kp: number[];
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function issuedYear(text: string): number {
  const m = text.match(/:Issued: (\d{4})/);
  return m ? parseInt(m[1], 10) : new Date().getUTCFullYear();
}

/**
 * Parse 3-day-geomag-forecast.txt. Returns a 3-hourly Kp series covering 3 days.
 *
 *   NOAA Kp index forecast 11 Jun - 13 Jun
 *                Jun 11    Jun 12    Jun 13
 *   00-03UT        2.33      2.00      1.67
 *   ...
 */
export function parse3DayForecast(text: string): ForecastSeries | null {
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => /NOAA Kp index (forecast|breakdown)/i.test(l));
  if (headerIdx < 0) return null;

  const dateLine = lines[headerIdx + 1] ?? '';
  const dateMatches = [...dateLine.matchAll(/([A-Z][a-z]{2})\s+(\d{1,2})/g)];
  if (dateMatches.length < 1) return null;

  const year = issuedYear(text);
  const mon = MONTHS[dateMatches[0][1]];
  const day = parseInt(dateMatches[0][2], 10);
  if (mon === undefined) return null;
  let startMs = Date.UTC(year, mon, day);
  // year rollover: forecast issued late Dec for early Jan
  if (startMs < Date.now() - 200 * 86400000) startMs = Date.UTC(year + 1, mon, day);

  const nDays = dateMatches.length;
  const grid: number[][] = []; // [row 0..7][day 0..2]
  for (let r = 1; r <= 8; r++) {
    const line = lines[headerIdx + 1 + r] ?? '';
    const m = line.match(/^(\d{2})-(\d{2})UT(.*)$/);
    if (!m) break;
    const vals = [...m[3].matchAll(/(\d+(?:\.\d+)?)/g)].map((v) => parseFloat(v[1]));
    grid.push(vals.slice(0, nDays));
  }
  if (grid.length !== 8) return null;

  const kp: number[] = [];
  for (let d = 0; d < nDays; d++) {
    for (let r = 0; r < 8; r++) kp.push(grid[r][d] ?? NaN);
  }
  return { startMs, stepMs: 10800000, kp };
}

/**
 * Parse 27-day-outlook.txt. Returns a daily series of largest expected Kp.
 *   2026 Jun 09          155          8          3
 */
export function parse27DayOutlook(text: string): ForecastSeries | null {
  const rows: { ms: number; kp: number }[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!m) continue;
    const mon = MONTHS[m[2]];
    if (mon === undefined) continue;
    rows.push({ ms: Date.UTC(parseInt(m[1], 10), mon, parseInt(m[3], 10)), kp: parseInt(m[6], 10) });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.ms - b.ms);
  return { startMs: rows[0].ms, stepMs: 86400000, kp: rows.map((r) => r.kp) };
}

/** Sample a forecast series at time t (step interpolation); NaN outside range. */
export function forecastKpAt(f: ForecastSeries, tMs: number): number {
  const x = (tMs - f.startMs) / f.stepMs;
  if (x < 0 || x >= f.kp.length) return NaN;
  const v = f.kp[Math.floor(x)];
  return Number.isFinite(v) ? v : NaN;
}
