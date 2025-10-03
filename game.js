import * as ROT from "https://unpkg.com/rot-js/lib/index.js";

// параметры карты и игры
const MAP_W = 40;
const MAP_H = 22;
const ENEMIES_COUNT = 6;
const ITEMS_COUNT = 8;

const display = new ROT.Display({width: MAP_W, height: MAP_H, fontSize: 18});
document.getElementById("game").appendChild(display.getContainer());

// добавим строку статуса под дисплеем
const status = document.createElement('div');
status.style.marginTop = '8px';
status.style.fontFamily = 'monospace';
status.style.whiteSpace = 'pre';
document.getElementById('game').appendChild(status);

// глобальные состояния (инициализируются в initGame)
let map = {};
let freeCells = [];
let player = null;
let enemies = [];
let items = [];
const PLAYER_MAX_HP = 10;
let gameOver = false;

function initGame() {
  map = {};
  freeCells = [];
  enemies = [];
  items = [];
  gameOver = false;

  const digger = new ROT.Map.Digger(MAP_W, MAP_H);
  digger.create((x, y, value) => {
    map[`${x},${y}`] = (value === 0);
    if (value === 0) freeCells.push([x, y]);
  });

  function randomFreeLocal() {
    const i = Math.floor(ROT.RNG.getUniform() * freeCells.length);
    return freeCells[i].slice();
  }

  player = {hp: PLAYER_MAX_HP, x: 0, y: 0, inv: []};
  [player.x, player.y] = randomFreeLocal();

  for (let i = 0; i < ENEMIES_COUNT; i++) {
    let [x, y] = randomFreeLocal();
    if (x === player.x && y === player.y) { i--; continue; }
    enemies.push({x, y, hp: 3});
  }

  for (let i = 0; i < ITEMS_COUNT; i++) {
    let [x, y] = randomFreeLocal();
    if ((x === player.x && y === player.y) || enemies.some(e => e.x === x && e.y === y)) { i--; continue; }
    items.push({x, y, type: 'potion'});
  }
  draw();
}

// найти случайную свободную позицию (вспомогательная для других функций)
function randomFree() {
  const i = Math.floor(ROT.RNG.getUniform() * freeCells.length);
  return freeCells[i].slice();
}

function isFloor(x, y) { return map[`${x},${y}`] === true; }
function enemyAt(x, y) { return enemies.find(e => e.x === x && e.y === y); }
function itemAt(x, y) { return items.find(it => it.x === x && it.y === y); }

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

  for (const it of items) display.draw(it.x, it.y, '!', 'lime');
  for (const e of enemies) display.draw(e.x, e.y, 'E', 'red');
  display.draw(player.x, player.y, '@', 'yellow');

  if (gameOver) {
    status.textContent = `HP: 0    You died. Use Restart in Menu.`;
  } else {
    status.textContent = `HP: ${player.hp}    Inventory: ${player.inv.join(', ') || '-'}    Enemies: ${enemies.length}`;
  }
}

function tryMove(dx, dy) {
  if (gameOver) return;
  const nx = player.x + dx;
  const ny = player.y + dy;
  if (!isFloor(nx, ny)) return; // стена

  const enemy = enemyAt(nx, ny);
  if (enemy) {
    enemy.hp -= 2;
    console.log('You hit the enemy! (hp left:', enemy.hp, ')');
    if (enemy.hp <= 0) {
      const idx = enemies.indexOf(enemy);
      if (idx >= 0) enemies.splice(idx, 1);
      console.log('Enemy died');
    }
    enemiesAct();
    draw();
    return;
  }

  const it = itemAt(nx, ny);
  player.x = nx; player.y = ny;
  if (it) {
    if (it.type === 'potion') {
      player.inv.push('potion');
      const idx = items.indexOf(it);
      if (idx >= 0) items.splice(idx, 1);
      console.log('Picked up a potion');
    }
  }

  enemiesAct();
  draw();
}

function enemiesAct() {
  if (gameOver) return;
  for (const e of enemies) {
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
    if (gameOver) return;
    const idx = player.inv.indexOf('potion');
    if (idx >= 0) {
      player.inv.splice(idx, 1);
      player.hp = Math.min(PLAYER_MAX_HP, player.hp + 5);
      console.log('You use a potion. HP:', player.hp);
      draw();
    } else {
      console.log('No potions');
    }
  },
  openInventory: () => {
    alert('Inventory:\n' + (player.inv.length ? player.inv.join('\n') : '(empty)'));
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
  if (e.key === 'u') window.gameControls.usePotion();
});

// swipe controls remain
let startX, startY;
document.addEventListener('touchstart', e => {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
});
document.addEventListener('touchend', e => {
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

// initialize the game on load
initGame();

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

menuToggle.addEventListener('click', () => { menu.style.display = 'flex'; });
closeMenuBtn.addEventListener('click', () => { menu.style.display = 'none'; });
startBtn.addEventListener('click', () => { window.gameControls.restart(); menu.style.display='none'; });
resumeBtn.addEventListener('click', () => { menu.style.display='none'; });
showInvBtn.addEventListener('click', () => { window.gameControls.openInventory(); });

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
