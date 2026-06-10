// Fresnel rim glow: back-side sphere slightly larger than the Earth.

import * as THREE from 'three';

const vertex = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
varying vec3 vNormal;
void main() {
  float intensity = pow(0.66 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
  gl_FragColor = vec4(vec3(0.18, 0.55, 0.85) * intensity, 1.0);
}
`;

export function createAtmosphere(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 48), mat);
  mesh.renderOrder = 1;
  return mesh;
}
