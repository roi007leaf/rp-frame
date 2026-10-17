import { rmsDb } from './voice-detector.mjs';

const CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } };
const DENIED_ERRORS = new Set(['NotAllowedError', 'SecurityError']);

/** Local mic level meter: reports dBFS readings only; audio never leaves the analyser. */
export class VoiceMic {
  constructor({ mediaDevices, createAudioContext, setInterval, clearInterval, intervalMs = 50 }) {
    this.mediaDevices = mediaDevices;
    this.createAudioContext = createAudioContext;
    this.setInterval = setInterval;
    this.clearInterval = clearInterval;
    this.intervalMs = intervalMs;
    this.stream = null;
    this.context = null;
    this.timer = null;
  }

  /** Open the mic and start reporting levels; resolves 'ok', 'denied' or 'unavailable'. */
  async start(onLevel, onEnded) {
    this.stop();
    if (!this.mediaDevices?.getUserMedia) return 'unavailable';
    try {
      this.stream = await this.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (err) {
      return DENIED_ERRORS.has(err?.name) ? 'denied' : 'unavailable';
    }
    try {
      this.context = this.createAudioContext();
      const source = this.context.createMediaStreamSource(this.stream);
      const analyser = this.context.createAnalyser();
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      this.timer = this.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        onLevel(rmsDb(buf));
      }, this.intervalMs);
    } catch {
      this.stop();
      return 'unavailable';
    }
    for (const track of this.stream.getTracks()) track.addEventListener('ended', onEnded);
    return 'ok';
  }

  stop() {
    if (this.timer !== null) this.clearInterval(this.timer);
    this.timer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.context = null;
  }

  /** Resume a context the browser suspended until a user gesture. */
  resume() {
    if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
  }
}
