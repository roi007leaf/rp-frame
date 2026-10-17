/** voicePttMouse setting values mapped to MouseEvent.button. */
export const PTT_MOUSE = { none: null, back: 3, forward: 4 };

/**
 * Push-to-talk held state: the bound key and the chosen mouse button are tracked independently,
 * and `held` is true while either is down. Pure: main.mjs feeds it keybinding and DOM events.
 */
export class PushToTalk {
  #onChange;
  #key = false;
  #button = false;
  #mouse = 'none';

  constructor({ onChange } = {}) {
    this.#onChange = onChange;
  }

  get held() {
    return this.#key || this.#button;
  }

  get mouse() {
    return this.#mouse;
  }

  /** Choose the mouse button ('none', 'back' or 'forward'); clears the mouse-held state. */
  set mouse(value) {
    this.#mouse = Object.hasOwn(PTT_MOUSE, value) ? value : 'none';
    this.#change(() => { this.#button = false; });
  }

  keyDown() { this.#change(() => { this.#key = true; }); }

  keyUp() { this.#change(() => { this.#key = false; }); }

  pointerDown(button) {
    if (this.#matches(button)) this.#change(() => { this.#button = true; });
  }

  pointerUp(button) {
    if (this.#matches(button)) this.#change(() => { this.#button = false; });
  }

  /** Clear both (window blur or hidden tab: the matching key or button up may never arrive). */
  release() {
    this.#change(() => { this.#key = false; this.#button = false; });
  }

  #matches(button) {
    const chosen = PTT_MOUSE[this.#mouse];
    return chosen !== null && button === chosen;
  }

  #change(apply) {
    const before = this.held;
    apply();
    if (this.held !== before) this.#onChange?.(this.held);
  }
}
