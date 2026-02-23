const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://purplepag.es'
];

function isHexPubkey(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

export class NostrConnector {
  constructor(options = {}) {
    this.relayUrls = Array.isArray(options.relayUrls) && options.relayUrls.length > 0
      ? options.relayUrls
      : [options.relayUrl || DEFAULT_RELAYS[0]];
    this.lookbackSeconds = Number.isFinite(options.lookbackSeconds) ? options.lookbackSeconds : 24 * 60 * 60;
    this.limit = Number.isFinite(options.limit) ? options.limit : 100;

    this.sockets = new Map();
    this.pubkey = null;
    this.listeners = new Set();
    this.requestId = `reflection-${Math.random().toString(16).slice(2)}`;
    this.seenEventIds = new Set();
  }

  connect() {
    if (typeof WebSocket === 'undefined') return;

    for (const relayUrl of this.relayUrls) {
      const existing = this.sockets.get(relayUrl);
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        continue;
      }

      const ws = new WebSocket(relayUrl);
      this.sockets.set(relayUrl, ws);

      ws.addEventListener('open', () => {
        if (this.pubkey) this.subscribe(this.pubkey);
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data, relayUrl);
      });

      ws.addEventListener('close', () => {
        this.sockets.delete(relayUrl);
      });

      ws.addEventListener('error', () => {
        // keep silent; caller should rely on multi-relay behavior
      });
    }
  }

  subscribe(pubkey) {
    this.pubkey = pubkey;

    const filter = {
      kinds: [31337],
      '#t': ['reflection'],
      limit: this.limit,
      since: Math.floor(Date.now() / 1000) - this.lookbackSeconds
    };

    if (isHexPubkey(pubkey)) {
      filter.authors = [pubkey.toLowerCase()];
    }

    for (const ws of this.sockets.values()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(JSON.stringify(['REQ', this.requestId, filter]));
    }
  }

  onReflection(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  handleMessage(raw, relayUrl) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    if (!Array.isArray(msg)) return;
    if (msg[0] !== 'EVENT') return;

    const event = msg[2];
    if (!event || event.kind !== 31337) return;

    const tags = Array.isArray(event.tags) ? event.tags : [];
    const hasReflectionTag = tags.some((tag) => Array.isArray(tag) && tag[0] === 't' && tag[1] === 'reflection');
    if (!hasReflectionTag) return;

    if (event.id && this.seenEventIds.has(event.id)) return;
    if (event.id) {
      this.seenEventIds.add(event.id);
      if (this.seenEventIds.size > 2000) {
        const firstKey = this.seenEventIds.values().next().value;
        this.seenEventIds.delete(firstKey);
      }
    }

    for (const cb of this.listeners) {
      try {
        cb(event, relayUrl);
      } catch (_) {
        // listener errors are isolated
      }
    }
  }
}
