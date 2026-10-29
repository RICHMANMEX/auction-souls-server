const { Schema, type } = require("@colyseus/schema");

// Стартовые характеристики игрока (правила MVP, стадия 2).
const START_HP = 3;
const START_SOULS = 10;

// Состояние одного игрока. Поля видны всем клиентам.
// Поля щита и ставки появятся на следующих стадиях (вместе с механиками).
class PlayerState extends Schema {
    constructor() {
        super();

        this.name = "Безымянный";  // отображаемое имя
        this.hp = START_HP;        // текущее здоровье
        this.maxHp = START_HP;     // максимальное здоровье
        this.souls = START_SOULS;  // души (игровая валюта)
        this.alive = true;         // жив ли игрок
        this.ready = false;        // готовность в лобби
    }
}

// Регистрация полей для синхронизации @colyseus/schema.
type("string")(PlayerState.prototype, "name");
type("number")(PlayerState.prototype, "hp");
type("number")(PlayerState.prototype, "maxHp");
type("number")(PlayerState.prototype, "souls");
type("boolean")(PlayerState.prototype, "alive");
type("boolean")(PlayerState.prototype, "ready");

module.exports = { PlayerState, START_HP, START_SOULS };
