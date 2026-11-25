// Эффекты описаны данными, применение — в GameRoom.applyItemEffect / applyTarget.
// Новый лот добавляется одной записью, код комнаты менять не нужно.
// weight — относительная частота выпадения.
// armor — сколько единиц урона добавляет раковина (броня копится, лимит MAX_ARMOR).
// pierces: true — урон идёт мимо брони и не расходует её.
const ITEMS = [
    {
        id: "fork",
        name: "Вилка",
        desc: "1 урон выбранному сопернику. Гасится бронёй.",
        weight: 24, needsTarget: true, damage: 1, pierces: false,
    },
    {
        id: "coral",
        name: "Испорченный коралл",
        desc: "1 урон выбранному сопернику. Пробивает броню, не расходуя её.",
        weight: 16, needsTarget: true, damage: 1, pierces: true,
    },
    {
        id: "trident",
        name: "Трезубец",
        desc: "2 урона выбранному сопернику. Броня вычитается из урона.",
        weight: 12, needsTarget: true, damage: 2, pierces: false,
    },
    {
        id: "legend_trident",
        name: "Легендарный трезубец",
        desc: "3 урона выбранному сопернику. Пробивает броню, не расходуя её.",
        weight: 5, needsTarget: true, damage: 3, pierces: true,
    },
    {
        id: "shell_1",
        name: "Раковина I",
        desc: "+1 к броне. Броня вычитается из входящего урона.",
        weight: 10, needsTarget: false, armor: 1,
    },
    {
        id: "shell_2",
        name: "Раковина II",
        desc: "+2 к броне. Всего брони не больше 6.",
        weight: 4, needsTarget: false, armor: 2,
    },
    {
        id: "shell_3",
        name: "Раковина III",
        desc: "+3 к броне. Всего брони не больше 6.",
        weight: 2, needsTarget: false, armor: 3,
    },
    {
        id: "potion",
        name: "Зелье глубин",
        desc: "Восстанавливает 1 HP, не выше максимума.",
        weight: 8, needsTarget: false, heal: 1,
    },
    {
        id: "white_pearl",
        name: "Белая жемчужина",
        desc: "+2 души победителю аукциона.",
        weight: 9, needsTarget: false, souls: 2,
    },
    {
        id: "black_pearl",
        name: "Чёрная жемчужина",
        desc: "Крадёт у выбранного соперника до 2 душ.",
        weight: 9, needsTarget: true, steal: 2,
    },
];

module.exports = { ITEMS };