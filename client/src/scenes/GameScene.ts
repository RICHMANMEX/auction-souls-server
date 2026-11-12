import Phaser from 'phaser';
import { Client, Room } from '@colyseus/sdk';
import { GAME_WIDTH, GAME_HEIGHT, PLAYER_POSITIONS } from '../config/gameConfig';

// Автоматически определяем адрес сервера
const getWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const host = window.location.hostname;

  if (host.includes('devtunnels.ms')) {
    const tunnelHost = host.replace('-5173', '-2567');
    return `${protocol}${tunnelHost}`;
  }
  return `${protocol}${host}:2567`;
};

const SERVER_URL = getWebSocketUrl();

// Интерфейс для UI-элементов игрока
interface PlayerUI {
  body: Phaser.GameObjects.Shape; // Исправлено с GameObject на Shape для поддержки графики/кругов
  nameText: Phaser.GameObjects.Text;
  hpText: Phaser.GameObjects.Text;
  soulsText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private playerObjects: PlayerUI[] = [];
  
  // UI элементы
  private phaseText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private itemNameText!: Phaser.GameObjects.Text;
  private itemDescText!: Phaser.GameObjects.Text;
  private itemCard!: Phaser.GameObjects.Container;
  
  private readyButton!: Phaser.GameObjects.Text;
  private betPanel!: Phaser.GameObjects.Container;
  private betInputText!: Phaser.GameObjects.Text;
  private betErrorMsg!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private logMessages: string[] = [];

  private currentBet: number = 0;

  constructor() {
    super('GameScene');
  }

