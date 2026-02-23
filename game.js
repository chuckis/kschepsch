import * as ROT from "https://unpkg.com/rot-js/lib/index.js";
import {NostrConnector} from "./nostr/NostrConnector.js";
import {ReflectionParser} from "./reflection/ReflectionParser.js";
import {LevelBuilder} from "./level/LevelBuilder.js";
import {LevelManager} from "./level/LevelManager.js";

// параметры карты и игры
const MAP_W = 40;
const MAP_H = 22;
const ENEMIES_COUNT = 6;
const ITEMS_COUNT = 8;
const NOSTR_KIND_REFLECTION = 31337;
const NOSTR_TAG_REFLECTION = "reflection";
const DEFAULT_NOSTR_RELAY = "wss://relay.damus.io";

// levels
const levels = [];
let currentLevel = 0;
const reflectionQueue = [];

const reflectionParser = new ReflectionParser();
const levelBuilder = new LevelBuilder({baseWidth: MAP_W, baseHeight: MAP_H});
const levelManager = new LevelManager(levelBuilder);
const nostrConnector = new NostrConnector({
  relayUrl: window.REFLECTION_RELAY_URL || DEFAULT_NOSTR_RELAY
});

function buildFallbackReflectionPayload(levelIndex) {
  const obstacleCount = Math.min(10, 3 + levelIndex);
  const acquisitionCount = Math.max(2, 5 - Math.floor(levelIndex / 2));
  const obstacles = Array.from({length: obstacleCount}, (_, i) => ({
    archetype: i % 3 === 0 ? "blocker" : i % 3 === 1 ? "confusion" : "retry_loop",
    intensity: 0.2 + Math.min(1.5, levelIndex * 0.12 + i * 0.05),
    name: `Obstacle ${i + 1}`,
    description: `Generated from fallback reflection for level ${levelIndex}.`
  }));
  const acquisitions = Array.from({length: acquisitionCount}, (_, i) => ({
    type: i % 3 === 0 ? "insight" : i % 3 === 1 ? "tool" : "skill",
    value: 1 + levelIndex * 0.2,
    name: `Acquisition ${i + 1}`
  }));

  return {
    session_id: `fallback-session-${levelIndex}`,
    reflection: {
      goal: "Advance deeper and stay alive.",
      outcome: "Generated fallback session.",
      summary: `No live reflection feed available, using procedural session ${levelIndex}.`
    },
    metrics: {
      duration_minutes: 45 + levelIndex * 8,
      tool_calls: 3 + levelIndex,
      focus_score: Math.max(0.2, 0.75 - levelIndex * 0.04),
      friction: Math.min(1, 0.25 + levelIndex * 0.05)
    },
    obstacles,
    acquisitions,
    energy_curve: [0.3, 0.6, 0.8]
  };
}

function reflectionModelForLevel(levelIndex) {
  if (reflectionQueue.length > 0) return reflectionQueue.shift();
  return reflectionParser.parsePayload(buildFallbackReflectionPayload(levelIndex));
}

function enqueueReflectionEvent(event) {
  try {
    const model = reflectionParser.parseEvent(event);
    reflectionQueue.push(model);
    console.log("Reflection queued:", model.sessionId, "difficulty:", model.difficulty.toFixed(2));
  } catch (err) {
    console.warn("Reflection event ignored:", err.message);
  }
}

