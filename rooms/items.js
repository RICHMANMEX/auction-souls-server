// Каталог предметов «Аукциона Душ» (правила MVP).
// На стадии 3 предметы выступают лотами аукциона (передаются клиентам в фазе item_reveal).
// Боевые эффекты предметов и фаза выбора цели (needsTarget) реализуются на стадии 4.
const ITEMS = [
    {
        id: "bandage",
        name: "Бинт",
        desc: "Восстанавливает 1 HP (не выше максимума).",
        needsTarget: false,
    },
    {
        id: "shield",
        name: "Щит",
        desc: "Даёт 1 заряд защиты на следующий удар.",
        needsTarget: false,
    },
    {
        id: "dagger",
        name: "Кинжал",
        desc: "Наносит 1 HP урона выбранному сопернику (блокируется щитом).",
        needsTarget: true,
    },
    {
        id: "soul_thief",
        name: "Похититель душ",
        desc: "Забирает у выбранного соперника до 2 душ.",
        needsTarget: true,
    },
    {
        id: "black_market",
        name: "Чёрный рынок",
        desc: "Даёт 2 дополнительные души.",
        needsTarget: false,
    },
    {
        id: "curse",
        name: "Проклятие",
        desc: "Наносит 1 HP урона выбранному сопернику (игнорирует щит).",
        needsTarget: true,
    },
];

module.exports = { ITEMS };
