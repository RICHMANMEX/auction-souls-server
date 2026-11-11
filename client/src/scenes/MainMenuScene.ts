import Phaser from 'phaser';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenuScene');
  }

  create() {
    // Чёрный фон
    this.add.rectangle(640, 360, 1280, 720, 0x0a0a0a);

    // Заголовок
    this.add.text(640, 200, 'AUCTION OF SOULS', {
      fontSize: '64px',
      color: '#c9a961',
      fontFamily: 'Arial'
    }).setOrigin(0.5);

    // Кнопка "Играть"
    const playButton = this.add.text(640, 400, '[ НАЧАТЬ ИГРУ ]', {
      fontSize: '32px',
      color: '#ffffff',
      fontFamily: 'Arial'
    }).setOrigin(0.5);

    // Делаем кнопку кликабельной
    playButton.setInteractive({ useHandCursor: true });

    playButton.on('pointerover', () => {
      playButton.setColor('#c9a961');
    });

    playButton.on('pointerout', () => {
      playButton.setColor('#ffffff');
    });

    playButton.on('pointerdown', () => {
      this.scene.start('GameScene');
    });
  }
}