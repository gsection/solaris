// Sun glow sprite positioned along the sun direction; flares make it pulse.

import * as THREE from 'three';
import type { FlareEvent } from '../data/types';
import { flareFlux } from '../data/types';

function makeGlowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.12, 'rgba(255,240,200,0.9)');
  g.addColorStop(0.35, 'rgba(255,190,90,0.32)');
  g.addColorStop(0.7, 'rgba(255,140,40,0.08)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SunFx {
  readonly sprite: THREE.Sprite;
  private baseScale = 7;

  constructor() {
    const mat = new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.renderOrder = -1;
  }

  /** Place the sun far along the sun direction; pulse during active flares. */
  update(sunDir: THREE.Vector3, simTimeMs: number, activeFlares: FlareEvent[]): void {
    this.sprite.position.copy(sunDir).multiplyScalar(50);

    let boost = 0;
    for (const f of activeFlares) {
      if (simTimeMs < f.beginMs || simTimeMs > f.endMs) continue;
      const flux = flareFlux(f.cls, f.mag);
      const mag = Math.max(0, Math.log10(flux / 1e-6)); // C1 = 0 .. X10 = 3
      const t =
        simTimeMs < f.peakMs
          ? (simTimeMs - f.beginMs) / Math.max(1, f.peakMs - f.beginMs)
          : 1 - (simTimeMs - f.peakMs) / Math.max(1, f.endMs - f.peakMs);
      boost = Math.max(boost, mag * Math.max(0, t));
    }
    const s = this.baseScale * (1 + boost * 0.55);
    this.sprite.scale.set(s, s, 1);
    (this.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.8 + boost * 0.2);
  }
}
