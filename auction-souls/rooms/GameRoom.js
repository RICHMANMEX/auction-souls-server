const { Room } = require("colyseus");
const { GameState } = require("./GameState");
const { PlayerState } = require("./PlayerState");

// Игровая комната. Стадия 2 — базовая инфраструктура:
// создание комнаты, подключение/отключение игроков, готовность в лобби.
// Игровой цикл (предмет, ставки, аукцион) — задача стадии 3.
class GameRoom extends Room {

    onCreate(options) {
        this.maxClients = 4;
        this.setState(new GameState());

        // Единственное действие клиента на этой стадии — готовность в лобби.
        this.onMessage("ready", (client, message) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;

            player.ready = Boolean(message && message.value);
            this.broadcastEvent(`${player.name}: ${player.ready ? "готов" : "не готов"}`);

            // Старт матча будет реализован на стадии 3, когда появится игровой цикл.
        });

        console.log(`[Комната ${this.roomId}] создана.`);
    }

    onJoin(client, options) {
        const player = new PlayerState();

        // Имя приходит в параметрах подключения: client.joinOrCreate("game", { name: "..." })
        const rawName = options && typeof options.name === "string" ? options.name.trim().slice(0, 20) : "";
        player.name = rawName || `Игрок ${this.state.players.size + 1}`;

        this.state.players.set(client.sessionId, player);

        this.broadcastEvent(`${player.name} вошёл в комнату.`);
        console.log(`[Комната ${this.roomId}] ${player.name} подключился (${client.sessionId}). Игроков: ${this.state.players.size}`);
    }

    onLeave(client) {
        const player = this.state.players.get(client.sessionId);
        const name = player ? player.name : client.sessionId;

        this.state.players.delete(client.sessionId);

        this.broadcastEvent(`${name} покинул комнату.`);
        console.log(`[Комната ${this.roomId}] ${name} отключился.`);
    }

    onDispose() {
        console.log(`[Комната ${this.roomId}] закрыта.`);
    }

    broadcastEvent(text) {
        this.broadcast("event", { text });
        console.log(`[Комната ${this.roomId}] ${text}`);
    }
}

module.exports = { GameRoom };
