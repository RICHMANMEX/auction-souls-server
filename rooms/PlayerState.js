const { Schema, type } = require("@colyseus/schema");

// Стартовые характеристики игрока (правила MVP).
const START_HP = 3;
const START_SOULS = 10;

// Состояние одного игрока (Стадия 3).
// Эти поля видны ВСЕМ клиентам, поэтому здесь нет суммы текущей ставки —
// ставки хранятся в приватной переменной комнаты (this.bets в GameRoom)
// и раскрываются только после закрытия приёма ставок.
class PlayerState extends Schema {
    constructor() {
        super();

        this.name = "Безымянный";  // отображаемое имя
        this.hp = START_HP;        // текущее здоровье
        this.maxHp = START_HP;     // максимальное здоровье
        this.souls = START_SOULS;  // души (игровая валюта для ставок)
        this.alive = true;         // жив ли игрок
        this.ready = false;        // готовность в лобби
        this.hasBet = false;       // сделал ли ставку в текущем раунде (сама сумма скрыта)
    }
}

// Регистрация полей для синхронизации @colyseus/schema.
type("string")(PlayerState.prototype, "name");
type("number")(PlayerState.prototype, "hp");
type("number")(PlayerState.prototype, "maxHp");
type("number")(PlayerState.prototype, "souls");
type("boolean")(PlayerState.prototype, "alive");
type("boolean")(PlayerState.prototype, "ready");
type("boolean")(PlayerState.prototype, "hasBet");

module.exports = { PlayerState, START_HP, START_SOULS };
