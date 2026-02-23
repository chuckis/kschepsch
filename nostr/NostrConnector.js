export class NostrConnector {
  constructor(options = {}) {
    this.relayUrl = options.relayUrl || 'wss://relay.damus.io';
    this.ws = null;
    this.pubkey = null;
    this.listeners = new Set();
    this.requestId = `reflection-${Math.random().toString(16).slice(2)}`;
    this.connected = false;
  }

  connect() {
    if (typeof WebSocket === 'undefined') {
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.ws = new WebSocket(this.relayUrl);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      if (this.pubkey) this.subscribe(this.pubkey);
    });

    this.ws.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
    });

    this.ws.addEventListener('error', () => {
      this.connected = false;
    });
  }

  subscribe(pubkey) {
    this.pubkey = pubkey;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const filter = {
      kinds: [31337],
      authors: [pubkey],
      '#t': ['reflection']
    };

    this.ws.send(JSON.stringify(['REQ', this.requestId, filter]));
  }

  onReflection(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    if (!Array.isArray(msg) || msg[0] !== 'EVENT') return;

    const event = msg[2];
    if (!event || event.kind !== 31337) return;

    const tags = Array.isArray(event.tags) ? event.tags : [];
    const hasReflectionTag = tags.some((tag) => Array.isArray(tag) && tag[0] === 't' && tag[1] === 'reflection');
    if (!hasReflectionTag) return;

    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch (_) {
        // listener errors are isolated
      }
    }
  }
}
