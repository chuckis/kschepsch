const ENEMY_STYLE_BY_CLASS = {
  tank: {char: 'B', color: 'crimson'},
  random_walker: {char: 'C', color: 'orange'},
  respawner: {char: 'R', color: 'magenta'}
};

const ITEM_STYLE_BY_CLASS = {
  scroll: {char: '?', color: 'deepskyblue'},
  weapon: {char: ')', color: 'gold'},
  passive_buff: {char: '*', color: 'springgreen'}
};

export class EntityFactory {
  static createEnemy(obstacle, fallbackIndex = 0) {
    const style = ENEMY_STYLE_BY_CLASS[obstacle.className] || ENEMY_STYLE_BY_CLASS.tank;
    return {
      id: obstacle.id || `enemy-${fallbackIndex}`,
      name: obstacle.name || `Enemy ${fallbackIndex + 1}`,
      archetype: obstacle.archetype || 'blocker',
      className: obstacle.className || 'tank',
      lore: obstacle.description || '',
      hp: Math.max(1, Math.round(obstacle.hp || 5)),
      char: style.char,
      color: style.color,
      x: 0,
      y: 0
    };
  }

  static createItem(acquisition, fallbackIndex = 0) {
    const style = ITEM_STYLE_BY_CLASS[acquisition.className] || ITEM_STYLE_BY_CLASS.scroll;
    return {
      id: acquisition.id || `item-${fallbackIndex}`,
      name: acquisition.name || `Item ${fallbackIndex + 1}`,
      type: acquisition.type || 'insight',
      className: acquisition.className || 'scroll',
      value: Number.isFinite(acquisition.value) ? acquisition.value : 1,
      char: style.char,
      color: style.color,
      x: 0,
      y: 0
    };
  }
}
