// Canvas timeline scrubber: Kp heat-strip, flare tick marks, NOW marker,
// playhead. Drag to scrub, wheel to zoom (full 1859->2032 range down to hours),
// shift/middle-drag to pan.

import type { KpProvider } from '../data/KpProvider';
import type { SimClock } from '../core/SimClock';

const MIN_SPAN_MS = 3 * 3600000;
const MAX_START = Date.UTC(1855, 0, 1);
const MAX_END = Date.UTC(2033, 0, 1);

function kpColor(kp: number, alpha = 1): string {
  // green -> yellow -> orange -> red -> magenta
  const stops: [number, number, number, number][] = [
    [0, 30, 160, 90],
    [3, 70, 220, 90],
    [5, 245, 215, 60],
    [6, 255, 150, 40],
    [7, 255, 70, 60],
    [9, 255, 40, 160],
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (kp >= stops[i][0] && kp <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const t = hi[0] === lo[0] ? 0 : (kp - lo[0]) / (hi[0] - lo[0]);
  const c = [1, 2, 3].map((j) => Math.round(lo[j] + (hi[j] - lo[j]) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export class Timeline {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private viewStart: number;
  private viewEnd: number;
  private dirty = true;
  private dragging = false;
  private panning = false;
  private panRefX = 0;
  private panRefStart = 0;
  private panRefEnd = 0;

  constructor(
    private clock: SimClock,
    private provider: KpProvider,
  ) {
    this.canvas = document.getElementById('timeline') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const now = Date.now();
    this.viewStart = now - 380 * 86400000;
    this.viewEnd = now + 45 * 86400000;

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => {
      this.dragging = false;
      this.panning = false;
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('resize', () => (this.dirty = true));
    clock.onChange(() => (this.dirty = true));
  }

  private xToTime(x: number): number {
    return this.viewStart + (x / this.canvas.clientWidth) * (this.viewEnd - this.viewStart);
  }

  private timeToX(t: number): number {
    return ((t - this.viewStart) / (this.viewEnd - this.viewStart)) * this.canvas.clientWidth;
  }

  private onPointerDown(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (e.button === 1 || e.shiftKey) {
      this.panning = true;
      this.panRefX = x;
      this.panRefStart = this.viewStart;
      this.panRefEnd = this.viewEnd;
    } else {
      this.dragging = true;
      this.clock.setTime(this.xToTime(x));
    }
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging && !this.panning) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (this.panning) {
      const span = this.panRefEnd - this.panRefStart;
      const dt = ((this.panRefX - x) / this.canvas.clientWidth) * span;
      this.viewStart = Math.max(MAX_START, this.panRefStart + dt);
      this.viewEnd = Math.min(MAX_END, this.viewStart + span);
      this.viewStart = this.viewEnd - span;
      this.dirty = true;
    } else {
      this.clock.setTime(this.xToTime(Math.max(0, Math.min(this.canvas.clientWidth, x))));
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pivot = this.xToTime(x);
    const factor = Math.exp(e.deltaY * 0.0016);
    let span = (this.viewEnd - this.viewStart) * factor;
    span = Math.max(MIN_SPAN_MS, Math.min(MAX_END - MAX_START, span));
    const frac = x / this.canvas.clientWidth;
    this.viewStart = Math.max(MAX_START, pivot - span * frac);
    this.viewEnd = Math.min(MAX_END, this.viewStart + span);
    this.viewStart = this.viewEnd - span;
    this.dirty = true;
  }

  /** Keep the playhead in view while playing. */
  followPlayhead(): void {
    const t = this.clock.timeMs;
    const span = this.viewEnd - this.viewStart;
    if (t > this.viewEnd - span * 0.05) {
      this.viewStart = t - span * 0.5;
      this.viewEnd = this.viewStart + span;
      this.dirty = true;
    } else if (t < this.viewStart) {
      this.viewStart = t - span * 0.1;
      this.viewEnd = this.viewStart + span;
      this.dirty = true;
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const span = this.viewEnd - this.viewStart;
    const stripTop = 14;
    const stripH = h - 26;

    // ---- Kp heat strip: max Kp per pixel column ----
    const stepPerPx = span / w;
    for (let x = 0; x < w; x++) {
      const t0 = this.viewStart + x * stepPerPx;
      const t1 = t0 + stepPerPx;
      let kp = 0;
      if (stepPerPx <= 3 * 3600000) {
        kp = this.provider.kpAt((t0 + t1) / 2).kp;
      } else {
        // sample at 3h intervals across the column, take max
        for (let t = t0; t < t1; t += 3 * 3600000) kp = Math.max(kp, this.provider.kpAt(t).kp);
      }
      const norm = Math.min(1, kp / 9);
      const barH = Math.max(1, norm * stripH);
      ctx.fillStyle = kpColor(kp, 0.28 + norm * 0.6);
      ctx.fillRect(x, stripTop + stripH - barH, 1, barH);
    }

    // ---- flare ticks ----
    const flares = this.provider.flaresIn(this.viewStart, this.viewEnd);
    for (const f of flares) {
      if (f.cls === 'A' || f.cls === 'B') continue;
      const x = this.timeToX(f.beginMs);
      let color = 'rgba(255,225,77,0.5)';
      let th = 6;
      if (f.cls === 'M') {
        color = 'rgba(255,176,0,0.8)';
        th = 8 + Math.min(6, f.mag * 0.6);
      } else if (f.cls === 'X') {
        color = 'rgba(255,59,84,0.95)';
        th = 12 + Math.min(10, f.mag * 0.8);
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, stripTop, 1.5, th);
    }

    // ---- time axis labels ----
    ctx.fillStyle = 'rgba(200,244,255,0.55)';
    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.textBaseline = 'top';
    for (const { t, label } of this.ticks(span)) {
      const x = this.timeToX(t);
      ctx.fillStyle = 'rgba(0,229,255,0.18)';
      ctx.fillRect(x, stripTop, 1, stripH);
      ctx.fillStyle = 'rgba(200,244,255,0.6)';
      ctx.fillText(label, x + 3, h - 11);
    }

    // ---- NOW marker ----
    const nowX = this.timeToX(Date.now());
    if (nowX >= 0 && nowX <= w) {
      ctx.strokeStyle = 'rgba(26,255,140,0.9)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(nowX, 0);
      ctx.lineTo(nowX, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(26,255,140,0.9)';
      ctx.font = '9px "Share Tech Mono", monospace';
      ctx.fillText('NOW', nowX + 3, 1);
    }

    // ---- playhead ----
    const px = this.timeToX(this.clock.timeMs);
    ctx.strokeStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fill();
  }

  private ticks(span: number): { t: number; label: string }[] {
    const out: { t: number; label: string }[] = [];
    const d0 = new Date(this.viewStart);
    if (span > 3 * 365 * 86400000) {
      // yearly
      const step = span > 30 * 365 * 86400000 ? 5 : 1;
      let y = Math.ceil(d0.getUTCFullYear() / step) * step;
      for (; ; y += step) {
        const t = Date.UTC(y, 0, 1);
        if (t > this.viewEnd) break;
        out.push({ t, label: String(y) });
      }
    } else if (span > 60 * 86400000) {
      // monthly
      let y = d0.getUTCFullYear();
      let m = d0.getUTCMonth() + 1;
      for (;;) {
        if (m > 11) { m = 0; y++; }
        const t = Date.UTC(y, m, 1);
        if (t > this.viewEnd) break;
        out.push({ t, label: `${y}-${String(m + 1).padStart(2, '0')}` });
        m++;
      }
    } else if (span > 3 * 86400000) {
      // daily
      let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1);
      const step = span > 20 * 86400000 ? 7 : 1;
      for (; t <= this.viewEnd; t += step * 86400000) {
        const d = new Date(t);
        out.push({ t, label: `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` });
      }
    } else {
      // hourly
      const stepH = span > 86400000 ? 6 : span > 8 * 3600000 ? 2 : 1;
      let t = Math.ceil(this.viewStart / (stepH * 3600000)) * stepH * 3600000;
      for (; t <= this.viewEnd; t += stepH * 3600000) {
        const d = new Date(t);
        out.push({ t, label: `${String(d.getUTCHours()).padStart(2, '0')}:00` });
      }
    }
    return out.slice(0, 60);
  }

  /** Jump the view to show a time range (used when launching scenarios). */
  focus(t0: number, t1: number): void {
    const pad = (t1 - t0) * 0.15;
    this.viewStart = Math.max(MAX_START, t0 - pad);
    this.viewEnd = Math.min(MAX_END, t1 + pad);
    this.dirty = true;
  }
}
