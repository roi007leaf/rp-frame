export const START_MS = 100, STOP_MS = 500, DEFAULT_THRESHOLD_DB = -45, FLOOR_DB = -100;

/** RMS level of a sample buffer in dBFS, clamped to FLOOR_DB. */
export function rmsDb(samples) {
  if (!samples.length) return FLOOR_DB;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  return rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;
}

/** Talking/quiet state machine: must stay on the other side of the threshold for startMs/stopMs to flip. */
export class VoiceDetector {
  constructor({ threshold = DEFAULT_THRESHOLD_DB, startMs = START_MS, stopMs = STOP_MS } = {}) {
    this.threshold = threshold;
    this.startMs = startMs;
    this.stopMs = stopMs;
    this.reset();
  }

  /** Feed one level reading; returns the new talking value on a transition, else null. */
  sample(db, now) {
    if ((db > this.threshold) === this.talking) {
      this.since = null;
      return null;
    }
    this.since ??= now;
    if (now - this.since < (this.talking ? this.stopMs : this.startMs)) return null;
    this.talking = !this.talking;
    this.since = null;
    return this.talking;
  }

  reset() {
    this.talking = false;
    this.since = null;
  }
}
