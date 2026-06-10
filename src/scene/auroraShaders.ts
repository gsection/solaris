// GLSL for the aurora shell stack. One material drives ~12 instanced sphere
// shells; the fragment shader renders either the parametric Kp-driven oval or
// the real OVATION grid, both modulated by domain-warped curtain noise.
// Noise is sampled in the 3D magnetic frame (not lon/lat) to avoid seam artifacts.

export const auroraVertex = /* glsl */ `
attribute float aAltitude;
varying vec3 vDir;
varying float vAlt;
uniform float uShellMin;
uniform float uShellMax;

void main() {
  vDir = normalize(position);
  vAlt = aAltitude;
  vec3 p = position * mix(uShellMin, uShellMax, aAltitude);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const auroraFragment = /* glsl */ `
precision highp float;

varying vec3 vDir;
varying float vAlt;

uniform mat3 uGeoToMag;
uniform vec3 uSunDir;
uniform float uTime;          // animation seconds (already speed-clamped on CPU)
uniform float uBoundaryLat;   // equatorward oval edge, magnetic deg
uniform float uOvalWidth;     // deg
uniform float uIntensity;     // overall gain (pre-divided by shell count)
uniform float uRedFraction;   // 0 green -> 1 storm red
uniform float uMidGlow;       // extra mid-latitude red glow (super-storms)
uniform float uUseOvation;    // 0/1
uniform sampler2D uOvationTex;
uniform vec3 uColGreen;
uniform vec3 uColRed;
uniform vec3 uColPurple;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.13 + vec3(7.7);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 m = uGeoToMag * d;                                  // magnetic frame: z = dipole axis
  float magLat = degrees(asin(clamp(m.z, -1.0, 1.0)));
  float absLat = abs(magLat);

  // ---- band profile ----
  float band;
  if (uUseOvation > 0.5) {
    float geoLat = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float geoLon = degrees(atan(-d.z, d.x));               // -180..180, 0 = Greenwich
    float u = fract(geoLon / 360.0);
    float v = clamp((geoLat + 90.0 + 0.5) / 181.0, 0.0, 1.0);
    float val = texture2D(uOvationTex, vec2(u, v)).r;      // 0..1 ~ probability %
    band = smoothstep(0.02, 0.22, val) * 2.1;
  } else {
    float center = uBoundaryLat + uOvalWidth * 0.5;
    float dist = absLat - center;                          // <0: equatorward of center
    float halfW = max(uOvalWidth * 0.5, 0.75);
    band = dist < 0.0
      ? exp(-pow(abs(dist) / (halfW * 0.55), 2.0))         // hard equatorward edge
      : exp(-pow(dist / (halfW * 1.5), 2.0));              // diffuse poleward
  }

  // ---- night-side weighting (kept generous: this is a display, not a photo) ----
  float sunDot = dot(d, uSunDir);
  float night = mix(0.34, 1.0, smoothstep(0.25, -0.25, sunDot));

  // ---- curtain structure: domain-warped noise in the magnetic frame ----
  float t = uTime;
  float bands = fbm(vec3(m.xy * 5.0, m.z * 9.0) + vec3(t * 0.011, -t * 0.007, t * 0.004));
  float warp = bands * 2.0 - 1.0;
  // rays: high frequency azimuthally, stretched along magnetic latitude
  float rays = vnoise(vec3(m.xy * (52.0 + warp * 6.0), m.z * 5.0) + vec3(0.0, 0.0, t * 0.015));
  rays = pow(0.45 + 0.55 * rays, 3.0);
  float curtain = (0.30 + 0.85 * bands) * (0.35 + 0.85 * rays);

  // ---- altitude ramp: brightest at the lower edge ----
  float altFall = pow(1.0 - vAlt * 0.78, 1.6);

  // ---- grazing-angle attenuation: shells stack up edge-on; keep limb views from clipping ----
  vec3 viewDir = normalize(cameraPosition - vDir * 1.04);
  float facing = abs(dot(viewDir, d));
  float grazeFade = mix(0.5, 1.0, smoothstep(0.0, 0.5, facing));

  // ---- color: green base stays green; red/purple climbs in with altitude + storms ----
  float ramp = clamp(vAlt * (1.05 + uRedFraction * 0.85) - 0.06 + uRedFraction * 0.22, 0.0, 1.0);
  vec3 topCol = mix(uColRed, uColPurple, 0.40 - uRedFraction * 0.25);
  vec3 col = mix(uColGreen, topCol, ramp);

  float a = band * night * curtain * altFall * grazeFade * uIntensity;

  // ---- mid-latitude diffuse red glow (Carrington blood-red skies) ----
  if (uMidGlow > 0.001) {
    float midCenter = max(uBoundaryLat - 14.0, 10.0);
    float mid = exp(-pow((absLat - midCenter) / 16.0, 2.0));
    float bg = 0.55 + 0.45 * bands;
    a += uMidGlow * mid * night * altFall * uIntensity * 0.35 * bg;
    col = mix(col, uColRed, clamp(uMidGlow * (1.0 - band) * 0.85, 0.0, 1.0));
  }

  gl_FragColor = vec4(col * a, 1.0);
}
`;
