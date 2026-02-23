Reflection-Driven Roguelike
==========================

Browser roguelike on `rot-js` + vanilla JS that builds levels from Nostr reflection events (`kind: 31337`, tag `t=reflection`).

No backend, no framework, no build step.

What It Does
- Subscribes to Nostr relays and listens for reflection events.
- Parses event `content` JSON into an internal reflection model.
- Generates dungeon levels from reflection data (obstacles -> enemies, acquisitions -> items).
- Lets you pick a specific event and jump to a fresh level from it.
- Shows transition cutscenes using event data (`reflection.goal` as title).
- Saves run state to `localStorage`.

Current Event Sources (priority)
1. Live Nostr events (queue + event list in menu)
2. Local fixture `test/test-event.json`
3. Local fixture `test/test-level.json`

Note: procedural fallback is intentionally disabled.
If no event/fixture exists, level generation will not start.

Project Structure
- `index.html` - UI shell, overlays, menu, mobile controls
- `game.js` - main game loop, rendering, controls, persistence, event picker
- `nostr/NostrConnector.js` - multi-relay websocket connector + filters
- `reflection/ReflectionParser.js` - event/content -> reflection model
- `level/LevelBuilder.js` - reflection model -> generated level
- `level/LevelManager.js` - level lifecycle management
- `entities/EntityFactory.js` - enemy/item entity mapping
- `test/test-event.json` - default local test fixture

Run Locally
Use any static HTTP server (ES modules required):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

or

```bash
npx serve . -l 8000
```

Nostr Integration
Menu includes a key input (`npub` or hex pubkey) and `Save Nostr Key`.

- Saved under `localStorage` key: `kschepsch-nanobot-pubkey-v1`
- Game save key: `kschepsch-save-v1`

Default relays:
- `wss://relay.damus.io`
- `wss://relay.nostr.band`
- `wss://purplepag.es`

Connector behavior:
- Uses `since` (24h lookback) and `limit` for backfill + live flow.
- Supports `npub -> hex` decoding for author filtering.
- Deduplicates events by `event.id` across relays.

Gameplay Controls
Keyboard:
- `Arrows` / `WASD` - move
- `U` - use potion/consumable

Touch/Mobile:
- On-screen D-pad
- Swipe movement
- `U` and `I` action buttons

Menu:
- `Start / Restart`
- `Resume`
- `Inventory`
- `Save Nostr Key`
- `Try fresh level`

Try Fresh Level (Event Picker)
`Try fresh level` toggles an event picker panel:
- Displays known reflection events (fixture + received Nostr events)
- Sort toggle: `Newest` / `Oldest`
- `GO` next to each event creates and enters a new level from that exact event

Cutscenes
Cutscenes are generated per level transition and tied to target level data:
- Title: `reflection.goal` (fallback to `session_id`)
- Body: reflection summary/outcome and transition context (`Ascent`/`Descent`)

Troubleshooting
No levels generated:
- Ensure `test/test-event.json` exists, or wait for a matching Nostr event.

No Nostr events showing:
- Verify pubkey is correct (`npub` or 64-char hex).
- Check relay availability/network.
- Confirm event has `kind: 31337` and tag `t=reflection`.
- Check browser console logs for subscription and parse warnings.

Notes
- Works offline after fixture load or after events are received.
- UI and logic are intentionally simple and single-page.
