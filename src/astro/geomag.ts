// Geographic <-> geomagnetic coordinates, and the lat/lon -> world-vector convention.
//
// World-space convention (matches a default three.js SphereGeometry with an
// equirectangular Earth texture, globe unrotated at the origin):
//   lat 0, lon 0 (Greenwich/equator) -> +X
//   lat 0, lon 90E                   -> -Z
//   north pole                       -> +Y
// So: v = (cos(lat)cos(lon), sin(lat), -cos(lat)sin(lon)), east-positive lon.

import * as THREE from 'three';

const DEG = Math.PI / 180;

export function latLonToVec3(latDeg: number, lonDeg: number, target = new THREE.Vector3()): THREE.Vector3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return target.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

// IGRF-13 geomagnetic (dipole) north pole, epoch ~2025.
export const GEOMAG_POLE_LAT = 80.8;
export const GEOMAG_POLE_LON = -72.7;

/** Unit vector of the geomagnetic dipole axis (north). */
export const dipoleAxis = latLonToVec3(GEOMAG_POLE_LAT, GEOMAG_POLE_LON).normalize();

/**
 * Rotation matrix taking geographic world vectors into the magnetic frame:
 * row Z = dipole axis, rows X/Y span the magnetic equator. In the magnetic frame
 * magLat = asin(z), magLon = atan2(y, x).
 */
export const geoToMag: THREE.Matrix3 = (() => {
  const z = dipoleAxis.clone();
  // pick a reference X axis perpendicular to the dipole, deterministic
  const x = new THREE.Vector3(1, 0, 0).sub(z.clone().multiplyScalar(z.x)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix3();
  m.set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
  return m;
})();

/** Magnetic latitude (degrees) of a geographic lat/lon — used for CPU-side checks. */
export function magneticLatDeg(latDeg: number, lonDeg: number): number {
  const v = latLonToVec3(latDeg, lonDeg);
  return Math.asin(THREE.MathUtils.clamp(v.dot(dipoleAxis), -1, 1)) / DEG;
}
