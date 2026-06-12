// User location: geolocation with manual fallback, persisted in localStorage.
// Place-name resolution is fully offline — a small built-in gazetteer plus
// free-text lat/lon parsing — so no API keys or external geocoders.

export interface UserLocation {
  latDeg: number;
  lonDeg: number;
  label: string;
  source: 'geo' | 'manual' | 'default' | 'url';
}

export const DEFAULT_LOCATION: UserLocation = {
  latDeg: 52.205,
  lonDeg: 0.119,
  label: 'CAMBRIDGE UK',
  source: 'default',
};

const STORAGE_KEY = 'solaris.location.v1';

// Aurora-relevant towns + major cities, for suggestions and reverse labels.
export const PLACES: ReadonlyArray<{ name: string; latDeg: number; lonDeg: number }> = [
  { name: 'Cambridge UK', latDeg: 52.205, lonDeg: 0.119 },
  { name: 'London', latDeg: 51.507, lonDeg: -0.128 },
  { name: 'Edinburgh', latDeg: 55.953, lonDeg: -3.189 },
  { name: 'Inverness', latDeg: 57.478, lonDeg: -4.226 },
  { name: 'Shetland', latDeg: 60.155, lonDeg: -1.145 },
  { name: 'Dublin', latDeg: 53.349, lonDeg: -6.26 },
  { name: 'Reykjavik', latDeg: 64.147, lonDeg: -21.942 },
  { name: 'Tromsø', latDeg: 69.649, lonDeg: 18.956 },
  { name: 'Oslo', latDeg: 59.913, lonDeg: 10.752 },
  { name: 'Bergen', latDeg: 60.393, lonDeg: 5.324 },
  { name: 'Stockholm', latDeg: 59.329, lonDeg: 18.069 },
  { name: 'Kiruna', latDeg: 67.856, lonDeg: 20.226 },
  { name: 'Helsinki', latDeg: 60.17, lonDeg: 24.938 },
  { name: 'Rovaniemi', latDeg: 66.503, lonDeg: 25.727 },
  { name: 'Copenhagen', latDeg: 55.676, lonDeg: 12.568 },
  { name: 'Amsterdam', latDeg: 52.367, lonDeg: 4.904 },
  { name: 'Berlin', latDeg: 52.52, lonDeg: 13.405 },
  { name: 'Paris', latDeg: 48.857, lonDeg: 2.352 },
  { name: 'Madrid', latDeg: 40.417, lonDeg: -3.703 },
  { name: 'Rome', latDeg: 41.903, lonDeg: 12.496 },
  { name: 'Warsaw', latDeg: 52.23, lonDeg: 21.012 },
  { name: 'Moscow', latDeg: 55.756, lonDeg: 37.617 },
  { name: 'Murmansk', latDeg: 68.97, lonDeg: 33.075 },
  { name: 'Fairbanks', latDeg: 64.838, lonDeg: -147.716 },
  { name: 'Anchorage', latDeg: 61.218, lonDeg: -149.9 },
  { name: 'Yellowknife', latDeg: 62.454, lonDeg: -114.372 },
  { name: 'Whitehorse', latDeg: 60.721, lonDeg: -135.057 },
  { name: 'Churchill', latDeg: 58.768, lonDeg: -94.165 },
  { name: 'Calgary', latDeg: 51.045, lonDeg: -114.057 },
  { name: 'Edmonton', latDeg: 53.546, lonDeg: -113.494 },
  { name: 'Vancouver', latDeg: 49.283, lonDeg: -123.121 },
  { name: 'Winnipeg', latDeg: 49.895, lonDeg: -97.138 },
  { name: 'Toronto', latDeg: 43.653, lonDeg: -79.383 },
  { name: 'Montreal', latDeg: 45.502, lonDeg: -73.567 },
  { name: 'Halifax', latDeg: 44.649, lonDeg: -63.575 },
  { name: 'Nuuk', latDeg: 64.181, lonDeg: -51.694 },
  { name: 'Seattle', latDeg: 47.606, lonDeg: -122.332 },
  { name: 'Minneapolis', latDeg: 44.978, lonDeg: -93.265 },
  { name: 'Chicago', latDeg: 41.878, lonDeg: -87.63 },
  { name: 'Boston', latDeg: 42.36, lonDeg: -71.059 },
  { name: 'New York', latDeg: 40.713, lonDeg: -74.006 },
  { name: 'Denver', latDeg: 39.739, lonDeg: -104.99 },
  { name: 'San Francisco', latDeg: 37.775, lonDeg: -122.419 },
  { name: 'Los Angeles', latDeg: 34.052, lonDeg: -118.244 },
  { name: 'Tokyo', latDeg: 35.677, lonDeg: 139.65 },
  { name: 'Sapporo', latDeg: 43.062, lonDeg: 141.354 },
  { name: 'Beijing', latDeg: 39.904, lonDeg: 116.407 },
  { name: 'Singapore', latDeg: 1.352, lonDeg: 103.82 },
  { name: 'Sydney', latDeg: -33.869, lonDeg: 151.209 },
  { name: 'Melbourne', latDeg: -37.814, lonDeg: 144.963 },
  { name: 'Hobart', latDeg: -42.882, lonDeg: 147.327 },
  { name: 'Auckland', latDeg: -36.849, lonDeg: 174.764 },
  { name: 'Christchurch', latDeg: -43.532, lonDeg: 172.636 },
  { name: 'Dunedin', latDeg: -45.879, lonDeg: 170.503 },
  { name: 'Invercargill', latDeg: -46.413, lonDeg: 168.353 },
  { name: 'Ushuaia', latDeg: -54.802, lonDeg: -68.303 },
  { name: 'Punta Arenas', latDeg: -53.164, lonDeg: -70.917 },
  { name: 'Cape Town', latDeg: -33.925, lonDeg: 18.424 },
];

