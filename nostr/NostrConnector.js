const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://purplepag.es'
];

function isHexPubkey(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATORS[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32VerifyChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data);
  return bech32Polymod(values) === 1;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxV = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    if (value < 0 || (value >> fromBits) !== 0) return null;
    acc = ((acc << fromBits) | value) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxV);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxV);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxV)) {
    return null;
  }
  return ret;
}

function decodeBech32(value) {
  if (typeof value !== 'string') return null;
  const text = value.toLowerCase();
  const pos = text.lastIndexOf('1');
  if (pos < 1 || pos + 7 > text.length) return null;
  const hrp = text.slice(0, pos);
  const dataPart = text.slice(pos + 1);
  const data = [];
  for (const ch of dataPart) {
    const idx = BECH32_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    data.push(idx);
  }
  if (!bech32VerifyChecksum(hrp, data)) return null;
  return {hrp, data: data.slice(0, -6)};
}

function bytesToHex(bytes) {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function npubToHex(npub) {
  const decoded = decodeBech32(npub);
  if (!decoded || decoded.hrp !== 'npub') return null;
  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes || bytes.length !== 32) return null;
  return bytesToHex(bytes);
}

function normalizePubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') return null;
  const trimmed = pubkey.trim();
  if (isHexPubkey(trimmed)) return trimmed.toLowerCase();
  if (trimmed.toLowerCase().startsWith('npub1')) return npubToHex(trimmed);
  return null;
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
    const normalized = normalizePubkey(pubkey);
    if (!normalized) {
      // keep subscription broad by tag if key is not parseable
      // but still proceed, since relay data can be used for debugging.
      console.warn('NostrConnector: pubkey is not valid hex/npub, subscribing without authors filter.');
    }

    const filter = {
      kinds: [31337],
      '#t': ['reflection'],
      limit: this.limit,
      since: Math.floor(Date.now() / 1000) - this.lookbackSeconds
    };

    if (normalized) {
      filter.authors = [normalized];
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
