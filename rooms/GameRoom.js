const { Room } = require("colyseus");
const { GameState } = require("./GameState");
const { PlayerState, START_HP, START_SOULS } = require("./PlayerState");
const { ITEMS } = require("./items");

// Паузы между фазами (миллисекунды).
// fastTimings: true используется автотестом для быстрой проверки логики.
const TIMINGS = {
    normal: { itemReveal: 3000, betting: 15000, result: 5000 },
    fast: { itemReveal: 200, betting: 1000, result: 400 },
};

// Минимальное количество игроков для старта матча.
const MIN_PLAYERS = 2;

// Игровая комната «Аукциона Душ» — Стадия 3 (сетевой прототип и основная логика аукциона).
// Реализованы: старт по готовности, блокировка комнаты, показ лота, приём и валидация
// скрытых ставок, определение победителя с разрешением ничьих, списание душ и обработка отключений.
// Боевые эффекты предметов, выбор цели, выбывание и финал матча — задача Стадии 4.
class GameRoom extends Room {

    onCreate(options) {
        this.maxClients = 4;
        this.setState(new GameState());

        this.timings = options && options.fastTimings ? TIMINGS.fast : TIMINGS.normal;

        // Скрытые ставки текущего раунда: sessionId -> сумма ставки.
        // Хранится в обычной переменной комнаты, а НЕ в схеме state,
        // поэтому клиенты физически не могут подсмотреть чужие ставки до раскрытия.
        this.bets = new Map();

        // Порядок игроков по времени входа — используется для честного разрешения ничьих.
        this.turnOrder = [];

        // ---------- Обработчики сообщений от клиентов ----------

        this.onMessage("ready", (client, message) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            if (this.state.phase !== "waiting") {
                this.sendError(client, "Матч уже начался — готовность изменить нельзя.");
                return;
            }

            player.ready = Boolean(message && message.value);
            this.broadcastEvent(`${player.name}: ${player.ready ? "готов" : "не готов"}`);
            this.tryStartMatch();
        });

        this.onMessage("bet", (client, message) => {
            const player = this.state.players.get(client.sessionId);

            if (this.state.phase !== "betting") {
                this.sendError(client, "Сейчас не фаза ставок.");
                return;
            }
            if (!player || !player.alive) {
                this.sendError(client, "Игрок не может делать ставку.");
                return;
            }
            if (this.bets.has(client.sessionId)) {
                this.sendError(client, "Ставка в этом раунде уже сделана и не может быть изменена.");
                return;
            }

            const amount = message && message.amount;
            if (!Number.isInteger(amount) || amount < 0 || amount > player.souls) {
                this.sendError(client, `Недопустимая ставка. Нужно целое число от 0 до ${player.souls}.`);
                return;
            }

            // Ставка принята: сумма сохраняется приватно на сервере, в state виден только флаг hasBet.
            this.bets.set(client.sessionId, amount);
            player.hasBet = true;
            this.broadcastEvent(`${player.name} сделал скрытую ставку.`);
            this.tryCloseBetting();
        });

