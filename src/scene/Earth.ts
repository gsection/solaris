// Earth globe with a day/night terminator shader mixing NASA Blue Marble and
// city-lights textures by sun direction.

import * as THREE from 'three';

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(position); // unrotated unit sphere: object == world space
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vNormal;
uniform sampler2D uDayTex;
uniform sampler2D uNightTex;
uniform vec3 uSunDir;

void main() {
  vec3 n = normalize(vNormal);
  float sunDot = dot(n, uSunDir);
  float k = smoothstep(-0.12, 0.12, sunDot);

  vec3 day = texture2D(uDayTex, vUv).rgb;
  float lambert = max(sunDot, 0.0);
  vec3 dayLit = day * (0.18 + 1.05 * lambert);

  vec3 lights = texture2D(uNightTex, vUv).rgb;
  vec3 night = lights * vec3(1.0, 0.82, 0.55) * 1.9 + vec3(0.012, 0.02, 0.035);

  vec3 col = mix(night, dayLit, k);

  // faint cyan limb tint to sell the sci-fi look
  float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition))), 3.0);
  col += vec3(0.05, 0.18, 0.25) * rim * 0.6;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Earth {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(dayTex: THREE.Texture, nightTex: THREE.Texture) {
    dayTex.colorSpace = THREE.SRGBColorSpace;
    nightTex.colorSpace = THREE.SRGBColorSpace;
    dayTex.anisotropy = 8;
    nightTex.anisotropy = 8;

    this.uniforms = {
      uDayTex: { value: dayTex },
      uNightTex: { value: nightTex },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: this.uniforms,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat);
    this.mesh.renderOrder = 0;
  }

  setSunDir(dir: THREE.Vector3): void {
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(dir);
  }
}
