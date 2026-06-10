// Aurora renderer: a stack of instanced translucent sphere shells with a
// single additive shader. One draw call for the whole volume illusion.

import * as THREE from 'three';
import { geoToMag } from '../astro/geomag';
import type { AuroraState } from '../data/types';
import type { OvationGrid } from '../data/live';
import { auroraFragment, auroraVertex } from './auroraShaders';

const SHELL_COUNT = 12;

export class Aurora {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private ovationTex: THREE.DataTexture;
  /** master gain, exposed for the dev panel */
  gain = 1.0;

  constructor() {
    const geo = new THREE.SphereGeometry(1, 96, 64);
    const altitudes = new Float32Array(SHELL_COUNT);
    for (let i = 0; i < SHELL_COUNT; i++) altitudes[i] = i / (SHELL_COUNT - 1);
    geo.setAttribute('aAltitude', new THREE.InstancedBufferAttribute(altitudes, 1));

    this.ovationTex = new THREE.DataTexture(
      new Uint8Array(360 * 181),
      360,
      181,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.ovationTex.wrapS = THREE.RepeatWrapping;
    this.ovationTex.wrapT = THREE.ClampToEdgeWrapping;
    this.ovationTex.magFilter = THREE.LinearFilter;
    this.ovationTex.minFilter = THREE.LinearFilter;
    this.ovationTex.needsUpdate = true;

    this.uniforms = {
      uShellMin: { value: 1.018 },
      uShellMax: { value: 1.062 },
      uGeoToMag: { value: geoToMag },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
      uBoundaryLat: { value: 64 },
      uOvalWidth: { value: 6 },
      uIntensity: { value: 0.5 / SHELL_COUNT },
      uRedFraction: { value: 0 },
      uMidGlow: { value: 0 },
      uUseOvation: { value: 0 },
      uOvationTex: { value: this.ovationTex },
      uColGreen: { value: new THREE.Color('#23ff8e') },
      uColRed: { value: new THREE.Color('#ff2e55') },
      uColPurple: { value: new THREE.Color('#8d4dff') },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: auroraVertex,
      fragmentShader: auroraFragment,
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, SHELL_COUNT);
    this.mesh.frustumCulled = false; // instances share one unit-sphere geometry
    this.mesh.renderOrder = 2;
  }

  /** Push the per-frame aurora state into shader uniforms. */
  applyState(state: AuroraState): void {
    this.uniforms.uBoundaryLat.value = state.boundaryLatDeg;
    this.uniforms.uOvalWidth.value = state.ovalWidthDeg;
    // OVATION carries its own contrast in the grid values, so give it a floor —
    // a quiet real-time oval should still read clearly on the display
    const intensity = state.useOvation ? Math.max(state.intensity, 0.85) : state.intensity;
    this.uniforms.uIntensity.value = (intensity * 3.4 * this.gain) / SHELL_COUNT;
    this.uniforms.uRedFraction.value = state.redFraction;
    this.uniforms.uUseOvation.value = state.useOvation ? 1 : 0;
    // diffuse red glow ramps in once the oval pushes below ~45° mag lat
    const below = Math.max(0, 45 - state.boundaryLatDeg) / 25;
    this.uniforms.uMidGlow.value = Math.min(1, below) * Math.max(state.redFraction, 0.4);
  }

  setSunDir(dir: THREE.Vector3): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
  }

  /** Advance curtain animation; rate is clamped so high playback speeds still look organic. */
  advance(simDtMs: number, realDtMs: number): void {
    const simSec = simDtMs / 1000;
    const realSec = realDtMs / 1000;
    // curtains drift with sim time but never faster than ~40x real
    const dt = Math.sign(simSec) * Math.min(Math.abs(simSec), realSec * 40);
    this.uniforms.uTime.value += dt + realSec * 0.6; // small always-on shimmer
  }

  setOvation(grid: OvationGrid): void {
    (this.ovationTex.image.data as Uint8Array).set(grid.values);
    this.ovationTex.needsUpdate = true;
  }
}