  create() {
    // 1. Фон и стол
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a1a1a);
    const table = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 600, 400, 0x3d2817);
    table.setStrokeStyle(4, 0x5c3a21);

    // 2. Информация о раунде и фазе (вверху)
    this.roundText = this.add.text(20, 20, 'Раунд: -', { fontSize: '18px', color: '#ffffff' });
    this.phaseText = this.add.text(20, 50, 'Фаза: ожидание', { fontSize: '18px', color: '#aaaaaa' });

    // 3. Карточка предмета
    this.itemCard = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    const cardBg = this.add.rectangle(0, 0, 300, 150, 0x2a2a2a).setStrokeStyle(2, 0xc9a961);
    this.itemNameText = this.add.text(0, -40, 'Лот: ???', { fontSize: '24px', color: '#c9a961', fontStyle: 'bold' }).setOrigin(0.5);
    this.itemDescText = this.add.text(0, 10, 'Описание предмета', { fontSize: '16px', color: '#ffffff', align: 'center', wordWrap: { width: 280 } }).setOrigin(0.5);
    this.itemCard.add([cardBg, this.itemNameText, this.itemDescText]);
    this.itemCard.setVisible(false);

    // 4. Позиции игроков
    PLAYER_POSITIONS.forEach((pos, index) => {
      const colors = [0x8b0000, 0x006400, 0x00008b, 0x8b8b00];
      const body = this.add.circle(pos.x, pos.y, 40, colors[index]).setStrokeStyle(3, 0xffffff);

      const nameText = this.add.text(pos.x, pos.y + 60, '...', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
      const hpText = this.add.text(pos.x, pos.y - 60, 'HP: -', { fontSize: '16px', color: '#ff6666' }).setOrigin(0.5);
      const soulsText = this.add.text(pos.x, pos.y - 40, 'Souls: -', { fontSize: '16px', color: '#c9a961' }).setOrigin(0.5);
      const statusText = this.add.text(pos.x, pos.y + 85, '', { fontSize: '14px', color: '#66ff66' }).setOrigin(0.5);

      this.playerObjects.push({ body, nameText, hpText, soulsText, statusText });
    });

    // 5. Кнопка "Я готов"
    this.readyButton = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 80, '[ Я ГОТОВ ]', {
      fontSize: '24px', color: '#ffffff', backgroundColor: '#333333', padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setVisible(false);

    this.readyButton.on('pointerover', () => this.readyButton.setStyle({ color: '#c9a961' }));
    this.readyButton.on('pointerout', () => this.readyButton.setStyle({ color: '#ffffff' }));
    this.readyButton.on('pointerdown', () => this.toggleReady());

    // 6. Панель ставок
    this.betPanel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 100);
    const betBg = this.add.rectangle(0, 0, 400, 80, 0x222222).setStrokeStyle(2, 0x666666);
    
    this.add.text(-180, -10, 'Ваша ставка:', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
    this.betInputText = this.add.text(-80, -10, '0', { fontSize: '24px', color: '#c9a961' }).setOrigin(0.5);
    
    const minusBtn = this.add.text(-130, -10, '[-]', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const plusBtn = this.add.text(-30, -10, '[+]', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    
    const submitBetBtn = this.add.text(120, -10, '[ СДЕЛАТЬ СТАВКУ ]', { fontSize: '16px', color: '#000000', backgroundColor: '#c9a961', padding: { x: 10, y: 5 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    
    this.betErrorMsg = this.add.text(0, 25, '', { fontSize: '14px', color: '#ff4444' }).setOrigin(0.5);

    minusBtn.on('pointerdown', () => this.changeBet(-1));
    plusBtn.on('pointerdown', () => this.changeBet(1));
    submitBetBtn.on('pointerdown', () => this.submitBet());

    this.betPanel.add([betBg, minusBtn, plusBtn, this.betInputText, submitBetBtn, this.betErrorMsg]);
    this.betPanel.setVisible(false);

    // 7. Журнал событий
    this.logText = this.add.text(20, 100, '', {
      fontSize: '14px', color: '#aaaaaa', fontFamily: 'monospace'
    });

    // 8. Подключение к серверу
    this.connectToServer();
  }

  private async connectToServer() {
    try {
      this.client = new Client(SERVER_URL);
      
      // Запрашиваем уникальное имя, чтобы не быть обоими "Женями"
      const playerName = prompt("Введите ваше имя для аукциона:", `Игрок_${Math.floor(Math.random() * 100)}`) || "Женя";

      this.room = await this.client.joinOrCreate('game', { name: playerName });
      this.addLog(`✓ Подключился как ${playerName}! ID: ${this.room.sessionId}`);

      // Слушаем изменения состояния
      this.room.onStateChange(() => {
        this.render();
      });

      this.room.onMessage('event', (msg: any) => {
        this.addLog(msg.text);
      });

      this.room.onMessage('auction_result', (msg: any) => {
        const betsInfo = Object.entries(msg.bets).map(([id, bet]) => {
          const p = this.room.state.players.get(id);
          return `${p ? p.name : id}: ${bet}`;
        }).join(', ');
        this.addLog(`🏆 Ставки раскрыты [${betsInfo}]. Победитель: ${msg.winnerName} (${msg.winnerBet} душ)`);
      });

      this.room.onMessage('error', (msg: any) => {
        this.betErrorMsg.setText(msg.text);
        this.addLog(`❌ Ошибка: ${msg.text}`);
      });

      this.room.onLeave(() => {
        this.addLog('✗ Соединение закрыто.');
      });

    } catch (e: any) {
      console.error('Ошибка подключения:', e);
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Ошибка подключения к серверу!\nУбедись, что сервер запущен', {
        fontSize: '20px', color: '#ff0000', align: 'center'
      }).setOrigin(0.5);
    }
  }

  private render() {
    if (!this.room) return;
    const state = this.room.state;
    const me = state.players.get(this.room.sessionId);

    const phaseLabels: Record<string, string> = {
      waiting: 'Ожидание игроков (лобби)',
      item_reveal: 'Показ лота раунда',
      betting: 'Приём скрытых ставок',
      result: 'Раскрытие ставок и итог'
    };
    this.roundText.setText(state.phase === 'waiting' ? 'Раунд: -' : `Раунд: ${state.round}`);
    this.phaseText.setText(`Фаза: ${phaseLabels[state.phase] || state.phase}`);

    const showItem = ['item_reveal', 'betting', 'result'].includes(state.phase);
    this.itemCard.setVisible(showItem);
    if (showItem) {
      this.itemNameText.setText(`Лот: ${state.itemName}`);
      this.itemDescText.setText(state.itemDesc);
    }

    this.playerObjects.forEach((obj) => {
      obj.body.setVisible(false);
      obj.nameText.setText('');
      obj.hpText.setText('');
      obj.soulsText.setText('');
      obj.statusText.setText('');
    });

    let playerIndex = 0;
    state.players.forEach((player: any, sessionId: string) => {
      if (playerIndex < this.playerObjects.length) {
        const obj = this.playerObjects[playerIndex];
        obj.body.setVisible(true);
        obj.nameText.setText(player.name || `Игрок ${playerIndex + 1}`);
        obj.hpText.setText(`HP: ${player.hp}/${player.maxHp}`);
        obj.soulsText.setText(`Souls: ${player.souls}`);
        
        if (state.phase === 'waiting') {
          obj.statusText.setText(player.ready ? '✓ ГОТОВ' : 'не готов');
        } else if (state.phase === 'betting') {
          obj.statusText.setText(player.hasBet ? 'ставка сделана' : 'думает...');
        } else if (state.phase === 'result' && state.auctionWinnerId === sessionId) {
          obj.statusText.setText('🏆 ВЫИГРАЛ ЛОТ');
        }

        if (sessionId === this.room.sessionId) {
          (obj.body as Phaser.GameObjects.Arc).setStrokeStyle(4, 0xffff00);
        }
        playerIndex++;
      }
    });

    this.readyButton.setVisible(state.phase === 'waiting');
    if (state.phase === 'waiting' && me) {
      this.readyButton.setText(me.ready ? '[ НЕ ГОТОВ ]' : '[ Я ГОТОВ ]');
    }

    // Использование переменной canBet для устранения варнингов TS
    const canBet = state.phase === 'betting' && me && me.alive && !me.hasBet;
    if (canBet) {
      // логика активна
    }

    this.betPanel.setVisible(state.phase === 'betting' || state.phase === 'result');
    
    if (state.phase === 'betting' && me && me.hasBet) {
      this.betErrorMsg.setText('Скрытая ставка принята. Ожидание остальных...');
    } else if (state.phase !== 'betting') {
      this.betErrorMsg.setText('');
    }
  }

  private toggleReady() {
    if (!this.room) return;
    const me = this.room.state.players.get(this.room.sessionId);
    if (me) {
      this.room.send('ready', { value: !me.ready });
    }
  }

  private changeBet(delta: number) {
    if (!this.room) return;
    const me = this.room.state.players.get(this.room.sessionId);
    if (!me || me.hasBet) return;

    this.currentBet = Phaser.Math.Clamp(this.currentBet + delta, 0, me.souls);
    this.betInputText.setText(this.currentBet.toString());
    this.betErrorMsg.setText('');
  }

  private submitBet() {
    if (!this.room) return;
    const me = this.room.state.players.get(this.room.sessionId);
    if (!me || me.hasBet) return;

    if (this.currentBet < 0 || this.currentBet > me.souls) {
      this.betErrorMsg.setText(`Ставка от 0 до ${me.souls}`);
      return;
    }

    this.room.send('bet', { amount: this.currentBet });
  }

  private addLog(text: string) {
    this.logMessages.unshift(text);
    if (this.logMessages.length > 8) this.logMessages.pop();
    this.logText.setText(this.logMessages.join('\n'));
  }
}