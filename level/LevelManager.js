export class LevelManager {
  constructor(levelBuilder) {
    this.levelBuilder = levelBuilder;
    this.levels = [];
  }

  load(reflectionModel, options = {}) {
    const level = this.levelBuilder.build(reflectionModel, options);
    this.levels.push(level);
    const index = this.levels.length - 1;
    return {index, level};
  }

  restart() {
    this.levels = [];
  }
}
