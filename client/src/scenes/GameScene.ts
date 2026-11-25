import Phaser from 'phaser';
import { Client, Room } from '@colyseus/sdk';
import { GAME_WIDTH, GAME_HEIGHT, PLAYER_POSITIONS } from '../config/gameConfig';

// === Автоматический адрес сервера ===
const getWebSocketUrl = (): string => {
  const host = window.location.hostname;
  if (host.includes('onrender.com')) return `wss://${host}`;
  if (host.includes('devtunnels.ms')) return `wss://${host.replace('-5173', '-2567')}`;
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  return `${protocol}${host}:2567`;
};

// === Подписи всех 7 фаз Стадии 4 ===
const PHASE_LABELS: Record<string, string> = {
  waiting: 'Ожидание игроков (лобби)',
  item_reveal: 'Показ лота раунда',
  betting: 'Приём скрытых ставок',
  result: 'Раскрытие ставок и итог аукциона',
  item_action: 'Выбор цели победителем',
  resolution: 'Применение эффекта предмета',
  game_over: 'Партия окончена'
};

const ITEM_IDS = [
  'fork', 'trident', 'coral', 'legend_trident',
  'shell_1', 'shell_2', 'shell_3',
  'potion', 'white_pearl', 'black_pearl'
];

// Места 1,2,3 — улитки соперников (слева, сверху, справа)
const SNAIL_KEYS = ['snail_left', 'snail_top', 'snail_right'];

interface PlayerUI {
  seat: Phaser.GameObjects.GameObject;
  nameText: Phaser.GameObjects.Text;
  hearts: Phaser.GameObjects.Image[];
  soulIcon: Phaser.GameObjects.Image;
  soulsText: Phaser.GameObjects.Text;
  armorIcon: Phaser.GameObjects.Image;
  armorText: Phaser.GameObjects.Text;
  statusText: Phaser.GameObjects.Text;
  deadOverlay?: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private playerName = 'Женя';
  private playerObjects: PlayerUI[] = [];
  private lastPhase = '';

  private roundText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;

  private itemCard!: Phaser.GameObjects.Container;
  private itemImage!: Phaser.GameObjects.Image;
  private itemNameText!: Phaser.GameObjects.Text;
  private itemDescText!: Phaser.GameObjects.Text;
  private itemPierceBadge!: Phaser.GameObjects.Text;
  private itemTargetHint!: Phaser.GameObjects.Text;

  private readyButton!: Phaser.GameObjects.Text;
  private betPanel!: Phaser.GameObjects.Container;
  private betInputText!: Phaser.GameObjects.Text;
  private betErrorMsg!: Phaser.GameObjects.Text;
  private currentBet = 0;

  private targetPanel!: Phaser.GameObjects.Container;
  private targetWaitingText!: Phaser.GameObjects.Text;
  private targetTimerText!: Phaser.GameObjects.Text;
  private targetTimer?: Phaser.Time.TimerEvent;
  private targetSeconds = 0;

  private gameOverPanel!: Phaser.GameObjects.Container;
  private gameOverTitle!: Phaser.GameObjects.Text;
  private gameOverSubtitle!: Phaser.GameObjects.Text;

  private logText!: Phaser.GameObjects.Text;
  private logMessages: string[] = [];

  constructor() {
    super('GameScene');
  }

