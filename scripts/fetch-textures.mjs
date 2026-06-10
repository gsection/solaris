// Downloads public-domain NASA Earth textures into public/textures/.
// Run once; outputs are committed. Falls back to three.js repo textures if NASA URLs move.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'textures');

const TEXTURES = [
  {
    file: 'earth_day.jpg',
    urls: [
      'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg',
      'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
    ],
  },
  {
    file: 'earth_night.jpg',
    urls: [
      'https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg',
      'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_lights_2048.png',
    ],
  },
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

await mkdir(outDir, { recursive: true });

for (const tex of TEXTURES) {
  const dest = join(outDir, tex.file);
  if (await exists(dest)) {
    console.log(`skip ${tex.file} (exists)`);
    continue;
  }
  let done = false;
  for (const url of tex.urls) {
    try {
      console.log(`fetching ${url} ...`);
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 50_000) throw new Error(`suspiciously small (${buf.length} bytes)`);
      await writeFile(dest, buf);
      console.log(`wrote ${tex.file} (${(buf.length / 1e6).toFixed(1)} MB)`);
      done = true;
      break;
    } catch (err) {
      console.warn(`  failed: ${err.message}`);
    }
  }
  if (!done) {
    console.error(`ERROR: could not fetch ${tex.file} from any source`);
    process.exitCode = 1;
  }
}
