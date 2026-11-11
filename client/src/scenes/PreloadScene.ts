import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload() {
    // Сюда потом добавим загрузку картинок от Ильи:
    // this.load.image('table', 'assets/sprites/table.png');
  }

  create() {
    // Когда всё загрузилось — идём в главное меню
    this.scene.start('MainMenuScene');
  }
}