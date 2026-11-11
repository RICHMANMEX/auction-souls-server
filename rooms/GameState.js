const { Schema, MapSchema, type } = require("@colyseus/schema");
const { PlayerState } = require("./PlayerState");

// Общее состояние партии, которое сервер синхронизирует со всеми клиентами (Стадия 3).
// Фазы стадии 3: waiting -> item_reveal -> betting -> result -> следующий раунд.
// Применение боевых эффектов предметов, выбывание и game_over — задача стадии 4.
class GameState extends Schema {
    constructor() {
        super();

        this.players = new MapSchema();   // игроки по ключу sessionId
        this.round = 1;                   // номер текущего раунда
        this.phase = "waiting";           // текущая фаза игры

        this.itemId = "";                 // идентификатор лота текущего раунда
        this.itemName = "";               // название лота
        this.itemDesc = "";               // описание лота

        this.auctionWinnerId = "";        // sessionId победителя последнего аукциона
    }
}

type({ map: PlayerState })(GameState.prototype, "players");
type("number")(GameState.prototype, "round");
type("string")(GameState.prototype, "phase");
type("string")(GameState.prototype, "itemId");
type("string")(GameState.prototype, "itemName");
type("string")(GameState.prototype, "itemDesc");
type("string")(GameState.prototype, "auctionWinnerId");

module.exports = { GameState };
