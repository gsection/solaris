// Renderer, camera, controls, and the assembled scene graph.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLonToVec3 } from '../astro/geomag';
import { subsolarPoint } from '../astro/solar';
import { isMobileDevice } from '../ui/mobile';
import { Aurora } from './Aurora';
import { createAtmosphere } from './Atmosphere';
import { Earth } from './Earth';
import { createStars } from './Stars';
import { SunFx } from './SunFx';

export class SceneRoot {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly earth: Earth;
  readonly aurora: Aurora;
  readonly sunFx: SunFx;
  private sunDir = new THREE.Vector3(1, 0, 0);
  private marker: THREE.Sprite | null = null;
  private focusTarget: THREE.Vector3 | null = null;

  constructor(canvas: HTMLCanvasElement, dayTex: THREE.Texture, nightTex: THREE.Texture) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // phone GPUs at DPR 3 can't hold 60 fps on the 12-shell aurora stack
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobileDevice() ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#000208');

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
    // open over the North Atlantic with both auroral ovals' home turf in view;
    // ?cam=lat,lon,dist overrides (testing / shareable views)
    const camParam = new URLSearchParams(location.search).get('cam');
    if (camParam) {
      const [lat, lon, dist] = camParam.split(',').map(Number);
      latLonToVec3(lat || 0, lon || 0, this.camera.position).multiplyScalar(dist || 3.4);
    } else {
      this.camera.position.set(1.4, 1.9, 2.6);
    }

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.45;
    this.controls.maxDistance = 12;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.45;

    this.earth = new Earth(dayTex, nightTex);
    this.aurora = new Aurora();
    this.sunFx = new SunFx();

    this.scene.add(createStars());
    this.scene.add(this.earth.mesh);
    this.scene.add(createAtmosphere());
    this.scene.add(this.aurora.mesh);
    this.scene.add(this.sunFx.sprite);

    window.addEventListener('resize', () => this.onResize());
    // user grabbing the globe cancels any in-flight camera focus animation
    this.controls.addEventListener('start', () => {
      this.focusTarget = null;
    });
  }

  /** Place (or move) the user-location marker on the globe surface. */
  setLocationMarker(latDeg: number, lonDeg: number): void {
    if (!this.marker) {
      const size = 64;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(234,255,255,1)');
      grad.addColorStop(0.25, 'rgba(0,229,255,0.9)');
      grad.addColorStop(0.6, 'rgba(0,229,255,0.25)');
      grad.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      this.marker = new THREE.Sprite(mat);
      this.marker.scale.setScalar(0.05);
      this.marker.renderOrder = 3;
      this.scene.add(this.marker);
    }
    latLonToVec3(latDeg, lonDeg, this.marker.position).multiplyScalar(1.012);
  }

  /**
   * Ease the camera to frame a location. Pass a signed tiltDeg (+ for NH, − for
   * SH) to sit equatorward of the spot looking poleward, putting the auroral
   * oval in frame above it.
   */
  focusOnLatLon(latDeg: number, lonDeg: number, opts?: { tiltDeg?: number; distance?: number }): void {
    const tilt = opts?.tiltDeg ?? 18;
    const aimLat = THREE.MathUtils.clamp(latDeg + tilt, -80, 80);
    this.focusTarget = latLonToVec3(aimLat, lonDeg).multiplyScalar(opts?.distance ?? 2.9);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Update sun direction from simulated time and propagate to shaders. */
  setSimTime(timeMs: number): void {
    const sp = subsolarPoint(timeMs);
    latLonToVec3(sp.latDeg, sp.lonDeg, this.sunDir);
    this.earth.setSunDir(this.sunDir);
    this.aurora.setSunDir(this.sunDir);
  }

  getSunDir(): THREE.Vector3 {
    return this.sunDir;
  }

  render(): void {
    if (this.focusTarget) {
      this.camera.position.lerp(this.focusTarget, 0.05);
      if (this.camera.position.distanceTo(this.focusTarget) < 0.01) this.focusTarget = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
