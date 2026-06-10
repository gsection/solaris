// Central simulated-time engine. All times are epoch milliseconds UTC.

export const SPEED_STEPS = [
  { label: 'REAL-TIME', simPerSec: 1 },
  { label: '1 MIN/S', simPerSec: 60 },
  { label: '10 MIN/S', simPerSec: 600 },
  { label: '1 HR/S', simPerSec: 3600 },
  { label: '6 HR/S', simPerSec: 21600 },
  { label: '1 DAY/S', simPerSec: 86400 },
  { label: '1 WK/S', simPerSec: 604800 },
] as const;

export class SimClock {
  timeMs: number;
  playing = true;
  speedIndex = 3; // 1 HR/S default — auroras visibly sweep with the terminator
  private listeners: Array<(t: number) => void> = [];

  constructor(startMs = Date.now()) {
    this.timeMs = startMs;
  }

  get speed(): number {
    return SPEED_STEPS[this.speedIndex].simPerSec;
  }

  tick(realDtMs: number): void {
    if (!this.playing) return;
    this.setTime(this.timeMs + realDtMs * this.speed);
  }

  setTime(ms: number): void {
    this.timeMs = ms;
    for (const cb of this.listeners) cb(ms);
  }

  setPlaying(p: boolean): void {
    this.playing = p;
  }

  setSpeedIndex(i: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEED_STEPS.length - 1, i));
  }

  /** step by one "speed unit" (e.g. 1h at 1 HR/S) — for the step buttons */
  step(direction: 1 | -1): void {
    this.setTime(this.timeMs + direction * this.speed * 1000);
  }

  onChange(cb: (t: number) => void): void {
    this.listeners.push(cb);
  }
}
