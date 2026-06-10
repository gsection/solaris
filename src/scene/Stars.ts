// Procedural starfield: two point clouds at slightly different sizes/tints.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng';

export function createStars(): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(0xa57e11);

  const make = (count: number, size: number, color: string, opacity: number) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // uniform on sphere
      const z = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const R = 60 + rng() * 20;
      positions[i * 3] = r * Math.cos(phi) * R;
      positions[i * 3 + 1] = z * R;
      positions[i * 3 + 2] = r * Math.sin(phi) * R;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size,
      sizeAttenuation: false,
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  };

  group.add(make(4200, 1.1, '#cfe9ff', 0.75));
  group.add(make(1400, 1.9, '#ffffff', 0.9));
  group.add(make(450, 2.6, '#ffd9b0', 0.8));
  return group;
}