        console.log(`[Комната ${this.roomId}] создана (тайминги: ${options && options.fastTimings ? "быстрые, тест" : "обычные"}).`);
    }

    onJoin(client, options) {
        if (this.state.phase !== "waiting") {
            throw new Error("Матч уже идёт — подключение к активной партии запрещено.");
        }

        const player = new PlayerState();
        const rawName = options && typeof options.name === "string" ? options.name.trim().slice(0, 20) : "";
        player.name = rawName || `Игрок ${this.state.players.size + 1}`;

        this.state.players.set(client.sessionId, player);
        this.turnOrder.push(client.sessionId);

        this.broadcastEvent(`${player.name} вошёл в комнату.`);
        console.log(`[Комната ${this.roomId}] ${player.name} подключился (${client.sessionId}). Игроков: ${this.state.players.size}`);
    }

    onLeave(client) {
        const player = this.state.players.get(client.sessionId);
        const name = player ? player.name : client.sessionId;

        this.state.players.delete(client.sessionId);
        this.turnOrder = this.turnOrder.filter((id) => id !== client.sessionId);
        this.bets.delete(client.sessionId);
        console.log(`[Комната ${this.roomId}] ${name} отключился.`);

        if (this.state.phase === "waiting") {
            this.broadcastEvent(`${name} покинул комнату.`);
            this.tryStartMatch();
            return;
        }

        // Отключение во время активного матча
        this.broadcastEvent(`${name} покинул матч.`);

        // Если в комнате остался только один участник — возвращаем комнату в лобби
        if (this.aliveIds().length < MIN_PLAYERS) {
            this.broadcastEvent("Недостаточно игроков для продолжения. Возврат в лобби.");
            this.resetToLobby();
            return;
        }

        // Если ждали только ставку вышедшего игрока — завершаем приём ставок досрочно
        if (this.state.phase === "betting") {
            this.tryCloseBetting();
        }
    }

    onDispose() {
        console.log(`[Комната ${this.roomId}] закрыта.`);
    }

    // ---------- Управление матчем и раундами ----------

    tryStartMatch() {
        if (this.state.phase !== "waiting") return;
        if (this.state.players.size < MIN_PLAYERS) return;
        for (const player of this.state.players.values()) {
            if (!player.ready) return;
        }
        this.startMatch();
    }

    startMatch() {
        this.lock(); // блокируем комнату на время матча
        this.state.round = 1;
        this.broadcastEvent("Все игроки готовы — матч начинается!");
        this.beginRound();
    }

    beginRound() {
        if (this.aliveIds().length < MIN_PLAYERS) {
            this.resetToLobby();
            return;
        }

        // Выбираем случайный лот, не повторяющий лот прошлого раунда
        let item;
        do {
            item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        } while (ITEMS.length > 1 && item.id === this.state.itemId);

        this.state.itemId = item.id;
        this.state.itemName = item.name;
        this.state.itemDesc = item.desc;
        this.state.auctionWinnerId = "";

        this.bets.clear();
        for (const player of this.state.players.values()) {
            player.hasBet = false;
        }

        this.setPhase("item_reveal");
        this.broadcastEvent(`Раунд ${this.state.round}. Лот: «${item.name}».`);
        this.schedule("item_reveal", this.timings.itemReveal, () => this.openBetting());
    }

    openBetting() {
        this.setPhase("betting");
        this.broadcastEvent("Приём скрытых ставок открыт.");
        this.schedule("betting", this.timings.betting, () => this.closeBetting());
    }

    tryCloseBetting() {
        for (const id of this.aliveIds()) {
            if (!this.bets.has(id)) return;
        }
        this.closeBetting();
    }

    closeBetting() {
        if (this.state.phase !== "betting") return;

        const order = this.aliveIds();
        if (order.length === 0) {
            this.resetToLobby();
            return;
        }

        // Игрокам, не сделавшим ставку до истечения таймера, засчитывается ставка 0
        for (const id of order) {
            if (!this.bets.has(id)) this.bets.set(id, 0);
        }

        // Детерминированное разрешение ничьих: циклический сдвиг приоритета входа на (round - 1)
        const offset = (this.state.round - 1) % order.length;
        const rotated = order.slice(offset).concat(order.slice(0, offset));

        let winnerId = rotated[0];
        let winnerBet = this.bets.get(winnerId) || 0;
        for (const id of rotated) {
            const bet = this.bets.get(id) || 0;
            if (bet > winnerBet) {
                winnerId = id;
                winnerBet = bet;
            }
        }

        const winner = this.state.players.get(winnerId);

        // Списание душ только у победителя аукциона
        winner.souls -= winnerBet;
        this.state.auctionWinnerId = winnerId;
        this.setPhase("result");

        const revealed = {};
        for (const [id, bet] of this.bets) {
            revealed[id] = bet;
        }

        this.broadcast("auction_result", {
            bets: revealed,
            winnerId,
            winnerName: winner.name,
            winnerBet,
        });
        this.broadcastEvent(`${winner.name} выигрывает лот «${this.state.itemName}» за ${winnerBet} душ.`);

        this.schedule("result", this.timings.result, () => this.nextRound());
    }

    nextRound() {
        if (this.state.phase !== "result") return;
        this.state.round += 1;
        this.beginRound();
    }

    resetToLobby() {
        this.bets.clear();
        this.state.round = 1;
        this.state.itemId = "";
        this.state.itemName = "";
        this.state.itemDesc = "";
        this.state.auctionWinnerId = "";

        for (const player of this.state.players.values()) {
            player.hp = START_HP;
            player.souls = START_SOULS;
            player.alive = true;
            player.ready = false;
            player.hasBet = false;
        }

        this.setPhase("waiting");
        this.unlock();
    }

    // ---------- Вспомогательные методы ----------

    aliveIds() {
        return this.turnOrder.filter((id) => {
            const player = this.state.players.get(id);
            return player && player.alive;
        });
    }

    setPhase(phase) {
        this.state.phase = phase;
        console.log(`[Комната ${this.roomId}] фаза: ${phase} (раунд ${this.state.round})`);
    }

    schedule(expectedPhase, ms, fn) {
        this.clock.setTimeout(() => {
            if (this.state.phase === expectedPhase) {
                fn();
            }
        }, ms);
    }

    broadcastEvent(text) {
        this.broadcast("event", { text });
        console.log(`[Комната ${this.roomId}] ${text}`);
    }

    sendError(client, text) {
        client.send("error", { text });
    }
}

module.exports = { GameRoom };
