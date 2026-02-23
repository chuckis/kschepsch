import * as ROT from "https://unpkg.com/rot-js/lib/index.js";
import {NostrConnector} from "./nostr/NostrConnector.js";
import {ReflectionParser} from "./reflection/ReflectionParser.js";
import {LevelBuilder} from "./level/LevelBuilder.js";
import {LevelManager} from "./level/LevelManager.js";

const MAP_W = 40;
const MAP_H = 22;
const NOSTR_KIND_REFLECTION = 31337;
const NOSTR_TAG_REFLECTION = "reflection";
const DEFAULT_NOSTR_RELAY = "wss://relay.damus.io";
const DEFAULT_NOSTR_RELAYS = ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://purplepag.es"];
const NANOBOT_PUBKEY_STORAGE_KEY = "kschepsch-nanobot-pubkey-v1";
const TEST_LEVEL_PATH = "./test/test-level.json";
const TEST_EVENT_PATH = "./test/test-event.json";

// levels
const levels = [];
let currentLevel = 0;
const reflectionQueue = [];
const reflectionEvents = [];
let eventSortOrder = "desc";
let testReflectionPayload = null;
let testReflectionLoadAttempted = false;

const reflectionParser = new ReflectionParser();
const levelBuilder = new LevelBuilder({baseWidth: MAP_W, baseHeight: MAP_H});
const levelManager = new LevelManager(levelBuilder);
const nostrConnector = new NostrConnector({
  relayUrls: window.REFLECTION_RELAY_URLS || (window.REFLECTION_RELAY_URL ? [window.REFLECTION_RELAY_URL] : DEFAULT_NOSTR_RELAYS),
  lookbackSeconds: 24 * 60 * 60,
  limit: 200
});
let reflectionStreamStarted = false;

function getSavedNanobotPubkey() {
  try {
    return localStorage.getItem(NANOBOT_PUBKEY_STORAGE_KEY) || "";
  } catch (_) {
    return "";
  }
}

