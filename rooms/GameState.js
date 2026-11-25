const { Schema, MapSchema, type } = require("@colyseus/schema");
const { PlayerState } = require("./PlayerState");

// waiting -> item_reveal -> betting -> result -> [item_action] -> resolution -> ... -> game_over
class GameState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
        this.round = 1;
        this.phase = "waiting";
        this.itemId = "";
        this.itemName = "";
        this.itemDesc = "";
        this.itemNeedsTarget = false;
        this.auctionWinnerId = "";
        this.gameWinnerId = "";
    }
}

type({ map: PlayerState })(GameState.prototype, "players");
type("number")(GameState.prototype, "round");
type("string")(GameState.prototype, "phase");
type("string")(GameState.prototype, "itemId");
type("string")(GameState.prototype, "itemName");
type("string")(GameState.prototype, "itemDesc");
type("boolean")(GameState.prototype, "itemNeedsTarget");
type("string")(GameState.prototype, "auctionWinnerId");
type("string")(GameState.prototype, "gameWinnerId");

module.exports = { GameState };