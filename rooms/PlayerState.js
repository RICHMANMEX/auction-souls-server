const { Schema, type } = require("@colyseus/schema");

// 5 HP: легендарка (3 урона) не убивает с полного, но оставляет 2.
const START_HP = 5;
const START_SOULS = 10;
// броня измеряется в единицах урона, а не в «гашениях ударов»;
// лимит нужен, иначе можно накопить непробиваемый запас
const MAX_ARMOR = 6;

class PlayerState extends Schema {
    constructor() {
        super();
        this.name = "Безымянный";
        this.hp = START_HP;
        this.maxHp = START_HP;
        this.souls = START_SOULS;
        this.alive = true;
        this.ready = false;
        this.hasBet = false;
        this.armor = 0;
    }
}

// суммы ставки здесь нет намеренно: всё из схемы улетает всем клиентам
type("string")(PlayerState.prototype, "name");
type("number")(PlayerState.prototype, "hp");
type("number")(PlayerState.prototype, "maxHp");
type("number")(PlayerState.prototype, "souls");
type("boolean")(PlayerState.prototype, "alive");
type("boolean")(PlayerState.prototype, "ready");
type("boolean")(PlayerState.prototype, "hasBet");
type("number")(PlayerState.prototype, "armor");

module.exports = { PlayerState, START_HP, START_SOULS, MAX_ARMOR };