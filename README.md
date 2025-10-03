Mini Roguelike
===============

A tiny browser-based roguelike built with ROT.js and plain DOM. It runs entirely in the browser and uses `localStorage` to persist runs. The project is intentionally small and designed to be playable on desktop and mobile (touch) devices.

Files of interest
- `index.html` — game container, mobile controls, overlays and styles.
- `game.js` — all game logic: map generation, entities, rendering, controls and persistence.

Quick features
- Procedural dungeons (ROT.Map.Digger)
- Enemies and simple A* movement
- Items (potions) and basic combat
- Multi-level support with stairs
- Mobile-friendly controls: D-pad, touch swipe, action buttons
- Autosave to `localStorage` (key: `kschepsch-save-v1`)

Running locally
Note: the game uses ES modules, so you must serve it over HTTP/HTTPS (file:// will not work).

Start a simple HTTP server in the project directory:

```bash
# Python 3
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

Or with Node (if you prefer):

```bash
# if you have npm
npx serve . -l 8000
```

Controls
- Keyboard
  - Arrow keys or WASD to move
  - U to use a potion
- Touch / Mobile
  - On-screen D-pad for movement
  - Swipe gestures also move the player (swipe up/down/left/right)
  - Action buttons: U (use potion), I (open inventory)
- Menu
  - `Menu` button (top-left on mobile) opens the in-game menu with Start/Restart, Resume and Inventory

Persistence
- The game autosaves after important actions. Save contents are stored in `localStorage` under the key `kschepsch-save-v1`.
- To clear a save manually: open the menu and tap Start / Restart, or clear the `localStorage` entry from the browser devtools.

Mobile / Chromium notes & troubleshooting
- Because the game runs inside an overlay on some WebViews, touch events can sometimes be swallowed by the modal. To improve usability the project includes:
  - A floating red "Restart" button positioned above overlays (pulses on small screens) so you can always start a new run.
  - A small × button in the death overlay to dismiss the dialog if needed.
- If the game feels unresponsive after a restart, make sure you started the game through the floating Restart button or the Menu → Start. If you still see issues:
  1. Open browser devtools and ensure there are no console errors.
  2. Confirm the page is served over HTTP/HTTPS (ES module import of ROT.js requires this).
  3. If necessary, clear `localStorage` (key `kschepsch-save-v1`) and reload.

Configuration / quick hacks
- Open `game.js` to tweak constants like `MAP_W`, `MAP_H`, `ENEMIES_COUNT`, and `ITEMS_COUNT`.
- The generation and entity logic are all in `generateLevel()` and `enemiesAct()`.

Contributing
- This is a small project — feel free to open issues or submit PRs. Good starter tasks:
  - Improve stair linking so down/up always lead to matching staircase.
  - Add more enemy types or items.
  - Improve save format or migrate to IndexedDB for larger state.

License
- MIT — feel free to reuse and modify.

Enjoy! If you want, I can add deterministic stair pairing next or a small "Saved" toast when a save occurs.