function saveNanobotPubkey(pubkey) {
  try {
    if (!pubkey) {
      localStorage.removeItem(NANOBOT_PUBKEY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(NANOBOT_PUBKEY_STORAGE_KEY, pubkey);
  } catch (err) {
    console.warn("Failed to persist NANOBOT pubkey:", err);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTsToMillis(value) {
  if (!Number.isFinite(value)) return Date.now();
  return value < 1e12 ? value * 1000 : value;
}

function rememberReflectionEvent(event, model, source = "nostr") {
  const eventId = event?.id || `${source}-${model.sessionId}-${Date.now()}`;
  const existing = reflectionEvents.findIndex((entry) => entry.eventId === eventId);
  const entry = {
    eventId,
    model,
    source,
    rawEvent: event || null,
    createdAtMs: normalizeTsToMillis(model?.createdAt || event?.created_at)
  };

  if (existing >= 0) reflectionEvents.splice(existing, 1);
  reflectionEvents.unshift(entry);
  if (reflectionEvents.length > 100) reflectionEvents.length = 100;
}

function renderEventPicker() {
  const list = document.getElementById("eventList");
  const sortBtn = document.getElementById("eventSortBtn");
  if (!list) return;
  if (sortBtn) sortBtn.textContent = eventSortOrder === "desc" ? "Sort: Newest" : "Sort: Oldest";
  list.innerHTML = "";

  if (reflectionEvents.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No events yet";
    empty.style.color = "#999";
    empty.style.fontSize = "12px";
    list.appendChild(empty);
    return;
  }

  const sorted = reflectionEvents
    .slice()
    .sort((a, b) => eventSortOrder === "desc" ? b.createdAtMs - a.createdAtMs : a.createdAtMs - b.createdAtMs);

  sorted.forEach((entry) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";
    row.style.padding = "6px";
    row.style.border = "1px solid #2b2b2b";
    row.style.borderRadius = "6px";
    row.style.background = "#101010";

    const meta = document.createElement("div");
    meta.style.fontSize = "12px";
    meta.style.lineHeight = "1.25";
    const when = new Date(entry.createdAtMs).toLocaleString();
    meta.textContent = `${entry.model.sessionId} (${entry.source}, ${when})`;

    const goBtn = document.createElement("button");
    goBtn.textContent = "GO";
    goBtn.dataset.eventId = entry.eventId;
    goBtn.style.width = "52px";
    goBtn.style.padding = "6px 8px";

    row.appendChild(meta);
    row.appendChild(goBtn);
    list.appendChild(row);
  });
}

function fixtureToPayload(fixture) {
  if (!fixture || typeof fixture !== "object") return null;
  if (typeof fixture.content === "string") {
    try {
      return JSON.parse(fixture.content);
    } catch (_) {
      return null;
    }
  }
  if (typeof fixture.session_id === "string" || fixture.metrics || fixture.reflection) return fixture;
  return null;
}

async function tryLoadFixture(path) {
  try {
    const response = await fetch(path, {cache: "no-store"});
    if (!response.ok) return null;
    const json = await response.json();
    const payload = fixtureToPayload(json);
    if (!payload) {
      console.warn("Fixture JSON shape is invalid:", path);
      return null;
    }
    return payload;
  } catch (_) {
    return null;
  }
}

async function loadTestReflectionPayload() {
  if (testReflectionLoadAttempted) return testReflectionPayload;
  testReflectionLoadAttempted = true;

  const fromEvent = await tryLoadFixture(TEST_EVENT_PATH);
  if (fromEvent) {
    testReflectionPayload = fromEvent;
    const model = reflectionParser.parsePayload(cloneJson(fromEvent));
    rememberReflectionEvent({id: "fixture-test-event"}, model, "fixture");
    console.log("Loaded test reflection fixture:", TEST_EVENT_PATH);
    return testReflectionPayload;
  }

  const fromLevel = await tryLoadFixture(TEST_LEVEL_PATH);
  if (fromLevel) {
    testReflectionPayload = fromLevel;
    const model = reflectionParser.parsePayload(cloneJson(fromLevel));
    rememberReflectionEvent({id: "fixture-test-level"}, model, "fixture");
    console.log("Loaded test reflection fixture:", TEST_LEVEL_PATH);
    return testReflectionPayload;
  }

  console.log("No test reflection fixture found.");
  return null;
}

function reflectionModelForLevel(levelIndex) {
  if (reflectionQueue.length > 0) return reflectionQueue.shift();
  if (testReflectionPayload) {
    const payload = cloneJson(testReflectionPayload);
    if (!payload.session_id) payload.session_id = `test-fixture-session-${levelIndex}`;
    payload.session_id = `${payload.session_id}-lvl${levelIndex}`;
    return reflectionParser.parsePayload(payload);
  }
  return null;
}

function markMenuNostrEventReady() {
  const menuBtn = document.getElementById("menuToggle");
  if (!menuBtn) return;
  menuBtn.style.background = "rgba(255,140,0,0.95)";
  menuBtn.style.color = "black";
  menuBtn.style.border = "1px solid #cc6f00";
}

function notifyNoReflectionData() {
  console.warn("No reflection data available. Add a test JSON fixture or wait for a Nostr event.");
  status.textContent = "No reflection data. Wait for Nostr or add test fixture.";
}

function enqueueReflectionEvent(event) {
  try {
    const model = reflectionParser.parseEvent(event);
    reflectionQueue.push(model);
    rememberReflectionEvent(event, model, "nostr");
    markMenuNostrEventReady();
    renderEventPicker();
    console.log("Reflection queued:", model.sessionId, "difficulty:", model.difficulty.toFixed(2));
  } catch (err) {
    console.warn("Reflection event ignored:", err.message);
  }
}

function startReflectionStream() {
  const pubkey = window.NANOBOT_PUBKEY || getSavedNanobotPubkey();
  if (!pubkey) {
    console.log("Nostr reflection stream disabled: set pubkey in menu or window.NANOBOT_PUBKEY.");
    return;
  }

  if (!reflectionStreamStarted) {
    nostrConnector.onReflection((event, relayUrl) => {
      if (event.kind !== NOSTR_KIND_REFLECTION) return;
      const tags = Array.isArray(event.tags) ? event.tags : [];
      const tagged = tags.some((tag) => Array.isArray(tag) && tag[0] === "t" && tag[1] === NOSTR_TAG_REFLECTION);
      if (!tagged) return;
      enqueueReflectionEvent(event);
      if (relayUrl) console.log("Reflection received from relay:", relayUrl);
    });
    reflectionStreamStarted = true;
  }

  nostrConnector.connect();
  nostrConnector.subscribe(pubkey);
  console.log("Nostr reflection stream subscribed for:", pubkey);
}

const display = new ROT.Display({width: MAP_W, height: MAP_H, fontSize: 18});
document.getElementById("game").appendChild(display.getContainer());

// добавим строку статуса — фиксированную панель (не двигается с картой)
const status = document.createElement('div');
status.style.position = 'fixed';
status.style.background = 'rgba(0,0,0,0.6)';
status.style.padding = '6px 10px';
status.style.borderRadius = '6px';
status.style.fontFamily = 'monospace';
status.style.whiteSpace = 'pre';
status.style.zIndex = 65;
status.style.pointerEvents = 'none';
document.body.appendChild(status);

// position status responsively: top-center on desktop, bottom-left on small screens
function updateStatusPosition() {
  const mobile = window.matchMedia('(max-width: 799px)').matches;
  if (mobile) {
    status.style.left = '12px';
    status.style.bottom = '12px';
    status.style.top = '';
    status.style.transform = 'none';
    status.style.maxWidth = '45%';
    status.style.textAlign = 'left';
  } else {
    status.style.left = '50%';
    status.style.top = '12px';
    status.style.bottom = '';
    status.style.transform = 'translateX(-50%)';
    status.style.maxWidth = '';
    status.style.textAlign = 'center';
  }
}
window.addEventListener('resize', updateStatusPosition);
updateStatusPosition();

// Persistence
const SAVE_KEY = 'kschepsch-save-v1';

function saveGame() {
  try {
    const payload = {
      player,
      currentLevel,
      levels,
      timestamp: Date.now()
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Save failed', err);
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // basic validation
    if (!data || !data.levels || typeof data.currentLevel !== 'number' || !data.player) return false;
    // restore
    levels.length = 0;
    for (let i = 0; i < data.levels.length; i++) {
      levels[i] = data.levels[i];
    }
    currentLevel = data.currentLevel;
    player = data.player;
    gameOver = false;
    draw();
    return true;
  } catch (err) {
    console.warn('Load failed', err);
    return false;
  }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
}

// Prevent page scrolling/bounce when interacting with game area or mobile controls
document.addEventListener('touchmove', function(e) {
  const t = e.target;
  if (!t) return;
  if (t.closest && (t.closest('#game') || t.closest('.mobile-controls') || t.closest('.menu-overlay'))) {
    e.preventDefault();
  }
}, {passive: false});

// Ensure menu toggle works on touch devices (some environments need touchstart)
document.addEventListener('DOMContentLoaded', () => {
  const mt = document.getElementById('menuToggle');
  if (mt) {
    mt.addEventListener('touchstart', (ev) => { ev.preventDefault(); mt.click(); });
  }
});

// глобальные состояния (инициализируются в initGame)
let map = {};
let freeCells = [];
let player = null;
let enemies = [];
let items = [];
const PLAYER_MAX_HP = 10;
let gameOver = false;
let cutsceneActive = false;

const shownCutscenes = new Set();

function showCutscene(sceneKey, scene) {
  if (!scene || shownCutscenes.has(sceneKey)) return;
  const overlay = document.getElementById('cutsceneOverlay');
  const title = document.getElementById('cutsceneTitle');
  const blocksWrap = document.getElementById('cutsceneBlocks');
  if (!overlay || !title || !blocksWrap) return;
  shownCutscenes.add(sceneKey);
  cutsceneActive = true;
  title.textContent = scene.title;
  blocksWrap.innerHTML = '';
  scene.blocks.forEach((text) => {
    const block = document.createElement('div');
    block.className = 'cutscene-block';
    block.textContent = text;
    blocksWrap.appendChild(block);
  });
  overlay.style.display = 'flex';
}

function closeCutscene() {
  const overlay = document.getElementById('cutsceneOverlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  cutsceneActive = false;
}

function triggerCutsceneForLevel(levelIndex) {
  const level = levels[levelIndex];
  if (!level) return;

  const sceneKey = level.cutsceneKey || `${levelIndex}-${level.sessionId || 'session'}`;
  const scene = {
    title: level.cutsceneTitle || level.sessionId || `Level ${levelIndex}`,
    blocks: (Array.isArray(level.cutsceneBlocks) && level.cutsceneBlocks.length > 0)
      ? level.cutsceneBlocks
      : [level.narrative || 'Reflection event received.']
  };
  return showCutscene(sceneKey, scene);
}

function initGame() {
  // create first level and set currentLevel
  levels.length = 0;
  levelManager.restart();
  currentLevel = 0;
  gameOver = false;
  const firstModel = reflectionModelForLevel(0);
  if (!firstModel) {
    notifyNoReflectionData();
    return;
  }
  generateLevel(0, firstModel);
  const d = document.getElementById('deathOverlay'); if (d) d.style.display = 'none';
  const fr = document.getElementById('floatingRestart'); if (fr) fr.style.display = 'none';
  // place player at this level
  player = {hp: PLAYER_MAX_HP, x: 0, y: 0, inv: []};
  const [px, py] = randomFree();
  player.x = px; player.y = py;
  draw();
  triggerCutsceneForLevel(0);
  saveGame();
}

function tryFreshLevel(preferredModel = null) {
  const nextIndex = currentLevel + 1;
  const model = preferredModel || reflectionModelForLevel(nextIndex);
  if (!model || !generateLevel(nextIndex, model)) {
    notifyNoReflectionData();
    return;
  }
  if (preferredModel) {
    const qIdx = reflectionQueue.indexOf(preferredModel);
    if (qIdx >= 0) reflectionQueue.splice(qIdx, 1);
  }

  currentLevel = nextIndex;
  if (!player) player = {hp: PLAYER_MAX_HP, x: 0, y: 0, inv: []};
  if (player.hp <= 0) {
    player.hp = PLAYER_MAX_HP;
    gameOver = false;
  }

  const lvl = levels[currentLevel];
  const target = lvl.stairs.up || randomFree();
  player.x = target[0];
  player.y = target[1];
  draw();
  saveGame();
  triggerCutsceneForLevel(currentLevel);
}

function generateLevel(levelIndex, reflectionModel) {
  if (!reflectionModel) return false;
  const {level} = levelManager.load(reflectionModel, {width: MAP_W, height: MAP_H});
  const reflection = reflectionModel.raw?.reflection || {};
  level.cutsceneKey = `${level.sessionId || 'session'}-${levelIndex}`;
  level.cutsceneTitle = reflection.goal || level.sessionId || `Level ${levelIndex}`;
  level.cutsceneBlocks = [
    reflection.summary || level.narrative,
    reflection.outcome ? `Outcome: ${reflection.outcome}` : ''
  ].filter(Boolean);
  levels[levelIndex] = level;
  return true;
}

// найти случайную свободную позицию (вспомогательная для других функций)
function randomFree() {
  const lvl = levels[currentLevel];
  const i = Math.floor(ROT.RNG.getUniform() * lvl.freeCells.length);
  return lvl.freeCells[i].slice();
}

function tileAt(x, y) { return levels[currentLevel].map[`${x},${y}`] || '#'; }
function isFloor(x, y) { return tileAt(x,y) === '.' || tileAt(x,y) === 'D' || tileAt(x,y) === '<' || tileAt(x,y) === '>' ; }
function enemyAt(x, y) { return levels[currentLevel].enemies.find(e => e.x === x && e.y === y); }
function itemAt(x, y) { return levels[currentLevel].items.find(it => it.x === x && it.y === y); }

function draw() {
  display.clear();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!isFloor(x, y)) {
        display.draw(x, y, '#', 'gray');
      } else {
        display.draw(x, y, '.', '#000');
      }
    }
  }

  const lvl = levels[currentLevel];
  for (const [key,val] of Object.entries(lvl.map)) {
    const [x,y] = key.split(',').map(Number);
    if (val === '#') display.draw(x,y,'#','gray');
    if (val === '.') display.draw(x,y,'.','#000');
    if (val === 'D') display.draw(x,y,'+','saddlebrown');
    if (val === '<') display.draw(x,y,'<','white');
    if (val === '>') display.draw(x,y,'>','white');
  }

  for (const it of lvl.items) display.draw(it.x, it.y, it.char || '!', it.color || 'lime');
  for (const e of lvl.enemies) display.draw(e.x, e.y, e.char || 'E', e.color || 'red');
  display.draw(player.x, player.y, '@', 'yellow');

  const potionsCount = player.inv.filter(i => i === 'potion').length;
  if (gameOver) {
    status.textContent = `HP: 0    You died. Use Restart in Menu.`;
    // show death overlay if present
    const deathO = document.getElementById('deathOverlay');
    if (deathO) deathO.style.display = 'flex';
    const fr = document.getElementById('floatingRestart'); if (fr) fr.style.display = 'block';
  } else {
    const enemyCount = (levels[currentLevel] && levels[currentLevel].enemies) ? levels[currentLevel].enemies.length : 0;
    const sessionId = levels[currentLevel]?.sessionId || `level-${currentLevel}`;
    status.textContent = `HP: ${player.hp}    Potions: ${potionsCount}    Enemies: ${enemyCount}    Level: ${currentLevel}    Session: ${sessionId}`;
    // ensure overlays are hidden when alive
    const deathO = document.getElementById('deathOverlay'); if (deathO) deathO.style.display = 'none';
    const fr2 = document.getElementById('floatingRestart'); if (fr2) fr2.style.display = 'none';
  }
}

function tryMove(dx, dy) {
  if (!player || gameOver || cutsceneActive) return;
  const nx = player.x + dx;
  const ny = player.y + dy;
  const tile = tileAt(nx, ny);
  if (tile === '#') return; // wall

  // door
  if (tile === 'D') {
    // open door -> becomes floor
    levels[currentLevel].map[`${nx},${ny}`] = '.';
    player.x = nx; player.y = ny;
    enemiesAct(); draw(); saveGame(); return;
  }

  // stairs up/down
  if (tile === '<') {
    // go up if exists
    if (currentLevel > 0) {
      // move to previous level at matching stairs.down or random
      currentLevel--;
      const lvl = levels[currentLevel];
      const target = lvl.stairs.down || randomFree();
      player.x = target[0]; player.y = target[1];
      draw();
      return;
    }
  }
  if (tile === '>') {
    // go down: generate next level if missing
    if (!levels[currentLevel+1]) {
      const model = reflectionModelForLevel(currentLevel + 1);
      if (!model || !generateLevel(currentLevel + 1, model)) {
        notifyNoReflectionData();
        return;
      }
    }
    currentLevel++;
    const lvl = levels[currentLevel];
    const target = lvl.stairs.up || randomFree();
    player.x = target[0]; player.y = target[1];
    draw();
    saveGame();
    triggerCutsceneForLevel(currentLevel);
    return;
  }

  const enemy = enemyAt(nx, ny);
  if (enemy) {
    enemy.hp -= 2;
    console.log('You hit the enemy! (hp left:', enemy.hp, ')');
    if (enemy.hp <= 0) {
      const idx = levels[currentLevel].enemies.indexOf(enemy);
      if (idx >= 0) levels[currentLevel].enemies.splice(idx, 1);
      console.log('Enemy died');
    }
    enemiesAct();
    draw();
    saveGame();
    return;
  }

  const it = itemAt(nx, ny);
  player.x = nx; player.y = ny;
  if (it) {
    // For now every acquisition grants a consumable charge to preserve existing controls.
    player.inv.push('potion');
    const idx = levels[currentLevel].items.indexOf(it);
    if (idx >= 0) levels[currentLevel].items.splice(idx, 1);
    console.log('Picked up:', it.name || it.type || 'item');
  }

  enemiesAct();
  draw();
  saveGame();
}

function enemiesAct() {
  if (gameOver || cutsceneActive) return;
  const lvl = levels[currentLevel];
  for (const e of lvl.enemies) {
    if (Math.abs(e.x - player.x) + Math.abs(e.y - player.y) === 1) {
      player.hp -= 1;
      console.log('Enemy hits you! HP:', player.hp);
      if (player.hp <= 0) {
        gameOver = true;
        console.log('You died');
      }
      continue;
    }
    const passable = (x, y) => isFloor(x, y) && !enemyAt(x, y) && !(x === player.x && y === player.y);
    const astar = new ROT.Path.AStar(player.x, player.y, passable, {topology:4});
    const path = [];
    astar.compute(e.x, e.y, (x, y) => { path.push([x, y]); });
    if (path.length > 1) {
      const step = path[path.length - 2];
      const nx = step[0], ny = step[1];
      if (!enemyAt(nx, ny) && !(nx === player.x && ny === player.y)) {
        e.x = nx; e.y = ny;
      }
    }
  }
}

// expose controls for mobile buttons
window.gameControls = {
  tryMove,
  usePotion: () => {
    if (gameOver || cutsceneActive) return;
    const idx = player.inv.indexOf('potion');
    if (idx >= 0) {
      player.inv.splice(idx, 1);
      player.hp = Math.min(PLAYER_MAX_HP, player.hp + 5);
      console.log('You use a potion. HP:', player.hp);
      draw();
      saveGame();
    } else {
      console.log('No potions');
    }
  },
  openInventory: () => {
    if (cutsceneActive) return;
    const potions = player.inv.filter(i => i === 'potion').length;
    alert('Potions: ' + potions);
  },
  restart: () => { initGame(); }
};

// keyboard control (movement) - keep as before
window.addEventListener('keydown', (e) => {
  const keyMap = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0]
  };
  if (!(e.key in keyMap)) return;
  const [dx, dy] = keyMap[e.key];
  tryMove(dx, dy);
});

