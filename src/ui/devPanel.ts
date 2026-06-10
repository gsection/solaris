// lil-gui tuning panel, only mounted with ?dev=1. Exposes aurora uniforms and
// a manual Kp override so the shader can be art-directed without data wiring.

import GUI from 'lil-gui';
import type { Aurora } from '../scene/Aurora';

export interface DevState {
  kpOverride: number; // -1 = off
  boundaryOverride: number; // -1 = off
}

export const devState: DevState = { kpOverride: -1, boundaryOverride: -1 };

export function mountDevPanel(aurora: Aurora): void {
  const params = new URLSearchParams(location.search);
  // ?kp=7 forces a Kp for visual testing without the gui
  const kpParam = params.get('kp');
  if (kpParam !== null) devState.kpOverride = parseFloat(kpParam);

  if (!params.has('dev')) return;

  const gui = new GUI({ title: 'AURORA TUNING' });
  gui.add(devState, 'kpOverride', -1, 9.5, 0.1).name('Kp override (-1 off)');
  gui.add(devState, 'boundaryOverride', -1, 67, 0.5).name('boundary override');
  gui.add(aurora, 'gain', 0, 4, 0.05).name('master gain');
  gui.add(aurora.uniforms.uShellMin, 'value', 1.0, 1.05, 0.001).name('shell min R');
  gui.add(aurora.uniforms.uShellMax, 'value', 1.02, 1.15, 0.001).name('shell max R');
  gui.addColor(aurora.uniforms.uColGreen, 'value').name('green');
  gui.addColor(aurora.uniforms.uColRed, 'value').name('red');
  gui.addColor(aurora.uniforms.uColPurple, 'value').name('purple');
}
