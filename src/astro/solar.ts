// Low-precision solar position: subsolar point (lat/lon) for a given time.
// Standard formulas (Meeus, simplified) — accuracy ~0.3°, far beyond what the globe needs.

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export interface SubsolarPoint {
  latDeg: number; // declination of the sun
  lonDeg: number; // subsolar longitude, -180..180, east positive
}

export function subsolarPoint(timeMs: number): SubsolarPoint {
  const n = (timeMs - J2000_MS) / 86400000; // days since J2000

  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // ecliptic longitude

  const eps = (23.439 - 0.0000004 * n) * DEG; // obliquity
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));

  // equation of time (minutes), from the difference between mean and apparent sun
  let raDeg = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / DEG;
  raDeg = ((raDeg % 360) + 360) % 360;
  let eqTimeMin = 4 * (((L - raDeg + 540) % 360) - 180); // wrap to -180..180 then minutes

  const d = new Date(timeMs);
  const hoursUTC = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  let lon = -15 * (hoursUTC - 12 + eqTimeMin / 60);
  lon = ((lon + 540) % 360) - 180;

  return { latDeg: decl / DEG, lonDeg: lon };
}