// use potion key
window.addEventListener('keydown', (e) => {
  if (cutsceneActive) return;
  if (e.key === 'u') window.gameControls.usePotion();
});

// swipe controls remain
let startX, startY;
document.addEventListener('touchstart', e => {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
});
document.addEventListener('touchend', e => {
  if (cutsceneActive) return;
  const dx = e.changedTouches[0].clientX - startX;
  const dy = e.changedTouches[0].clientY - startY;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 30) tryMove(1, 0);
    if (dx < -30) tryMove(-1, 0);
  } else {
    if (dy > 30) tryMove(0, 1);
    if (dy < -30) tryMove(0, -1);
  }
});

// initialize the game on load: try to restore save, otherwise start fresh
async function bootstrapGame() {
  await loadTestReflectionPayload();
  renderEventPicker();
  startReflectionStream();
  if (!loadGame()) initGame();
}

bootstrapGame().catch((err) => {
  console.warn("Bootstrap failed:", err);
  startReflectionStream();
  if (!loadGame()) initGame();
});

// wire mobile/menu buttons
const menu = document.getElementById('menu');
const menuToggle = document.getElementById('menuToggle');
const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const showInvBtn = document.getElementById('showInvBtn');
const tryFreshLevelBtn = document.getElementById('tryFreshLevelBtn');
const eventPicker = document.getElementById('eventPicker');
const eventList = document.getElementById('eventList');
const eventSortBtn = document.getElementById('eventSortBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const nostrPubkeyInput = document.getElementById('nostrPubkeyInput');
const saveNostrPubkeyBtn = document.getElementById('saveNostrPubkeyBtn');
const mobileControls = document.getElementById('mobileControls');
const dpad = document.getElementById('dpad');
const useBtn = document.getElementById('useBtn');
const invBtn = document.getElementById('invBtn');
const cutsceneContinue = document.getElementById('cutsceneContinue');

const openMenu = () => {
  menu.style.display = 'flex';
  renderEventPicker();
};
menuToggle.addEventListener('click', openMenu);
// also ensure touch starts toggle menu on mobile
menuToggle.addEventListener('touchstart', (ev) => { ev.preventDefault(); openMenu(); });
closeMenuBtn.addEventListener('click', () => {
  if (eventPicker) eventPicker.style.display = 'none';
  menu.style.display = 'none';
});
// restart: clear save and init fresh
startBtn.addEventListener('click', () => {
  clearSave();
  initGame();
  if (eventPicker) eventPicker.style.display = 'none';
  menu.style.display='none';
});
resumeBtn.addEventListener('click', () => {
  if (eventPicker) eventPicker.style.display = 'none';
  menu.style.display='none';
});
showInvBtn.addEventListener('click', () => { window.gameControls.openInventory(); });
if (tryFreshLevelBtn) {
  const openEventPicker = () => {
    if (!eventPicker) return;
    renderEventPicker();
    eventPicker.style.display = eventPicker.style.display === 'none' ? 'block' : 'none';
  };
  tryFreshLevelBtn.addEventListener('click', openEventPicker);
  tryFreshLevelBtn.addEventListener('touchstart', (ev) => { ev.preventDefault(); openEventPicker(); });
}
if (eventList) {
  eventList.addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    const btn = target ? target.closest('button[data-event-id]') : null;
    if (!btn) return;
    const selected = reflectionEvents.find((entry) => entry.eventId === btn.dataset.eventId);
    if (!selected) return;
    tryFreshLevel(selected.model);
    if (eventPicker) eventPicker.style.display = 'none';
    menu.style.display = 'none';
  });
}
if (eventSortBtn) {
  const toggleSort = () => {
    eventSortOrder = eventSortOrder === "desc" ? "asc" : "desc";
    renderEventPicker();
  };
  eventSortBtn.addEventListener('click', toggleSort);
  eventSortBtn.addEventListener('touchstart', (ev) => { ev.preventDefault(); toggleSort(); });
}
if (nostrPubkeyInput) {
  nostrPubkeyInput.value = window.NANOBOT_PUBKEY || getSavedNanobotPubkey();
}
if (saveNostrPubkeyBtn) {
  const saveNostrKey = () => {
    const value = (nostrPubkeyInput?.value || '').trim();
    saveNanobotPubkey(value);
    window.NANOBOT_PUBKEY = value;
    startReflectionStream();
    console.log(value ? "Nostr pubkey saved." : "Nostr pubkey cleared.");
  };
  saveNostrPubkeyBtn.addEventListener('click', saveNostrKey);
  saveNostrPubkeyBtn.addEventListener('touchstart', (ev) => { ev.preventDefault(); saveNostrKey(); });
}

