import { FRAME_FLAG, applyFrame, clampFrame, getFrame, panFrame, zoomFrame } from './avatar-frame.mjs';

const avatarsOf = userId => document.querySelectorAll(`.camera-view[data-user="${userId}"] img.user-avatar`);

/** Show a framing on every rendered camera tile of this user (live preview while editing). */
export function previewFrame(userId, frame) {
  for (const img of avatarsOf(userId)) applyFrame(img, frame);
}

/** Aspect ratio (height / width) of the user's camera tile, so the editor preview matches it. */
function tileRatio(userId) {
  const box = document.querySelector(`.camera-view[data-user="${userId}"] .video-container`)?.getBoundingClientRect();
  return box?.width && box?.height ? box.height / box.width : 0.75;
}

let AppClass;
function appClass() {
  if (AppClass) return AppClass;
  AppClass = class AvatarFrameApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ['rp-frame-avatar-app'],
      window: { title: 'Align camera portrait', icon: 'fa-solid fa-crop-simple' },
      position: { width: 360, height: 'auto' }
    };

    constructor({ user, ...options }) {
      super({ ...options, id: `rp-frame-avatar-${user.id}` });
      this.user = user;
      this.frame = getFrame(user);
      this.saved = false;
    }

    get title() { return `Align camera portrait: ${this.user.name}`; }

    async _renderHTML() {
      const root = document.createElement('div');
      root.className = 'rp-frame-avatar-editor';
      const width = 320, height = Math.round(width * tileRatio(this.user.id));
      root.innerHTML = `
        <div class="rp-frame-avatar-preview" style="width:${width}px;height:${height}px">
          <img alt="" draggable="false">
        </div>
        <p class="rp-frame-avatar-hint">Drag to move · scroll or use the slider to zoom</p>
        <label class="rp-frame-avatar-zoom"><i class="fa-solid fa-magnifying-glass"></i>
          <input type="range" min="1" max="3" step="0.01"></label>
        <footer class="rp-frame-avatar-buttons">
          <button type="button" data-act="reset"><i class="fa-solid fa-rotate-left"></i> Reset</button>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="button" data-act="save" class="rp-frame-primary"><i class="fa-solid fa-check"></i> Save</button>
        </footer>`;
      root.querySelector('img').src = this.user.avatar;
      return root;
    }

    _replaceHTML(result, content) { content.replaceChildren(result); }

    _onRender() {
      const root = this.element;
      const box = root.querySelector('.rp-frame-avatar-preview');
      const img = box.querySelector('img');
      const slider = root.querySelector('input[type=range]');
      const show = frame => {
        this.frame = clampFrame(frame);
        applyFrame(img, this.frame);
        slider.value = String(this.frame.scale);
        previewFrame(this.user.id, this.frame);
      };
      show(this.frame);
      box.addEventListener('pointerdown', down => {
        box.setPointerCapture(down.pointerId);
        let last = { x: down.clientX, y: down.clientY };
        const move = event => {
          const rect = box.getBoundingClientRect();
          show(panFrame(this.frame, event.clientX - last.x, event.clientY - last.y, rect));
          last = { x: event.clientX, y: event.clientY };
        };
        const up = () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); };
        box.addEventListener('pointermove', move);
        box.addEventListener('pointerup', up);
      });
      box.addEventListener('wheel', event => { event.preventDefault(); show(zoomFrame(this.frame, event.deltaY)); }, { passive: false });
      slider.addEventListener('input', () => show({ ...this.frame, scale: Number(slider.value) }));
      root.querySelector('[data-act=reset]').addEventListener('click', () => show({}));
      root.querySelector('[data-act=cancel]').addEventListener('click', () => this.close());
      root.querySelector('[data-act=save]').addEventListener('click', async () => {
        this.saved = true;
        await this.user.setFlag('rp-frame', FRAME_FLAG, this.frame);
        this.close();
      });
    }

    _onClose(options) {
      super._onClose(options);
      // Cancelled or closed: put the live tiles back to the stored framing.
      if (!this.saved) previewFrame(this.user.id, getFrame(this.user));
    }
  };
  return AppClass;
}

export function openFrameEditor(user) {
  const Cls = appClass();
  const existing = foundry.applications.instances?.get(`rp-frame-avatar-${user.id}`);
  if (existing) return existing.bringToFront?.();
  return new Cls({ user }).render(true);
}
