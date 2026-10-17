import { VoiceDetector, DEFAULT_THRESHOLD_DB } from './voice-detector.mjs';
import { HEARTBEAT_MS, MIC } from './voice-roster.mjs';

/**
 * Runs the local mic while voice glow is enabled and this player has consented,
 * broadcasting only {talking, mic} through host.send.
 */
export class VoiceService {
  #host;
  #detector = new VoiceDetector();
  #status = MIC.off;
  #running = false;
  #consented = false;
  #heartbeat = null;
  #pending = null;
  #stops = 0;

  constructor(host) {
    this.#host = host;
  }

  get status() {
    return this.#status;
  }

  get talking() {
    return this.#detector.talking;
  }

  get mic() {
    return this.#host.mic;
  }

  /** Reconcile with the world switch, opt-out and consent; concurrent calls share one run. */
  update() {
    return this.#pending ??= this.#update().finally(() => { this.#pending = null; });
  }

  announce() {
    this.#send();
  }

  stop() {
    this.#stops++;
    this.#halt(MIC.off);
  }

  async #update() {
    const host = this.#host;
    const stops = this.#stops;
    if (!host.enabled()) return void this.#halt(MIC.off);
    if (host.optedOut()) {
      if (!this.#halt(MIC.off)) this.#send();
      return;
    }
    if (this.#running) return;
    if (!this.#consented && !host.consented()) {
      if (!(await host.askConsent())) {
        await host.setOptOut(true);
        this.#halt(MIC.off);
        this.#send();
        return;
      }
      await host.setConsent();
    }
    this.#consented = true;
    if (stops !== this.#stops) return;
    // The switch or opt-out may have changed while the consent dialog was open.
    if (!host.enabled() || host.optedOut()) return this.#update();
    const result = await host.mic.start(db => this.#level(db), () => this.#ended());
    // stop() during the await (e.g. pagehide) wins: close what just opened.
    if (stops !== this.#stops) return void this.#halt(MIC.off);
    if (!host.enabled() || host.optedOut()) return this.#update();
    this.#status = result;
    this.#running = result === MIC.ok;
    this.#send();
  }

  #level(db) {
    const host = this.#host;
    this.#detector.threshold = host.threshold() ?? DEFAULT_THRESHOLD_DB;
    const talking = this.#detector.sample(db, host.now());
    if (talking === null) return;
    this.#clearHeartbeat();
    if (talking) this.#heartbeat = host.setInterval(() => this.#send(), HEARTBEAT_MS);
    this.#send();
  }

  #ended() {
    if (!this.#halt(MIC.unavailable)) this.#send();
  }

  /** Close the mic and set status; sends talking:false only if we were talking. Returns whether it sent. */
  #halt(status) {
    const wasTalking = this.talking;
    this.#clearHeartbeat();
    this.#status = status;
    this.#running = false;
    if (wasTalking) this.#host.send({ talking: false, mic: status });
    this.#host.mic.stop();
    this.#detector.reset();
    return wasTalking;
  }

  #clearHeartbeat() {
    if (this.#heartbeat !== null) this.#host.clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #send() {
    this.#host.send({ talking: this.talking, mic: this.#status });
  }
}
