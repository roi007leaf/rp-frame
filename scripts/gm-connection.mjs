/** Ready-socket lease. Login activity only prompts a check; it never cancels a proven socket. */
export class GmConnection {
  constructor({ sendPing, changed, now = () => Date.now(), timeout = 5000 }) {
    Object.assign(this, { sendPing, changed, now, timeout });
    this.connected = false;
    this.gmId = null;
    this.session = null;
    this.pending = null;
    this.sequence = 0;
    this.lastPing = -Infinity;
  }

  setConnected(value) {
    if (value === this.connected) return;
    this.connected = value;
    this.changed(value);
  }

  poll(activeGmId, force = false) {
    if (activeGmId && activeGmId !== this.gmId) {
      this.gmId = activeGmId;
      this.session = null;
      this.pending = null;
      this.lastPing = -Infinity;
      this.setConnected(false);
    }
    if (!this.gmId) return;
    if (this.pending && this.now() - this.pending.sent >= this.timeout) {
      this.pending = null;
      this.setConnected(false);
    }
    if (this.pending || (!force && this.now() - this.lastPing < 1000)) return;
    this.lastPing = this.now();
    this.pending = { nonce: ++this.sequence, sent: this.now() };
    this.sendPing(this.gmId, this.pending.nonce);
  }

  /** Session epochs reject closing-tab replies even after the replacement is ready. */
  accept(sender, packet, activeGmId, nonce = null) {
    if (!sender || sender !== (activeGmId ?? this.gmId)) return false;
    if (!packet?.ready || !Number.isFinite(packet.session)) return false;
    if (sender === this.gmId && this.session !== null && packet.session < this.session) return false;
    if (nonce !== null && nonce !== this.pending?.nonce) return false;
    this.gmId = sender;
    this.session = packet.session;
    this.pending = null;
    this.lastPing = this.now();
    this.setConnected(true);
    return true;
  }

  unavailable(sender, session) {
    if (sender !== this.gmId || session !== this.session) return;
    this.pending = null;
    this.lastPing = -Infinity;
    this.setConnected(false);
  }
}
