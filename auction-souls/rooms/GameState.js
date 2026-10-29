const { Schema, MapSchema, type } = require("@colyseus/schema");
const { PlayerState } = require("./PlayerState");

// Общее состояние комнаты, которое сервер рассылает всем клиентам.
// Стадия 2: только лобби (фаза waiting) и состав игроков.
// Поля предмета раунда, победителя аукциона и ставки — план стадии 3.
class GameState extends Schema {
    constructor() {
        super();

        this.players = new MapSchema();   // игроки по ключу sessionId
        this.round = 1;                   // номер раунда (зарезервирован)
        this.phase = "waiting";           // текущая фаза: пока только ожидание
    }
}

type({ map: PlayerState })(GameState.prototype, "players");
type("number")(GameState.prototype, "round");
type("string")(GameState.prototype, "phase");

module.exports = { GameState };
