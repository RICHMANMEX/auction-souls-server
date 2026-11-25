import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/gameConfig';

const ITEM_IDS = [
  'fork', 'trident', 'coral', 'legend_trident',
  'shell_1', 'shell_2', 'shell_3',
  'potion', 'white_pearl', 'black_pearl'
];

const SNAIL_KEYS = ['snail_left', 'snail_top', 'snail_right'];

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  create() {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x101018);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Загрузка...', {
      fontSize: '28px', color: '#c9a961'
    }).setOrigin(0.5);

    this.load.image('bg', '/assets/background.png');
    this.load.image('table', '/assets/table.png');
    this.load.image('menu_bg', '/assets/menu_bg.png');
    this.load.image('soul_icon', '/assets/soul.png');
    this.load.image('hp_icon', '/assets/hp.png');
    this.load.image('hero', '/assets/hero.png');
    SNAIL_KEYS.forEach((key) => this.load.image(key, `/assets/${key}.png`));
    ITEM_IDS.forEach((id) => this.load.image(`item_${id}`, `/assets/items/${id}.png`));
    this.load.image('armor_icon', '/assets/items/shell_1.png');

    this.load.on('loaderror', (file: any) => console.warn('Не загрузилось:', file.key));
    this.load.on('complete', () => {
      this.ensurePlaceholders();
      this.scene.start('MainMenuScene');
    });
    this.load.start();
  }

  private ensurePlaceholders() {
    const keys = [
      'bg', 'table', 'menu_bg', 'soul_icon', 'hp_icon', 'hero', 'armor_icon',
      ...SNAIL_KEYS,
      ...ITEM_IDS.map((id) => `item_${id}`)
    ];
    keys.forEach((key) => {
      if (!this.textures.exists(key)) {
        const cv = this.textures.createCanvas(key, 64, 64);
        const ctx = cv.getContext();
        ctx.fillStyle = key.startsWith('item_') ? '#553311' : '#333344';
        ctx.fillRect(0, 0, 64, 64);
        cv.refresh();
        console.warn('Заглушка вместо:', key);
      }
    });
  }
}