export function formatCoords(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(1)}°${latDeg >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(lonDeg).toFixed(1)}°${lonDeg >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

/** Great-circle distance in km (haversine). */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const DEG = Math.PI / 180;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest gazetteer name within ~150 km, else formatted coordinates. */
export function nearestPlaceLabel(latDeg: number, lonDeg: number): string {
  let best: { name: string; d: number } | null = null;
  for (const p of PLACES) {
    const d = distanceKm(latDeg, lonDeg, p.latDeg, p.lonDeg);
    if (!best || d < best.d) best = { name: p.name, d };
  }
  return best && best.d <= 150 ? best.name.toUpperCase() : formatCoords(latDeg, lonDeg);
}

export function loadStoredLocation(): UserLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as UserLocation;
    if (typeof obj.latDeg !== 'number' || typeof obj.lonDeg !== 'number') return null;
    return obj;
  } catch {
    return null;
  }
}

export function saveLocation(loc: UserLocation): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
  } catch {
    /* private mode etc. — non-fatal */
  }
}

/** ?loc=lat,lon[,label] — for testing and shareable local views. */
export function locationFromUrl(): UserLocation | null {
  const param = new URLSearchParams(location.search).get('loc');
  if (!param) return null;
  const parts = param.split(',');
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const label = parts[2]?.trim() || nearestPlaceLabel(lat, lon);
  return { latDeg: lat, lonDeg: lon, label: label.toUpperCase(), source: 'url' };
}

export function requestGeolocation(timeoutMs = 8000): Promise<UserLocation | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        resolve({
          latDeg: latitude,
          lonDeg: longitude,
          label: nearestPlaceLabel(latitude, longitude),
          source: 'geo',
        });
      },
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 600000 },
    );
  });
}

/**
 * Parse free-text location input. Tries, in order:
 *   "52.2, 0.1" / "52.2 0.1"  decimal lat/lon
 *   "52.2N 0.1E"              hemisphere-suffixed
 *   substring match against PLACES
 */
export function parseLocationInput(text: string): UserLocation | null {
  const t = text.trim();
  if (!t) return null;

  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { latDeg: lat, lonDeg: lon, label: nearestPlaceLabel(lat, lon), source: 'manual' };
    }
  }

  m = t.match(/^(\d+(?:\.\d+)?)\s*°?\s*([NS])\s*[, ]?\s*(\d+(?:\.\d+)?)\s*°?\s*([EW])$/i);
  if (m) {
    const lat = parseFloat(m[1]) * (m[2].toUpperCase() === 'N' ? 1 : -1);
    const lon = parseFloat(m[3]) * (m[4].toUpperCase() === 'E' ? 1 : -1);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { latDeg: lat, lonDeg: lon, label: nearestPlaceLabel(lat, lon), source: 'manual' };
    }
  }

  const hit = PLACES.find((p) => fold(p.name).includes(fold(t)));
  if (hit) {
    return { latDeg: hit.latDeg, lonDeg: hit.lonDeg, label: hit.name.toUpperCase(), source: 'manual' };
  }
  return null;
}

/** Case- and diacritic-insensitive ("tromso" must match "Tromsø"). */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .toLowerCase();
}

/** Gazetteer suggestions for a partial input (for the location popover). */
export function suggestPlaces(text: string, max = 6): typeof PLACES[number][] {
  const needle = fold(text.trim());
  if (!needle) return [];
  return PLACES.filter((p) => fold(p.name).includes(needle)).slice(0, max);
}