function startReflectionStream() {
  const pubkey = window.NANOBOT_PUBKEY;
  if (!pubkey) {
    console.log("Nostr reflection stream disabled: set window.NANOBOT_PUBKEY to enable.");
    return;
  }

  nostrConnector.onReflection((event) => {
    if (event.kind !== NOSTR_KIND_REFLECTION) return;
    const tags = Array.isArray(event.tags) ? event.tags : [];
    const tagged = tags.some((tag) => Array.isArray(tag) && tag[0] === "t" && tag[1] === NOSTR_TAG_REFLECTION);
    if (!tagged) return;
    enqueueReflectionEvent(event);
  });
  nostrConnector.connect();
  nostrConnector.subscribe(pubkey);
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

const cutscenes = {
  intro: {
    title: 'Запись в дневнике',
    blocks: [
      'Ты спускаешься в темные уровни подземелья, где стены шепчут о забытых героях.',
      'На поясе звенит последняя фляга. Впереди — поиск артефакта и выход наружу.',
      'Соберись. Каждая дверь может быть спасением или ловушкой.'
    ]
  },
  level1: {
    title: 'Глубже во тьму',
    blocks: [
      'Сырой воздух становится тяжелее, а шаги звучат чужими.',
      'Ты чувствуешь, что это место не любит гостей.'
    ]
  },
  level2: {
    title: 'Следы стражей',
    blocks: [
      'На полу — свежие следы когтей и капли зеленоватой крови.',
      'Кто-то живет здесь. И он рядом.'
    ]
  }
};
const shownCutscenes = new Set();

function showCutscene(sceneKey) {
  const scene = cutscenes[sceneKey];
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
  if (levelIndex === 0) return showCutscene('intro');
  if (levelIndex === 1) return showCutscene('level1');
  if (levelIndex === 2) return showCutscene('level2');
  return undefined;
}

function initGame() {
  // create first level and set currentLevel
  levels.length = 0;
  levelManager.restart();
  currentLevel = 0;
  gameOver = false;
  generateLevel(0, reflectionModelForLevel(0));
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

function generateLevel(levelIndex, reflectionModel = null) {
  if (reflectionModel) {
    const {level} = levelManager.load(reflectionModel, {width: MAP_W, height: MAP_H});
    levels[levelIndex] = level;
    return;
  }

  const mapLocal = {};
  const freeLocal = [];
  const enemiesLocal = [];
  const itemsLocal = [];
  const doors = [];
  const stairs = {up: null, down: null};

  const digger = new ROT.Map.Digger(MAP_W, MAP_H);
  digger.create((x, y, value) => {
    // store tiles: '.' = floor, '#' = wall
    mapLocal[`${x},${y}`] = (value === 0) ? '.' : '#';
    if (value === 0) freeLocal.push([x, y]);
  });

  function randomFreeLocal() {
    const i = Math.floor(ROT.RNG.getUniform() * freeLocal.length);
    return freeLocal[i].slice();
  }

  // place enemies
  for (let i = 0; i < ENEMIES_COUNT; i++) {
    let [x, y] = randomFreeLocal();
    enemiesLocal.push({x, y, hp: 3});
  }

  // place items
  for (let i = 0; i < ITEMS_COUNT; i++) {
    let [x, y] = randomFreeLocal();
    itemsLocal.push({x, y, type: 'potion'});
  }

  // place a few doors along walls: mark door as 'D' on map
  for (let i = 0; i < 6; i++) {
    const [x, y] = randomFreeLocal();
    // only place doors adjacent to a wall
    const adjWall = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => mapLocal[`${x+dx},${y+dy}`] === '#');
    if (adjWall) {
      mapLocal[`${x},${y}`] = 'D';
      doors.push([x,y]);
    }
  }

  // stairs: up and down
  const up = randomFreeLocal();
  const down = randomFreeLocal();
  mapLocal[`${up[0]},${up[1]}`] = '<';
  mapLocal[`${down[0]},${down[1]}`] = '>';
  stairs.up = up; stairs.down = down;

  levels[levelIndex] = {map: mapLocal, freeCells: freeLocal, enemies: enemiesLocal, items: itemsLocal, doors, stairs};
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
    const sessionId = levels[currentLevel]?.sessionId || `procedural-${currentLevel}`;
    status.textContent = `HP: ${player.hp}    Potions: ${potionsCount}    Enemies: ${enemyCount}    Level: ${currentLevel}    Session: ${sessionId}`;
    // ensure overlays are hidden when alive
    const deathO = document.getElementById('deathOverlay'); if (deathO) deathO.style.display = 'none';
    const fr2 = document.getElementById('floatingRestart'); if (fr2) fr2.style.display = 'none';
  }
}

function tryMove(dx, dy) {
  if (gameOver || cutsceneActive) return;
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
    if (!levels[currentLevel+1]) generateLevel(currentLevel + 1, reflectionModelForLevel(currentLevel + 1));
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
startReflectionStream();
if (!loadGame()) {
  initGame();
}

// wire mobile/menu buttons
const menu = document.getElementById('menu');
const menuToggle = document.getElementById('menuToggle');
const startBtn = document.getElementById('startBtn');
const resumeBtn = document.getElementById('resumeBtn');
const showInvBtn = document.getElementById('showInvBtn');
const closeMenuBtn = document.getElementById('closeMenuBtn');
const mobileControls = document.getElementById('mobileControls');
const dpad = document.getElementById('dpad');
const useBtn = document.getElementById('useBtn');
const invBtn = document.getElementById('invBtn');
const cutsceneContinue = document.getElementById('cutsceneContinue');

menuToggle.addEventListener('click', () => { menu.style.display = 'flex'; });
// also ensure touch starts toggle menu on mobile
menuToggle.addEventListener('touchstart', (ev) => { ev.preventDefault(); menu.style.display = 'flex'; });
closeMenuBtn.addEventListener('click', () => { menu.style.display = 'none'; });
// restart: clear save and init fresh
startBtn.addEventListener('click', () => { clearSave(); initGame(); menu.style.display='none'; });
resumeBtn.addEventListener('click', () => { menu.style.display='none'; });
showInvBtn.addEventListener('click', () => { window.gameControls.openInventory(); });

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
