// Renderer, camera, controls, and the assembled scene graph.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { latLonToVec3 } from '../astro/geomag';
import { subsolarPoint } from '../astro/solar';
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

  constructor(canvas: HTMLCanvasElement, dayTex: THREE.Texture, nightTex: THREE.Texture) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
