import * as ROT from 'https://unpkg.com/rot-js/lib/index.js';
import {EntityFactory} from '../entities/EntityFactory.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class LevelBuilder {
  constructor(options = {}) {
    this.baseWidth = options.baseWidth || 40;
    this.baseHeight = options.baseHeight || 22;
  }

  build(reflectionModel, options = {}) {
    const metrics = reflectionModel.metrics || {};
    const duration = Number.isFinite(metrics.durationMinutes) ? metrics.durationMinutes : 45;

    const width = options.width || clamp(Math.round(30 + duration / 6), 30, 60);
    const height = options.height || clamp(Math.round(18 + duration / 12), 18, 32);

    const map = {};
    const freeCells = [];
    const enemies = [];
    const items = [];
    const doors = [];
    const stairs = {up: null, down: null};

    const digger = new ROT.Map.Digger(width, height);
    digger.create((x, y, value) => {
      map[`${x},${y}`] = value === 0 ? '.' : '#';
      if (value === 0) freeCells.push([x, y]);
    });

    const randomFreeCell = () => {
      const i = Math.floor(ROT.RNG.getUniform() * freeCells.length);
      return freeCells[i].slice();
    };

    const toolCalls = Number.isFinite(metrics.toolCalls) ? metrics.toolCalls : 0;
    const desiredEnemies = Math.max(reflectionModel.enemies.length, Math.round(toolCalls + 2));
    for (let i = 0; i < desiredEnemies; i++) {
      const source = reflectionModel.enemies[i % Math.max(1, reflectionModel.enemies.length)] || {
        id: `procedural-enemy-${i}`,
        className: 'tank',
        hp: 5,
        name: `Enemy ${i + 1}`
      };
      const enemy = EntityFactory.createEnemy(source, i);
      [enemy.x, enemy.y] = randomFreeCell();
      enemies.push(enemy);
    }

    const desiredItems = Math.max(reflectionModel.items.length, 3);
    for (let i = 0; i < desiredItems; i++) {
      const source = reflectionModel.items[i % Math.max(1, reflectionModel.items.length)] || {
        id: `procedural-item-${i}`,
        className: 'scroll',
        type: 'insight',
        value: 1,
        name: `Item ${i + 1}`
      };
      const item = EntityFactory.createItem(source, i);
      [item.x, item.y] = randomFreeCell();
      items.push(item);
    }

    for (let i = 0; i < 6; i++) {
      const [x, y] = randomFreeCell();
      const nearWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map[`${x + dx},${y + dy}`] === '#');
      if (nearWall) {
        map[`${x},${y}`] = 'D';
        doors.push([x, y]);
      }
    }

    const up = randomFreeCell();
    const down = randomFreeCell();
    map[`${up[0]},${up[1]}`] = '<';
    map[`${down[0]},${down[1]}`] = '>';
    stairs.up = up;
    stairs.down = down;

    return {
      map,
      freeCells,
      enemies,
      items,
      doors,
      stairs,
      width,
      height,
      sessionId: reflectionModel.sessionId,
      narrative: reflectionModel.narrative,
      difficulty: reflectionModel.difficulty
    };
  }
}
