import { VoiceDetector, DEFAULT_THRESHOLD_DB, FLOOR_DB } from './voice-detector.mjs';
import { browserVoiceMic } from './voice-mic.mjs';

const MODULE_ID = 'rp-frame';
const MIN_DB = -80, MAX_DB = -10;
const MIC_MESSAGES = {
  denied: 'Microphone access was blocked. Allow it in your browser to see the meter.',
  unavailable: 'No microphone available.',
  ended: 'Microphone disconnected.'
};
const percent = db => Math.min(100, Math.max(0, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
const threshold = () => Number(game.settings.get(MODULE_ID, 'voiceThreshold') ?? DEFAULT_THRESHOLD_DB);

let AppClass;
/** Sensitivity window: a live, local-only level meter and the voiceThreshold slider. */
export function voiceSensitivityApp() {
  if (AppClass) return AppClass;
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base) return null;
  AppClass = class VoiceSensitivityApp extends Base {
    static DEFAULT_OPTIONS = {
      classes: ['rp-frame-voice-app'],
      window: { title: 'Voice glow sensitivity', icon: 'fa-solid fa-microphone-lines' },
      position: { width: 360, height: 'auto' }
    };

    // This window's own mic, separate from the voice service's; closed with the window.
    mic = browserVoiceMic();
    detector = new VoiceDetector({ threshold: threshold() });
    level = FLOOR_DB;
    message = '';
    closed = false;

    async _renderHTML() {
      const root = document.createElement('div');
      root.className = 'rp-frame-voice-editor';
      const value = this.detector.threshold;
      root.innerHTML = `
        <p class="rp-frame-voice-note" data-role="off" hidden>Voice glow is off for this world.</p>
        <p class="rp-frame-voice-hint">Talk normally: the bar should turn green while you speak and stay grey when you're quiet. Only levels are measured; nothing is recorded or sent.</p>
        <div class="rp-frame-voice-meter" aria-hidden="true"><div class="rp-frame-voice-level"></div><div class="rp-frame-voice-marker"></div></div>
        <p class="rp-frame-voice-note" data-role="message" hidden></p>
        <label class="rp-frame-voice-threshold">Threshold
          <input type="range" min="${MIN_DB}" max="${MAX_DB}" step="1" value="${value}">
          <output>${value} dB</output></label>
        <footer class="rp-frame-avatar-buttons">
          <button type="button" data-act="reset"><i class="fa-solid fa-rotate-left"></i> Default</button>
          <button type="button" data-act="close" class="rp-frame-primary"><i class="fa-solid fa-check"></i> Done</button>
        </footer>`;
      return root;
    }

    _replaceHTML(result, content) { content.replaceChildren(result); }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      if (game.settings.get(MODULE_ID, 'voiceGlow')) void this.startMic();
    }

    _onRender() {
      const root = this.element;
      root.querySelector('[data-role=off]').hidden = Boolean(game.settings.get(MODULE_ID, 'voiceGlow'));
      const slider = root.querySelector('input[type=range]');
      const save = () => game.settings.set(MODULE_ID, 'voiceThreshold', this.detector.threshold);
      slider.addEventListener('input', () => this.setThreshold(Number(slider.value)));
      slider.addEventListener('change', () => void save());
      root.querySelector('[data-act=reset]').addEventListener('click', () => { this.setThreshold(DEFAULT_THRESHOLD_DB); void save(); });
      root.querySelector('[data-act=close]').addEventListener('click', () => this.close());
      this.paint();
    }

    async startMic() {
      let result;
      try { result = await this.mic.start(db => this.onLevel(db), () => this.showMessage(MIC_MESSAGES.ended)); }
      catch { result = 'unavailable'; }
      if (this.closed) return void this.mic.stop();
      if (result !== 'ok') this.showMessage(MIC_MESSAGES[result] ?? MIC_MESSAGES.unavailable);
    }

    setThreshold(db) {
      this.detector.threshold = Math.min(MAX_DB, Math.max(MIN_DB, Math.round(db)));
      this.paint();
    }

    onLevel(db) {
      this.level = db;
      this.detector.sample(db, Date.now());
      this.paint();
    }

    showMessage(text) {
      this.message = text;
      this.paint();
    }

    paint() {
      const root = this.element;
      if (!root) return;
      const value = this.detector.threshold;
      const slider = root.querySelector('input[type=range]');
      if (Number(slider.value) !== value) slider.value = String(value);
      root.querySelector('output').textContent = `${value} dB`;
      root.querySelector('.rp-frame-voice-level').style.width = `${percent(this.level)}%`;
      root.querySelector('.rp-frame-voice-marker').style.left = `${percent(value)}%`;
      root.querySelector('.rp-frame-voice-meter').classList.toggle('talking', this.detector.talking);
      const message = root.querySelector('[data-role=message]');
      message.textContent = this.message;
      message.hidden = !this.message;
    }

    _onClose(options) {
      super._onClose?.(options);
      this.closed = true;
      this.mic.stop();
    }
  };
  return AppClass;
}
