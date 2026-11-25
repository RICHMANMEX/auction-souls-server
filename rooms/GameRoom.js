const { Room } = require("colyseus");
const { GameState } = require("./GameState");
const { PlayerState, START_HP, START_SOULS, MAX_ARMOR } = require("./PlayerState");
const { ITEMS } = require("./items");

const TIMINGS = {
    normal: { itemReveal: 3000, betting: 15000, result: 5000, itemAction: 10000, resolution: 2500 },
    fast: { itemReveal: 200, betting: 1000, result: 400, itemAction: 1000, resolution: 200 },
};

const MIN_PLAYERS = 2;

class GameRoom extends Room {
    onCreate(options) {
        this.maxClients = 4;
        this.setState(new GameState());
        this.timings = options && options.fastTimings ? TIMINGS.fast : TIMINGS.normal;

        // itemSequence нужен автотесту: фиксированные лоты вместо случайных,
        // чтобы проверять эффекты точными числами
        this.itemSequence = options && Array.isArray(options.itemSequence) && options.itemSequence.length
            ? options.itemSequence
            : null;

        // суммы ставок вне схемы, иначе schema разошлёт их всем до раскрытия
        this.bets = new Map();
        this.turnOrder = [];

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
                this.sendError(client, "Погибшие игроки не делают ставки.");
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

            this.bets.set(client.sessionId, amount);
            player.hasBet = true;
            this.broadcastEvent(`${player.name} сделал скрытую ставку.`);
            this.tryCloseBetting();
        });

        this.onMessage("choose_target", (client, message) => {
            if (this.state.phase !== "item_action") {
                this.sendError(client, "Сейчас не время выбирать цель.");
                return;
            }
            if (client.sessionId !== this.state.auctionWinnerId) {
                this.sendError(client, "Цель выбирает только победитель аукциона.");
                return;
            }
            const targetId = message && message.targetId;
            const target = this.state.players.get(targetId);
            if (!target || !target.alive || targetId === client.sessionId) {
                this.sendError(client, "Недопустимая цель: игрок не существует, погиб или это вы сами.");
                return;
            }
            this.applyTarget(targetId);
        });

        this.onMessage("restart", (client) => {
            if (this.state.phase !== "game_over") {
                this.sendError(client, "Перезапустить можно только оконченную партию.");
                return;
            }
            this.restartMatch();
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
        const wasAuctionWinner = this.state.auctionWinnerId === client.sessionId;

        this.state.players.delete(client.sessionId);
        this.turnOrder = this.turnOrder.filter((id) => id !== client.sessionId);
        this.bets.delete(client.sessionId);

        console.log(`[Комната ${this.roomId}] ${name} отключился.`);

        if (this.state.phase === "waiting" || this.state.phase === "game_over") {
            this.broadcastEvent(`${name} покинул комнату.`);
            if (this.state.phase === "waiting") this.tryStartMatch();
            return;
        }

        this.broadcastEvent(`${name} покинул матч.`);

        if (this.aliveIds().length <= 1) {
            this.endMatch();
            return;
        }
        if (this.state.phase === "betting") {
            this.tryCloseBetting();
            return;
        }
        // иначе фаза выбора цели зависнет до таймера
        if (this.state.phase === "item_action" && wasAuctionWinner) {
            this.autoChooseTarget();
        }
    }

    onDispose() {
        console.log(`[Комната ${this.roomId}] закрыта.`);
    }

    tryStartMatch() {
        if (this.state.phase !== "waiting") return;
        if (this.state.players.size < MIN_PLAYERS) return;
        for (const player of this.state.players.values()) {
            if (!player.ready) return;
        }
        this.startMatch();
    }

    startMatch() {
        this.lock();
        this.state.round = 1;
        this.state.gameWinnerId = "";
        this.broadcastEvent("Все игроки готовы — матч начинается!");
        this.beginRound();
    }

    // взвешенный выбор: сильные лоты выпадают реже
    pickItem() {
        if (this.itemSequence) {
            const index = (this.state.round - 1) % this.itemSequence.length;
            const forced = ITEMS.find((i) => i.id === this.itemSequence[index]);
            if (forced) return forced;
        }
        const pool = ITEMS.filter((i) => i.id !== this.state.itemId);
        const total = pool.reduce((sum, i) => sum + i.weight, 0);
        let roll = Math.random() * total;
        for (const item of pool) {
            roll -= item.weight;
            if (roll <= 0) return item;
        }
        return pool[pool.length - 1];
    }

    beginRound() {
        if (this.aliveIds().length <= 1) {
            this.endMatch();
            return;
        }

        const item = this.pickItem();
        this.state.itemId = item.id;
        this.state.itemName = item.name;
        this.state.itemDesc = item.desc;
        this.state.itemNeedsTarget = item.needsTarget;
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
        // таймер и последний bet могут дёрнуть метод одновременно
        if (this.state.phase !== "betting") return;

        const order = this.aliveIds();
        if (order.length === 0) {
            this.endMatch();
            return;
        }

        for (const id of order) {
            if (!this.bets.has(id)) this.bets.set(id, 0);
        }

        // сдвиг очереди каждый раунд, чтобы первый вошедший не выигрывал ничьи вечно
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
        winner.souls -= winnerBet;
        this.state.auctionWinnerId = winnerId;
        this.setPhase("result");

        const revealed = {};
        for (const [id, bet] of this.bets) revealed[id] = bet;

        this.broadcast("auction_result", {
            bets: revealed,
            winnerId,
            winnerName: winner.name,
            winnerBet,
        });
        this.broadcastEvent(`${winner.name} выигрывает лот «${this.state.itemName}» за ${winnerBet} душ.`);

        this.schedule("result", this.timings.result, () => this.applyItemEffect());
    }

    applyItemEffect() {
        if (this.state.phase !== "result") return;

        const item = ITEMS.find((i) => i.id === this.state.itemId);
        const winner = this.state.players.get(this.state.auctionWinnerId);
        if (!item || !winner || !winner.alive) {
            this.finishRound();
            return;
        }

        if (item.needsTarget) {
            this.setPhase("item_action");
            this.broadcastEvent(`${winner.name} выбирает цель для «${item.name}».`);
            this.schedule("item_action", this.timings.itemAction, () => this.autoChooseTarget());
            return;
        }

        if (item.heal) {
            const before = winner.hp;
            winner.hp = Math.min(winner.hp + item.heal, winner.maxHp);
            this.broadcastEvent(`${winner.name} восстанавливает ${winner.hp - before} HP (${item.name}).`);
        }
        if (item.armor) {
            const before = winner.armor;
            winner.armor = Math.min(winner.armor + item.armor, MAX_ARMOR);
            this.broadcastEvent(`${winner.name}: броня ${winner.armor} (+${winner.armor - before}).`);
        }
        if (item.souls) {
            winner.souls += item.souls;
            this.broadcastEvent(`${winner.name} получает ${item.souls} души (${item.name}).`);
        }

        this.finishRound();
    }

    autoChooseTarget() {
        if (this.state.phase !== "item_action") return;
        const others = this.aliveIds().filter((id) => id !== this.state.auctionWinnerId);
        if (others.length === 0) {
            this.finishRound();
            return;
        }
        const targetId = others[Math.floor(Math.random() * others.length)];
        this.broadcastEvent("Время выбора цели вышло — цель выбрана автоматически.");
        this.applyTarget(targetId);
    }

    applyTarget(targetId) {
        if (this.state.phase !== "item_action") return;

        const item = ITEMS.find((i) => i.id === this.state.itemId);
        const winner = this.state.players.get(this.state.auctionWinnerId);
        const target = this.state.players.get(targetId);
        if (!item || !winner || !target || !target.alive) {
            this.finishRound();
            return;
        }

        if (item.steal) {
            const stolen = Math.min(item.steal, target.souls);
            target.souls -= stolen;
            winner.souls += stolen;
            this.broadcastEvent(`${winner.name} крадёт ${stolen} душ(и) у ${target.name}.`);
        }
        if (item.damage) {
            this.broadcastEvent(`${winner.name} применяет «${item.name}» к ${target.name}.`);
            this.damagePlayer(target, item.damage, item.pierces === true);
        }

        this.finishRound();
    }

    // броня вычитается из урона и тратится на величину урона;
    // пробивающий урон проходит мимо брони и не расходует её
    damagePlayer(target, dmg, pierces) {
        let toHp = dmg;

        if (!pierces && target.armor > 0) {
            const absorbed = Math.min(target.armor, dmg);
            target.armor -= absorbed;
            toHp = dmg - absorbed;
            this.broadcastEvent(`Броня ${target.name} гасит ${absorbed} урона (броня: ${target.armor}).`);
            if (toHp <= 0) return;
        }

        target.hp = Math.max(0, target.hp - toHp);
        this.broadcastEvent(`${target.name} получает ${toHp} урона (HP: ${target.hp}).`);
        if (target.hp <= 0) {
            target.alive = false;
            this.broadcastEvent(`${target.name} погибает.`);
        }
    }

    finishRound() {
        this.setPhase("resolution");
        this.schedule("resolution", this.timings.resolution, () => {
            if (this.aliveIds().length <= 1) {
                this.endMatch();
            } else {
                this.state.round += 1;
                this.beginRound();
            }
        });
    }

    endMatch() {
        this.setPhase("game_over");
        const alive = this.aliveIds();

        if (alive.length === 1) {
            const winner = this.state.players.get(alive[0]);
            this.state.gameWinnerId = alive[0];
            this.broadcastEvent(`Партия окончена. Победитель: ${winner.name}!`);
            console.log(`[Комната ${this.roomId}] партия завершена. Победитель: ${winner.name}.`);
        } else {
            this.state.gameWinnerId = "";
            this.broadcastEvent("Партия окончена. Живых не осталось — ничья.");
            console.log(`[Комната ${this.roomId}] партия завершена ничьей.`);
        }
    }

    restartMatch() {
        for (const player of this.state.players.values()) {
            player.hp = START_HP;
            player.souls = START_SOULS;
            player.alive = true;
            player.ready = false;
            player.armor = 0;
            player.hasBet = false;
        }

        this.bets.clear();
        this.state.round = 1;
        this.state.itemId = "";
        this.state.itemName = "";
        this.state.itemDesc = "";
        this.state.itemNeedsTarget = false;
        this.state.auctionWinnerId = "";
        this.state.gameWinnerId = "";

        this.setPhase("waiting");
        this.unlock();
        this.broadcastEvent("Новая партия! Все игроки вернулись в лобби.");
    }

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

    // таймер срабатывает только если фаза не сменилась досрочно
    schedule(expectedPhase, ms, fn) {
        this.clock.setTimeout(() => {
            if (this.state.phase === expectedPhase) fn();
        }, ms);
    }

    broadcastEvent(text) {
        this.broadcast("event", { text });
        console.log(`[Комната ${this.roomId}] ${text}`);
    }

    sendError(client, text) {
        if (client) client.send("error", { text });
    }
}

module.exports = { GameRoom };