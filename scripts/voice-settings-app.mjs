import { VoiceDetector, DEFAULT_THRESHOLD_DB, FLOOR_DB } from './voice-detector.mjs';
import { browserVoiceMic } from './voice-mic.mjs';
import { DEFAULT_APPEARANCE, APPEARANCE_RANGES, glowStyle, normalizeAppearance } from './voice-glow.mjs';

const MODULE_ID = 'rp-frame';
const MIN_DB = -80, MAX_DB = -10;
const SLIDERS = [['size', 'Size'], ['brightness', 'Brightness'], ['opacity', 'Opacity']];
const MIC_MESSAGES = {
  denied: 'Microphone access was blocked. Allow it in your browser to see the meter.',
  unavailable: 'No microphone available.',
  ended: 'Microphone disconnected.'
};
const get = key => game.settings.get(MODULE_ID, key);
const set = (key, value) => game.settings.set(MODULE_ID, key, value);
const percent = db => Math.min(100, Math.max(0, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
const threshold = () => Number(get('voiceThreshold') ?? DEFAULT_THRESHOLD_DB);
const savedAppearance = () => normalizeAppearance(get('voiceAppearance'));

/** Players' status line for the world switch they can't change. */
export const tableStatus = on => on ? 'Voice glow is on for this table.' : 'Voice glow is off. Your GM can turn it on.';
/** Label of the button that starts or stops the window's own mic test. */
export const testLabel = testing => testing ? 'Stop test' : 'Test mic';

// Open windows, so a voiceGlow change (from any GM) can refresh their Table section.
const open = new Set();
/** Repaint the Table section of any open voice glow window. */
export function refreshVoiceSettings() {
  for (const app of open) app.paintTable();
}

let apply = () => {};
let AppClass;
/**
 * The single voice glow window: Table (world switch), My mic (opt-in, test meter, threshold), What I see (show, appearance).
 * Every call sets `onAppearance`, which shows an appearance live without saving; the cached class reads it at use time.
 */
export function voiceSettingsApp({ onAppearance } = {}) {
  if (onAppearance) apply = onAppearance;
  if (AppClass) return AppClass;
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base) return null;
  AppClass = class VoiceSettingsApp extends Base {
    static DEFAULT_OPTIONS = {
      classes: ['rp-frame-voice-app'],
      window: { title: 'Voice glow', icon: 'fa-solid fa-microphone-lines' },
      position: { width: 380, height: 'auto' }
    };

    // This window's own mic, separate from the voice service's; only runs during Test mic and stops on close.
    mic = browserVoiceMic();
    detector = new VoiceDetector({ threshold: threshold() });
    level = FLOOR_DB;
    message = '';
    testing = false;
    // Bumped on every start/stop so a late getUserMedia result from a cancelled test is discarded.
    testRun = 0;
    closed = false;
    appearance = savedAppearance();
    // Appearance live edits not yet saved; reverted on close.
    dirty = false;

    async _renderHTML() {
      const root = document.createElement('div');
      root.className = 'rp-frame-voice-editor';
      const value = this.detector.threshold;
      const table = game.user.isGM
        ? `<label class="rp-frame-voice-check"><input type="checkbox" data-setting="voiceGlow"> Voice glow for this world</label>`
        : `<p class="rp-frame-voice-hint" data-role="status"></p>`;
      const sliders = SLIDERS.map(([key, label]) => {
        const [min, max] = APPEARANCE_RANGES[key];
        return `<label class="rp-frame-voice-threshold">${label}
          <input type="range" name="${key}" min="${min}" max="${max}" step="0.05" value="${this.appearance[key]}">
          <output data-for="${key}"></output></label>`;
      }).join('');
      root.innerHTML = `
        <section class="rp-frame-voice-section" data-section="table">
          <h3>Table</h3>
          ${table}
        </section>
        <section class="rp-frame-voice-section" data-section="mic">
          <h3>My mic</h3>
          <label class="rp-frame-voice-check"><input type="checkbox" data-setting="voiceUse"> Use my mic for voice glow</label>
          <p class="rp-frame-voice-hint">Press Test mic and talk normally: the bar should turn green while you speak and stay grey when you're quiet. Only levels are measured; nothing is recorded or sent.</p>
          <div class="rp-frame-voice-meter" aria-hidden="true"><div class="rp-frame-voice-level"></div><div class="rp-frame-voice-marker"></div></div>
          <p class="rp-frame-voice-note" data-role="message" hidden></p>
          <label class="rp-frame-voice-threshold">Threshold
            <input type="range" data-role="threshold" min="${MIN_DB}" max="${MAX_DB}" step="1" value="${value}">
            <output data-role="threshold">${value} dB</output></label>
          <div class="rp-frame-avatar-buttons">
            <button type="button" data-act="test"><i class="fa-solid fa-microphone"></i> <span>${testLabel(false)}</span></button>
            <button type="button" data-act="threshold-reset"><i class="fa-solid fa-rotate-left"></i> Default</button>
          </div>
        </section>
        <section class="rp-frame-voice-section" data-section="look">
          <h3>What I see</h3>
          <label class="rp-frame-voice-check"><input type="checkbox" data-setting="voiceShow"> Show voice glow</label>
          <div class="rp-frame-appearance-preview" aria-hidden="true">
            <svg viewBox="0 0 160 160" width="160" height="160">
              <circle cx="80" cy="80" r="32" class="rp-frame-appearance-token"></circle>
              <g data-role="strokes"></g>
            </svg>
            <div class="rp-frame-appearance-camera"></div>
          </div>
          <label class="rp-frame-voice-threshold">Color
            <input type="color" name="color" value="${this.appearance.color}"></label>
          ${sliders}
          <div class="rp-frame-avatar-buttons">
            <button type="button" data-act="appearance-reset"><i class="fa-solid fa-rotate-left"></i> Reset to default</button>
          </div>
        </section>
        <footer class="rp-frame-avatar-buttons">
          <button type="button" data-act="close" class="rp-frame-primary"><i class="fa-solid fa-check"></i> Done</button>
        </footer>`;
      return root;
    }

    _replaceHTML(result, content) { content.replaceChildren(result); }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      open.add(this);
    }

    _onRender() {
      const root = this.element;
      const on = (selector, type, fn) => root.querySelector(selector)?.addEventListener(type, fn);
      // Table: only GMs get the checkbox (players' HTML has none).
      on('input[data-setting=voiceGlow]', 'change', event => void set('voiceGlow', event.target.checked));
      // My mic: the checkbox is the inverse of voiceOptOut.
      on('input[data-setting=voiceUse]', 'change', event => void set('voiceOptOut', !event.target.checked));
      const slider = root.querySelector('input[data-role=threshold]');
      const saveThreshold = () => set('voiceThreshold', this.detector.threshold);
      slider.addEventListener('input', () => this.setThreshold(Number(slider.value)));
      slider.addEventListener('change', () => void saveThreshold());
      on('[data-act=threshold-reset]', 'click', () => { this.setThreshold(DEFAULT_THRESHOLD_DB); void saveThreshold(); });
      on('[data-act=test]', 'click', () => this.testing ? this.stopTest() : void this.startTest());
      // What I see.
      on('input[data-setting=voiceShow]', 'change', event => void set('voiceShow', event.target.checked));
      for (const input of root.querySelectorAll('input[name]')) {
        const read = () => input.type === 'color' ? input.value : Number(input.value);
        input.addEventListener('input', () => this.updateAppearance({ [input.name]: read() }));
        input.addEventListener('change', () => { this.updateAppearance({ [input.name]: read() }); void this.saveAppearance(); });
      }
      on('[data-act=appearance-reset]', 'click', () => { this.updateAppearance(DEFAULT_APPEARANCE); void this.saveAppearance(); });
      on('[data-act=close]', 'click', () => this.close());
      root.querySelector('input[data-setting=voiceUse]').checked = !get('voiceOptOut');
      root.querySelector('input[data-setting=voiceShow]').checked = Boolean(get('voiceShow'));
      this.paintTable();
      this.paint();
      this.paintAppearance();
    }

    /** Test mic: an explicit, local action that works whether the world switch is on or off. */
    async startTest() {
      const run = ++this.testRun;
      this.testing = true;
      this.message = '';
      this.paint();
      let result;
      try { result = await this.mic.start(db => this.onLevel(db), () => { if (run !== this.testRun) return; this.stopTest(); this.showMessage(MIC_MESSAGES.ended); }); }
      catch { result = 'unavailable'; }
      // Closed or stopped while getUserMedia was pending: release the mic it just opened.
      if (this.closed || run !== this.testRun) return void this.mic.stop();
      if (result !== 'ok') { this.stopTest(); this.showMessage(MIC_MESSAGES[result] ?? MIC_MESSAGES.unavailable); }
    }

    stopTest() {
      this.testRun++;
      this.testing = false;
      this.mic.stop();
      this.level = FLOOR_DB;
      this.detector.reset();
      this.paint();
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

    paintTable() {
      const root = this.element;
      if (!root) return;
      const enabled = Boolean(get('voiceGlow'));
      const box = root.querySelector('input[data-setting=voiceGlow]');
      if (box) box.checked = enabled;
      const status = root.querySelector('[data-role=status]');
      if (status) status.textContent = tableStatus(enabled);
    }

    /** My mic section: meter, threshold, test button and message (runs on every level reading). */
    paint() {
      const root = this.element;
      if (!root) return;
      const value = this.detector.threshold;
      const slider = root.querySelector('input[data-role=threshold]');
      if (Number(slider.value) !== value) slider.value = String(value);
      root.querySelector('output[data-role=threshold]').textContent = `${value} dB`;
      root.querySelector('.rp-frame-voice-level').style.width = `${percent(this.level)}%`;
      root.querySelector('.rp-frame-voice-marker').style.left = `${percent(value)}%`;
      root.querySelector('.rp-frame-voice-meter').classList.toggle('talking', this.testing && this.detector.talking);
      root.querySelector('[data-act=test] span').textContent = testLabel(this.testing);
      const message = root.querySelector('[data-role=message]');
      message.textContent = this.message;
      message.hidden = !this.message;
    }

    updateAppearance(changes) {
      this.appearance = normalizeAppearance({ ...this.appearance, ...changes });
      this.dirty = true;
      apply(this.appearance);
      this.paintAppearance();
    }

    async saveAppearance() {
      this.dirty = false;
      await set('voiceAppearance', { ...this.appearance });
    }

    paintAppearance() {
      const root = this.element;
      if (!root) return;
      const style = glowStyle(this.appearance);
      const color = this.appearance.color;
      // 64px token circle, as on the canvas: radius = 32 + pad.
      const radius = 32 + style.pad;
      root.querySelector('[data-role=strokes]').innerHTML = style.strokes.map(({ width, alpha }) =>
        `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${alpha}"></circle>`).join('');
      root.querySelector('.rp-frame-appearance-camera').style.boxShadow = style.cameraShadow;
      for (const input of root.querySelectorAll('input[name]')) {
        const value = this.appearance[input.name];
        if (input.value !== String(value)) input.value = String(value);
        const output = root.querySelector(`output[data-for="${input.name}"]`);
        if (output) output.textContent = `${Math.round(value * 100)}%`;
      }
    }

    _onClose(options) {
      super._onClose?.(options);
      open.delete(this);
      this.closed = true;
      this.testRun++;
      this.testing = false;
      this.mic.stop();
      // Closed mid-drag without a release: drop the unsaved live preview.
      if (this.dirty) apply(savedAppearance());
    }
  };
  return AppClass;
}
