import { DEFAULT_APPEARANCE, APPEARANCE_RANGES, glowStyle, normalizeAppearance } from './voice-glow.mjs';

const MODULE_ID = 'rp-frame';
const SLIDERS = [['size', 'Size'], ['brightness', 'Brightness'], ['opacity', 'Opacity']];
const saved = () => normalizeAppearance(game.settings.get(MODULE_ID, 'voiceAppearance'));

let AppClass;
/**
 * Voice glow appearance window: color, size, brightness and opacity for this client only.
 * `apply` shows an appearance live (CSS var + token redraw) without saving it.
 */
export function voiceAppearanceApp(apply) {
  if (AppClass) return AppClass;
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base) return null;
  AppClass = class VoiceAppearanceApp extends Base {
    static DEFAULT_OPTIONS = {
      classes: ['rp-frame-voice-app'],
      window: { title: 'Voice glow appearance', icon: 'fa-solid fa-palette' },
      position: { width: 360, height: 'auto' }
    };

    appearance = saved();
    // Live edits not yet saved; reverted on close.
    dirty = false;

    async _renderHTML() {
      const root = document.createElement('div');
      root.className = 'rp-frame-voice-editor rp-frame-appearance-editor';
      const sliders = SLIDERS.map(([key, label]) => {
        const [min, max] = APPEARANCE_RANGES[key];
        return `<label class="rp-frame-voice-threshold">${label}
          <input type="range" name="${key}" min="${min}" max="${max}" step="0.05" value="${this.appearance[key]}">
          <output data-for="${key}"></output></label>`;
      }).join('');
      root.innerHTML = `
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
        <footer class="rp-frame-avatar-buttons">
          <button type="button" data-act="reset"><i class="fa-solid fa-rotate-left"></i> Reset to default</button>
          <button type="button" data-act="close" class="rp-frame-primary"><i class="fa-solid fa-check"></i> Done</button>
        </footer>`;
      return root;
    }

    _replaceHTML(result, content) { content.replaceChildren(result); }

    _onRender() {
      const root = this.element;
      for (const input of root.querySelectorAll('input[name]')) {
        const read = () => input.type === 'color' ? input.value : Number(input.value);
        input.addEventListener('input', () => this.update({ [input.name]: read() }));
        input.addEventListener('change', () => { this.update({ [input.name]: read() }); void this.save(); });
      }
      root.querySelector('[data-act=reset]').addEventListener('click', () => { this.update(DEFAULT_APPEARANCE); void this.save(); });
      root.querySelector('[data-act=close]').addEventListener('click', () => this.close());
      this.paint();
    }

    update(changes) {
      this.appearance = normalizeAppearance({ ...this.appearance, ...changes });
      this.dirty = true;
      apply(this.appearance);
      this.paint();
    }

    async save() {
      this.dirty = false;
      await game.settings.set(MODULE_ID, 'voiceAppearance', { ...this.appearance });
    }

    paint() {
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
      // Closed mid-drag without a release: drop the unsaved live preview.
      if (this.dirty) apply(saved());
    }
  };
  return AppClass;
}
