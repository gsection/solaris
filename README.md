# SOLARIS — Aurora Now

**Will you see the aurora tonight?** SOLARIS opens on a live dashboard for *your location*:
the chance of aurora right now, the best window in the next 24 hours, the outlook for the
week, when you last could have seen it, and the strongest display on record overhead — all
rendered above a 3D Earth with real-time auroras. Behind a single **EXPLORE** toggle sits the
full space-weather console: a 170-year timeline driven by **real historical data
(2010 → today)**, **live NOAA feeds**, official forecasts, a deterministic synthetic
far-future, and replayable **legendary storm scenarios** (Carrington 1859, the 1921 Railroad
Storm, Québec 1989, Halloween 2003, Gannon 2024), each of which can also be launched as a
*"what if it struck right now"* simulation.

Live at **https://solaris.gsection.com**

![Solaris](docs/screenshot.png)

## NOW mode (default)

The app boots pinned to wall-clock time, camera eased onto your location (browser
geolocation with a one-time prompt; falls back to manual entry via the **⌖ location chip**,
default Cambridge UK; persisted in localStorage; `?loc=lat,lon,label` overrides):

- **Verdict** — NONE / LOW / FAIR / GOOD / HIGH chance of seeing aurora from where you stand,
  derived from the live Kp index vs the Kp your *magnetic* latitude needs (shown as
  `NEED x.x HORIZON · y.y OVERHEAD`), the fresh OVATION nowcast probability (upgrade-only),
  and darkness — in daylight it tells you when it next gets dark and what the verdict would
  be ("DAYLIGHT — NEXT DARK 22:30 — GOOD ONCE DARK"), and at high latitudes it knows about
  the midnight sun.
- **Next 24 h strip** — the NOAA 3-day forecast's 3-hourly Kp as verdict-coloured blocks over
  a darkness/daylight backdrop, local-time labelled, with the best viewing window bracketed.
- **Next 7 days** — daily bars (days 1–3 from the 3-day forecast, 4–7 from the 27-day
  outlook), each coloured by the verdict at your location.
- **This location's record** — when aurora was last plausibly visible from your spot
  (Kp ≥ your horizon threshold *and* dark), the strongest event since 2010 (for the UK that's
  the May 2024 Gannon G5), and the next predicted visible window out to 27 days.
- Compact live Kp gauge, GOES X-ray flux and active-flare readouts.

## EXPLORE mode

The original console, one click away:

- **Timeline** scrubber with per-pixel Kp heat-strip and flare tick marks (C/M/X), wheel-zoom
  from 170 years down to hours, drag to scrub, play/pause at speeds from real-time to a week
  per second.
- **3D globe** with day/night terminator computed from the simulated time, NASA Blue Marble +
  city-lights textures, atmospheric rim glow, starfield.
- **Auroras** as a stack of 12 instanced additive shader shells: a parametric auroral oval in
  *magnetic* coordinates whose equatorward boundary, width, intensity and colour follow the Kp
  index (green 557.7 nm base climbing to red/purple, storm-red takeover above Kp 5, diffuse
  mid-latitude "blood-red skies" for Carrington-class events). Within ±45 min of wall-clock now
  it switches to the **real NOAA OVATION model grid**.
- **HUD**: Kp gauge with G-scale storm labels, GOES X-ray flux readout + 6 h trace
  (live data near now, synthesized from flare records elsewhere), active flare list, event log,
  solar-cycle sparkline (observed + predicted SSN), scenario launcher.

Returning to NOW deactivates any armed scenario and re-pins the clock to the present.

## Mobile mode

On touch devices with phone-sized screens the panels collapse into a tabbed bottom sheet —
**NOW / WEEK / DATA / EXPLORE** — opening on the verdict. The EXPLORE tab switches the whole
app into explorer mode (timeline + touch-sized transport, two-finger pinch-zoom, one finger
scrubs); the other tabs pin it back to the present. Render pixel ratio is capped at 1.5 for
phone GPUs.

## Data sources

| Layer | Source | Access |
|---|---|---|
| Kp 2010→snapshot | GFZ Potsdam definitive + nowcast | baked by `scripts/fetch-archive.mjs` |
| Solar flares 2010→snapshot | NASA DONKI FLR | baked (6-month chunks, resume cache) |
| Solar cycle SSN obs + prediction | NOAA SWPC | baked |
| Kp/flares snapshot→now | GFZ / DONKI | `/api/*` server proxy, 3 h disk cache |
| Live Kp (1-min), GOES X-ray, OVATION aurora grid | NOAA SWPC | direct browser fetch (CORS-enabled) |
| 3-day geomag forecast, 27-day outlook | NOAA SWPC text products | direct fetch, `/api/swpc-proxy` fallback |
| Beyond +27 days | deterministic synthetic generator seeded per 27-day solar rotation, rates scaled by predicted SSN | client-side |

Scenario time-series are hand-authored from literature estimates (Dst, reconstructed boundary
latitudes). Synthetic and scenario data are always badged **SIMULATION** in the UI.

The local verdict uses the same oval boundary model as the renderer
(boundary ≈ 66.5° − 2.0·Kp magnetic latitude, +5° horizon-visibility allowance, dark =
sun below −8°), so what the dashboard says matches what the globe shows.

## URL parameters

- `?loc=52.2,0.1,CAMBRIDGE` — set the dashboard location (lat, lon, optional label)
- `?explore` — boot straight into explorer mode
- `?t=2024-05-10T23:00:00Z` — start at a moment in time (implies explore; try the Gannon storm!)
- `?scenario=carrington-1859` — arm a scenario at its historical date (`&now=1` anchors it at now).
  IDs: `carrington-1859`, `railroad-1921`, `quebec-1989`, `halloween-2003`, `gannon-2024`
- `?cam=lat,lon,distance` — initial camera, e.g. `?cam=78,-60,3.2`
- `?kp=7` — force a Kp value (drives the visuals *and* the dashboard verdict)
- `?dev=1` — aurora tuning panel

## Development

```bash
npm install
npm run fetch-archive   # refresh baked data (DONKI + GFZ + solar cycle)
npm run fetch-textures  # one-time NASA texture download
npm run dev             # Vite dev server (proxies /api to :8080)
npm run build           # type-check + production bundle
npm run serve           # production server on :8080 (static + /api proxy-cache)
```

The production server (`server/index.mjs`) is dependency-free Node 24: it serves `dist/` and
caches the GFZ/DONKI gap-extension queries on disk (`server/cache/`), serving stale data if
upstreams are down.

## Deployment

Docker (see `Dockerfile` + `deploy/docker-compose.yml`): two-stage node:24-alpine build,
container `solaris-app` on the external `web` network behind the Caddy gateway at
`solaris.gsection.com`. Deployed with the standard `deploy.ps1 solaris` flow.