  create() {
    const data = this.scene.settings.data as { playerName?: string } | undefined;
    this.playerName = (data && data.playerName) || 'Женя';

    // 1. Фон игры и стол (арт Ильи)
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'bg')
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-10);
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'table')
      .setDisplaySize(760, 520).setDepth(-5);

    // 2. Раунд и фаза
    this.roundText = this.add.text(20, 20, 'Раунд: —', { fontSize: '18px', color: '#ffffff' });
    this.phaseText = this.add.text(20, 50, 'Фаза: —', { fontSize: '18px', color: '#dddddd' });

    // 3. Карточка лота в центре стола
    this.itemCard = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(5);
    const cardBg = this.add.rectangle(0, 0, 320, 210, 0x1c1c24, 0.92).setStrokeStyle(2, 0xc9a961);
    this.itemImage = this.add.image(0, -45, `item_${ITEM_IDS[0]}`).setDisplaySize(64, 64);
    this.itemNameText = this.add.text(0, 5, 'Лот: ???', {
      fontSize: '22px', color: '#c9a961', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.itemDescText = this.add.text(0, 35, '', {
      fontSize: '14px', color: '#ffffff', align: 'center', wordWrap: { width: 290 }
    }).setOrigin(0.5);
    this.itemPierceBadge = this.add.text(0, 75, '⚡ ПРОБИВАЕТ БРОНЮ', {
      fontSize: '13px', color: '#ff5555', fontStyle: 'bold'
    }).setOrigin(0.5).setVisible(false);
    this.itemTargetHint = this.add.text(0, 93, '⚔ требует выбора цели', {
      fontSize: '13px', color: '#ffcc66'
    }).setOrigin(0.5).setVisible(false);
    this.itemCard.add([cardBg, this.itemImage, this.itemNameText, this.itemDescText, this.itemPierceBadge, this.itemTargetHint]);
    this.itemCard.setVisible(false);

    // 4. Места игроков: 0 = ТЫ (невидимый placeholder), места 1–3 = улитки соперников
    PLAYER_POSITIONS.forEach((pos, index) => {
      let seat: Phaser.GameObjects.GameObject;
      if (index === 0) {
        // ТЫ: спрайта нет вообще, только невидимая точка-якорь для имени/HP/душ
        seat = this.add.rectangle(pos.x, pos.y, 1, 1, 0x000000, 0);
      } else {
        seat = this.add.image(pos.x, pos.y, SNAIL_KEYS[index - 1])
          .setDisplaySize(130, 130);
      }
      seat.setDepth(-2);

      const nameText = this.add.text(pos.x, pos.y + 78, '...', {
        fontSize: '18px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);

      // 5 сердечек HP (Стадия 4: maxHp = 5)
      const hearts: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < 5; i++) {
        const heart = this.add.image(pos.x - 40 + i * 20, pos.y - 82, 'hp_icon')
          .setDisplaySize(18, 18).setAlpha(0.25);
        hearts.push(heart);
      }

      // Души: иконка + число (разведены по координатам)
      const soulIcon = this.add.image(pos.x - 30, pos.y - 58, 'soul_icon').setDisplaySize(18, 18);
      const soulsText = this.add.text(pos.x - 8, pos.y - 58, '0', {
        fontSize: '17px', color: '#c9a961', fontStyle: 'bold'
      }).setOrigin(0, 0.5);

      // Броня: раковина + число (иконку НЕ повторяем N раз)
      const armorIcon = this.add.image(pos.x - 30, pos.y - 36, 'armor_icon')
        .setDisplaySize(18, 18).setVisible(false);
      const armorText = this.add.text(pos.x - 8, pos.y - 36, '0', {
        fontSize: '17px', color: '#66ccff', fontStyle: 'bold'
      }).setOrigin(0, 0.5).setVisible(false);

      const statusText = this.add.text(pos.x, pos.y + 100, '', {
        fontSize: '14px', color: '#88ff88'
      }).setOrigin(0.5);

      this.playerObjects.push({ seat, nameText, hearts, soulIcon, soulsText, armorIcon, armorText, statusText });
    });

    // 5. Кнопка готовности (лобби)
    this.readyButton = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '[ Я ГОТОВ ]', {
      fontSize: '24px', color: '#ffffff', backgroundColor: '#333333', padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(10).setVisible(false);
    this.readyButton.on('pointerover', () => this.readyButton.setStyle({ color: '#c9a961' }));
    this.readyButton.on('pointerout', () => this.readyButton.setStyle({ color: '#ffffff' }));
    this.readyButton.on('pointerdown', () => this.toggleReady());

    // 6. Панель скрытой ставки
    this.betPanel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 80).setDepth(10);
    const betBg = this.add.rectangle(0, 0, 420, 80, 0x1c1c24, 0.92).setStrokeStyle(2, 0x666666);
    this.betPanel.add(this.add.text(-185, -12, 'Ваша ставка:', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5));
    const minusBtn = this.add.text(-110, -12, '[-]', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.betInputText = this.add.text(-60, -12, '0', { fontSize: '26px', color: '#c9a961', fontStyle: 'bold' }).setOrigin(0.5);
    const plusBtn = this.add.text(-10, -12, '[+]', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const submitBtn = this.add.text(120, -12, '[ СДЕЛАТЬ СТАВКУ ]', {
      fontSize: '16px', color: '#000000', backgroundColor: '#c9a961', padding: { x: 10, y: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.betErrorMsg = this.add.text(0, 26, '', { fontSize: '14px', color: '#ff5555' }).setOrigin(0.5);
    minusBtn.on('pointerdown', () => this.changeBet(-1));
    plusBtn.on('pointerdown', () => this.changeBet(1));
    submitBtn.on('pointerdown', () => this.submitBet());
    this.betPanel.add([betBg, minusBtn, this.betInputText, plusBtn, submitBtn, this.betErrorMsg]);
    this.betPanel.setVisible(false);

    // 7. Панель выбора цели + текст ожидания + таймер
    this.targetPanel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 90).setDepth(10);
    this.targetPanel.setVisible(false);
    this.targetWaitingText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 100, '', {
      fontSize: '20px', color: '#c9a961', fontStyle: 'italic'
    }).setOrigin(0.5).setDepth(10).setVisible(false);
    this.targetTimerText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 40, '', {
      fontSize: '15px', color: '#999999'
    }).setOrigin(0.5).setDepth(10).setVisible(false);

    // 8. Экран окончания партии
    this.gameOverPanel = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2).setDepth(100);
    const goBg = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.85);
    this.gameOverTitle = this.add.text(0, -70, '', { fontSize: '52px', color: '#c9a961', fontStyle: 'bold' }).setOrigin(0.5);
    this.gameOverSubtitle = this.add.text(0, -5, '', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5);
    const restartBtn = this.add.text(0, 80, '[ НОВАЯ ПАРТИЯ ]', {
      fontSize: '22px', color: '#000000', backgroundColor: '#c9a961', padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    restartBtn.on('pointerover', () => restartBtn.setStyle({ backgroundColor: '#e6c278' }));
    restartBtn.on('pointerout', () => restartBtn.setStyle({ backgroundColor: '#c9a961' }));
    restartBtn.on('pointerdown', () => this.restartGame());
    this.gameOverPanel.add([goBg, this.gameOverTitle, this.gameOverSubtitle, restartBtn]);
    this.gameOverPanel.setVisible(false);

    // 9. Журнал событий
    this.logText = this.add.text(20, 90, '', {
      fontSize: '13px', color: '#cccccc', fontFamily: 'monospace'
    });

    this.connectToServer();
  }

  // ================= СЕТЬ =================
  private async connectToServer() {
    try {
      this.client = new Client(getWebSocketUrl());
      this.room = await this.client.joinOrCreate('game', { name: this.playerName });
      this.addLog(`✓ Подключился! ID: ${this.room.sessionId}`);

      this.room.onStateChange(() => this.render());

      this.room.onMessage('event', (msg: any) => this.addLog(msg.text));

      this.room.onMessage('auction_result', (msg: any) => {
        const parts = Object.entries(msg.bets).map(([id, bet]) => {
          const p = this.room.state.players.get(id);
          return `${p ? p.name : id}: ${bet}`;
        });
        this.addLog(`🏆 Ставки раскрыты [${parts.join(', ')}]. Победитель: ${msg.winnerName} (${msg.winnerBet} душ)`);
      });

      this.room.onMessage('error', (msg: any) => {
        this.betErrorMsg.setText(msg.text);
        this.addLog(`❌ Ошибка: ${msg.text}`);
      });

      this.room.onLeave(() => this.addLog('✗ Соединение с комнатой закрыто.'));
    } catch (e: any) {
      console.error('Ошибка подключения:', e);
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Ошибка подключения к серверу!\nПроверь, что сервер запущен.', {
        fontSize: '22px', color: '#ff5555', align: 'center'
      }).setOrigin(0.5).setDepth(200);
    }
  }

  // ================= ОТРИСОВКА СОСТОЯНИЯ =================
  private render() {
    if (!this.room) return;
    const state = this.room.state;
    const me = state.players.get(this.room.sessionId);
    const phase: string = state.phase;

    // --- Раунд и фаза ---
    this.roundText.setText(phase === 'waiting' ? 'Раунд: —' : `Раунд: ${state.round}`);
    this.phaseText.setText(`Фаза: ${PHASE_LABELS[phase] || phase}`);

    // --- Карточка лота ---
    const showItem = ['item_reveal', 'betting', 'result', 'item_action', 'resolution'].includes(phase);
    this.itemCard.setVisible(showItem);
    if (showItem && state.itemId) {
      const key = `item_${state.itemId}`;
      if (this.textures.exists(key)) this.itemImage.setTexture(key).setDisplaySize(64, 64);
      this.itemNameText.setText(`Лот: ${state.itemName || '?'}`);
      this.itemDescText.setText(state.itemDesc || '');
      this.itemPierceBadge.setVisible(String(state.itemDesc || '').toLowerCase().includes('пробивает'));
      this.itemTargetHint.setVisible(Boolean(state.itemNeedsTarget));
    }

    // --- Сброс мест игроков ---
    this.playerObjects.forEach((obj) => {
      obj.seat.setVisible(false);
      obj.seat.setAlpha(1);
      obj.nameText.setText('');
      obj.nameText.setStyle({ color: '#ffffff' });
      obj.hearts.forEach((h) => { h.setAlpha(0.25); h.setVisible(false); });
      obj.soulIcon.setVisible(false);
      obj.soulsText.setText('0');
      obj.soulsText.setVisible(false);
      obj.armorIcon.setVisible(false);
      obj.armorText.setVisible(false);
      obj.statusText.setText('');
      if (obj.deadOverlay) {
        obj.deadOverlay.destroy();
        obj.deadOverlay = undefined;
      }
    });

    // --- Детерминированное распределение мест ---
    // Собираем всех игроков в массив
    const allPlayers: Array<{ sessionId: string; player: any }> = [];
    state.players.forEach((player: any, sessionId: string) => {
      allPlayers.push({ sessionId, player });
    });

    // Находим себя
    const myIndex = allPlayers.findIndex(p => p.sessionId === this.room.sessionId);
    if (myIndex === -1) return; // ещё не подключился

    // Мой объект всегда на позиции 0 (снизу)
    const myPlayer = allPlayers[myIndex];
    const myObj = this.playerObjects[0];
    this.fillPlayerSlot(myObj, myPlayer.player, myPlayer.sessionId, phase, true);

    // Соперники: сортируем по sessionId (детерминированно) и занимаем позиции 1, 2, 3
    const opponents = allPlayers
      .filter(p => p.sessionId !== this.room.sessionId)
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId));

    opponents.forEach((opp, idx) => {
      if (idx < 3) {
        const obj = this.playerObjects[idx + 1];
        this.fillPlayerSlot(obj, opp.player, opp.sessionId, phase, false);
      }
    });

    // --- Кнопка готовности ---
    this.readyButton.setVisible(phase === 'waiting');
    if (phase === 'waiting' && me) {
      this.readyButton.setText(me.ready ? '[ НЕ ГОТОВ ]' : '[ Я ГОТОВ ]');
    }

    // --- Панель ставок ---
    this.betPanel.setVisible(phase === 'betting' || phase === 'result');
    if (phase === 'betting' && me && me.hasBet) {
      this.betErrorMsg.setText('Скрытая ставка принята. Ожидание остальных...');
    } else if (phase !== 'betting') {
      this.betErrorMsg.setText('');
    }

    // --- Смена фазы: сброс ставки, панель цели, таймер ---
    if (phase !== this.lastPhase) {
      if (phase === 'betting') {
        this.currentBet = 0;
        this.betInputText.setText('0');
      }
      if (phase === 'item_action') {
        this.buildTargetPanel();
        this.startTargetTimer();
      } else {
        this.clearTargetPanel();
        this.stopTargetTimer();
      }
      this.lastPhase = phase;
    }

    // --- Экран финала ---
    if (phase === 'game_over') {
      this.showGameOver();
    } else {
      this.gameOverPanel.setVisible(false);
    }
  }

  // Заполняет одно место игроком
  private fillPlayerSlot(obj: PlayerUI, player: any, sessionId: string, phase: string, isMe: boolean) {
    // Для своего места (index 0) seat — это невидимый placeholder
    if (this.playerObjects.indexOf(obj) === 0) {
      obj.seat.setVisible(false);
    } else {
      obj.seat.setVisible(true);
    }

    obj.nameText.setText(player.name || '???');
    obj.nameText.setVisible(true);

    const hp = Math.max(0, Math.min(5, player.hp || 0));
    obj.hearts.forEach((h, i) => {
      h.setAlpha(i < hp ? 1 : 0.25);
      h.setVisible(true);
    });

    obj.soulIcon.setVisible(true);
    obj.soulsText.setText(String(player.souls));
    obj.soulsText.setVisible(true);

    if (player.armor > 0) {
      obj.armorIcon.setVisible(true);
      obj.armorText.setVisible(true);
      obj.armorText.setText(String(player.armor));
    }

    // Статусы по фазам
    if (phase === 'waiting') {
      obj.statusText.setText(player.ready ? '✓ ГОТОВ' : 'не готов');
    } else if (phase === 'betting') {
      obj.statusText.setText(player.hasBet ? 'ставка сделана (скрыта)' : 'думает...');
    } else if ((phase === 'result' || phase === 'resolution') && state.auctionWinnerId === sessionId) {
      obj.statusText.setText('🏆 выиграл лот');
    } else if (phase === 'item_action' && state.auctionWinnerId === sessionId) {
      obj.statusText.setText('⚔ выбирает цель');
    }

    // Мёртвые: затемняем, перечёркиваем
    if (player.alive === false) {
      obj.seat.setAlpha(0.35);
      obj.nameText.setStyle({ color: '#777777' });
      obj.statusText.setText('мёртв');
      obj.deadOverlay = this.add.text(
        (obj.seat as any).x, (obj.seat as any).y, '✗',
        { fontSize: '56px', color: '#ff3333', fontStyle: 'bold' }
      ).setOrigin(0.5).setDepth(6);
    }
  }

  // ================= ВЫБОР ЦЕЛИ =================
  private buildTargetPanel() {
    if (!this.room) return;
    const state = this.room.state;
    this.clearTargetPanel();

    if (state.auctionWinnerId !== this.room.sessionId) {
      const winner = state.players.get(state.auctionWinnerId);
      this.targetWaitingText.setText(`${winner ? winner.name : 'Победитель'} выбирает цель…`);
      this.targetWaitingText.setVisible(true);
      return;
    }

    const bg = this.add.rectangle(0, 0, 520, 110, 0x1c1c24, 0.95).setStrokeStyle(2, 0x8b0000);
    const title = this.add.text(0, -35, 'Выберите цель для предмета:', {
      fontSize: '18px', color: '#c9a961', fontStyle: 'bold'
    }).setOrigin(0.5);
    this.targetPanel.add([bg, title]);

    let btnX = -160;
    state.players.forEach((player: any, sessionId: string) => {
      if (sessionId === this.room.sessionId) return;
      if (player.alive === false) return;

      const btn = this.add.text(btnX, 15, `[ ${player.name} ]`, {
        fontSize: '17px', color: '#ffffff', backgroundColor: '#8b0000', padding: { x: 10, y: 6 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#a80000' }));
      btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#8b0000' }));
      btn.on('pointerdown', () => this.chooseTarget(sessionId));
      this.targetPanel.add(btn);
      btnX += 160;
    });

    this.targetPanel.setVisible(true);
  }

  private clearTargetPanel() {
    this.targetPanel.removeAll(true);
    this.targetPanel.setVisible(false);
    this.targetWaitingText.setVisible(false);
  }

  private startTargetTimer() {
    this.stopTargetTimer();
    this.targetSeconds = 10;
    this.targetTimerText.setText(`Осталось: ${this.targetSeconds} с`);
    this.targetTimerText.setVisible(true);
    this.targetTimer = this.time.addEvent({
      delay: 1000,
      repeat: 9,
      callback: () => {
        this.targetSeconds--;
        this.targetTimerText.setText(`Осталось: ${this.targetSeconds} с`);
      }
    });
  }

  private stopTargetTimer() {
    if (this.targetTimer) {
      this.targetTimer.destroy();
      this.targetTimer = undefined;
    }
    this.targetTimerText.setVisible(false);
  }

  // ================= ФИНАЛ =================
  private showGameOver() {
    if (!this.room) return;
    const state = this.room.state;

    if (state.gameWinnerId === this.room.sessionId) {
      this.gameOverTitle.setText('🏆 ВЫ ПОБЕДИЛИ!');
      this.gameOverSubtitle.setText('Ваша душа осталась последней.');
    } else if (state.gameWinnerId && state.gameWinnerId !== '') {
      const winner = state.players.get(state.gameWinnerId);
      this.gameOverTitle.setText('Партия окончена');
      this.gameOverSubtitle.setText(`Победитель: ${winner ? winner.name : '???'}`);
    } else {
      this.gameOverTitle.setText('НИЧЬЯ');
      this.gameOverSubtitle.setText('Победителя нет.');
    }
    this.gameOverPanel.setVisible(true);
  }

  // ================= ДЕЙСТВИЯ ИГРОКА =================
  private toggleReady() {
    if (!this.room) return;
    const me = this.room.state.players.get(this.room.sessionId);
    if (me) this.room.send('ready', { value: !me.ready });
  }

  private changeBet(delta: number) {
    if (!this.room) return;
    const me = this.room.state.players.get(this.room.sessionId);
    if (!me || me.hasBet) return;
    this.currentBet = Phaser.Math.Clamp(this.currentBet + delta, 0, me.souls);
    this.betInputText.setText(String(this.currentBet));
    this.betErrorMsg.setText('');
  }

  private submitBet() {
    if (!this.room) return;
    const me = this.room.state.players.get(this.room.sessionId);
    if (!me || me.hasBet) return;
    this.room.send('bet', { amount: this.currentBet });
  }

  private chooseTarget(targetId: string) {
    if (!this.room) return;
    this.room.send('choose_target', { targetId });
    this.addLog('✓ Цель выбрана.');
    this.clearTargetPanel();
    this.stopTargetTimer();
  }

  private restartGame() {
    if (!this.room) return;
    this.room.send('restart');
    this.gameOverPanel.setVisible(false);
  }

  private addLog(text: string) {
    this.logMessages.unshift(text);
    if (this.logMessages.length > 10) this.logMessages.pop();
    this.logText.setText(this.logMessages.join('\n'));
  }
}