// death overlay no longer contains a restart button (use floating red Restart or Menu)

// allow closing the death overlay (in case floating restart can't be reached)
const deathClose = document.getElementById('deathClose');
if (deathClose) {
  deathClose.addEventListener('click', () => { const d = document.getElementById('deathOverlay'); if (d) d.style.display = 'none'; });
  deathClose.addEventListener('touchstart', (ev) => { ev.preventDefault(); const d = document.getElementById('deathOverlay'); if (d) d.style.display = 'none'; });
}

// D-pad touch buttons
dpad.addEventListener('touchstart', (ev) => {
  const t = ev.target.closest('.ctl-btn');
  if (!t) return;
  const dir = t.dataset.dir.split(',').map(Number);
  window.gameControls.tryMove(dir[0], dir[1]);
  ev.preventDefault();
});

useBtn.addEventListener('touchstart', (ev) => { window.gameControls.usePotion(); ev.preventDefault(); });
invBtn.addEventListener('touchstart', (ev) => { window.gameControls.openInventory(); ev.preventDefault(); });

if (cutsceneContinue) {
  cutsceneContinue.addEventListener('click', () => { closeCutscene(); });
  cutsceneContinue.addEventListener('touchstart', (ev) => { ev.preventDefault(); closeCutscene(); });
}

// floating restart button (Chromium/mobile fallback)
const floatingRestart = document.getElementById('floatingRestart');
if (floatingRestart) {
  floatingRestart.addEventListener('click', () => { clearSave(); initGame(); });
  floatingRestart.addEventListener('touchstart', (ev) => { ev.preventDefault(); clearSave(); initGame(); });
}
