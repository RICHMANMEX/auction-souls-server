import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/gameConfig';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenuScene');
  }

  create() {
    // 1. Фон главного меню от Ильи
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'menu_bg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    // 2. Подзаголовок — поднимаем выше (под "Аукцион")
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 130, 'Тайные ставки. Блеф. Последняя душа.', {
      fontSize: '22px',
      color: '#dddddd'
    }).setOrigin(0.5);

    // 3. Кнопка "НАЧАТЬ ИГРУ" — на месте таблички "Играть" от Ильи (справа)
    //    Её тёмный фон сам перекроет табличку
    const btn = this.add.text(GAME_WIDTH / 2 + 100, GAME_HEIGHT / 2 - 60, '[ НАЧАТЬ ИГРУ ]', {
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#1a2530',
      padding: { x: 24, y: 12 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ color: '#c9a961', backgroundColor: '#2a3540' }));
    btn.on('pointerout', () => btn.setStyle({ color: '#ffffff', backgroundColor: '#1a2530' }));
    btn.on('pointerdown', () => {
      const name = (window.prompt('Введите ваше имя', 'Женя') || 'Женя').trim().slice(0, 20);
      this.scene.start('GameScene', { playerName: name });
    });
  }
}