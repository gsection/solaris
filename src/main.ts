import * as THREE from 'three';
import './styles/hud.css';
import { SimClock, SPEED_STEPS } from './core/SimClock';
import { loadArchive } from './data/archive';
import { KpProvider } from './data/KpProvider';
import {
  fetch27DayOutlook,
  fetch3DayForecast,
  fetchLiveKp,
  fetchOvation,
  fetchXray,
} from './data/live';
import { auroraFromKp } from './data/types';
import { SCENARIOS } from './data/scenarios';
import { SceneRoot } from './scene/SceneRoot';
import { devState, mountDevPanel } from './ui/devPanel';
import { resolveMode, updateBadge, updateClock } from './ui/hud';
import { buildScenarioButtons, logEvent, setLiveXray, updatePanels } from './ui/panels';
import { Timeline } from './ui/Timeline';

async function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, resolve, undefined, reject);
  });
}

async function boot(): Promise<void> {
  const [dayTex, nightTex, archive] = await Promise.all([
    loadTexture('/textures/earth_day.jpg'),
    loadTexture('/textures/earth_night.jpg'),
    loadArchive(),
  ]);

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const sceneRoot = new SceneRoot(canvas, dayTex, nightTex);
  // ?t=2024-05-10T22:00:00Z starts the sim at a given moment (testing/sharing)
  const tParam = new URLSearchParams(location.search).get('t');
  const startMs = tParam ? Date.parse(tParam) : Date.now();
  const clock = new SimClock(Number.isFinite(startMs) ? startMs : Date.now());
  const provider = new KpProvider(archive);
  const timeline = new Timeline(clock, provider);

  buildScenarioButtons(provider, clock, timeline);
  mountDevPanel(sceneRoot.aurora);

  // ---------------- playback controls ----------------
  const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
  const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
  const btnFwd = document.getElementById('btn-fwd') as HTMLButtonElement;
  const btnNow = document.getElementById('btn-now') as HTMLButtonElement;
  const speedSelect = document.getElementById('speed-select') as HTMLSelectElement;

  for (let i = 0; i < SPEED_STEPS.length; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = SPEED_STEPS[i].label;
    speedSelect.appendChild(opt);
  }
  speedSelect.value = String(clock.speedIndex);
  speedSelect.addEventListener('change', () => clock.setSpeedIndex(parseInt(speedSelect.value, 10)));
  btnPlay.addEventListener('click', () => {
    clock.setPlaying(!clock.playing);
    btnPlay.textContent = clock.playing ? '⏸' : '▶';
  });
  btnPlay.textContent = clock.playing ? '⏸' : '▶';
  btnBack.addEventListener('click', () => clock.step(-1));
  btnFwd.addEventListener('click', () => clock.step(1));
  btnNow.addEventListener('click', () => {
    clock.setTime(Date.now());
    timeline.focus(Date.now() - 5 * 86400000, Date.now() + 5 * 86400000);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      btnPlay.click();
    }
  });

  // ---------------- live data ----------------
  const refreshForecasts = async () => {
    const [f3, f27] = await Promise.all([fetch3DayForecast(), fetch27DayOutlook()]);
    if (f3) provider.forecast3d = f3;
    if (f27) provider.outlook27d = f27;
    timeline.markDirty();
  };
  const refreshOvation = async () => {
    try {
      const grid = await fetchOvation();
      sceneRoot.aurora.setOvation(grid);
      provider.ovationReady = true;
    } catch {
      provider.ovationReady = false;
    }
  };
  const refreshFast = async () => {
    try {
      provider.liveKp = await fetchLiveKp();
    } catch { /* keep stale */ }
    try {
      setLiveXray(await fetchXray());
    } catch { /* keep stale */ }
  };

  refreshForecasts().catch(() => undefined);
  refreshOvation().catch(() => undefined);
  refreshFast().catch(() => undefined);
  setInterval(() => refreshOvation().catch(() => undefined), 5 * 60000);
  setInterval(() => refreshFast().catch(() => undefined), 60000);
  setInterval(() => refreshForecasts().catch(() => undefined), 6 * 3600000);

  // ?scenario=carrington-1859 activates a scenario at its historical date,
  // parked at peak drama (&now=1 anchors it at wall-clock now instead)
  const scenarioParam = new URLSearchParams(location.search).get('scenario');
  if (scenarioParam) {
    const atNow = new URLSearchParams(location.search).has('now');
    const sc = SCENARIOS.find((s) => s.id === scenarioParam);
    if (sc) {
      const anchor = atNow || !sc.historicalDateIso ? Date.now() : Date.parse(sc.historicalDateIso);
      provider.startScenario(sc.id, anchor);
      const peak = sc.points.reduce((a, b) => (b.kp >= a.kp ? b : a));
      clock.setTime(anchor + peak.h * 3600000);
      timeline.focus(anchor - 12 * 3600000, anchor + sc.durationH * 3600000);
    }
  }

  logEvent(clock.timeMs, 'SOLARIS ONLINE — TRACKING SOLAR ACTIVITY');
  logEvent(clock.timeMs, `ARCHIVE: ${archive.flares.length} FLARES / KP TO ${new Date(archive.snapshotEndMs).toISOString().slice(0, 10)}`);

  // ---------------- main loop ----------------
  let lastReal = performance.now();
  let lastSim = clock.timeMs;

  sceneRoot.renderer.setAnimationLoop(() => {
    const nowReal = performance.now();
    const realDt = Math.min(100, nowReal - lastReal);
    lastReal = nowReal;

    clock.tick(realDt);
    const t = clock.timeMs;

    let state = provider.auroraStateAt(t);
    if (devState.kpOverride >= 0) {
      state = auroraFromKp(devState.kpOverride, state.source);
      if (devState.boundaryOverride >= 0) state.boundaryLatDeg = devState.boundaryOverride;
      state.redFraction = Math.max(state.redFraction, devState.boundaryOverride >= 0 && devState.boundaryOverride < 40 ? 0.8 : state.redFraction);
    } else if (devState.boundaryOverride >= 0) {
      state.boundaryLatDeg = devState.boundaryOverride;
    }

    sceneRoot.setSimTime(t);
    sceneRoot.aurora.applyState(state);
    sceneRoot.aurora.advance(t - lastSim, realDt);
    lastSim = t;

    const activeFlares = provider.flaresIn(t - 6 * 3600000, t + 3600000);
    sceneRoot.sunFx.update(sceneRoot.getSunDir(), t, activeFlares);

    updateClock(t);
    updateBadge(resolveMode(t, state));
    updatePanels(t, provider, state, archive.cycle);

    if (clock.playing) timeline.followPlayhead();
    timeline.draw();

    sceneRoot.render();
  });
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('sim-clock');
  if (el) el.textContent = 'BOOT FAILURE — SEE CONSOLE';
});
