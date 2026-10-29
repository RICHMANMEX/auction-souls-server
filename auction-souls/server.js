// Сервер «Аукциона Душ».
// Запуск: npm start  (обычный режим, порт 2567)
// Для тестов порт можно изменить переменной окружения PORT.
const path = require("node:path");
const express = require("express");
const { Server } = require("colyseus");

const { GameRoom } = require("./rooms/GameRoom");

const PORT = Number(process.env.PORT) || 2567;

const gameServer = new Server({
    // Колбэк получает готовое Express-приложение транспорта.
    // Через него раздаём клиент игры и браузерный SDK (глобальная переменная Colyseus).
    express: (app) => {
        app.use(express.static(path.join(__dirname, "public")));
        app.use("/sdk", express.static(path.join(__dirname, "node_modules/@colyseus/sdk/dist")));
    },
});

// Игровая комната с именем "game" — его указывает клиент при подключении.
gameServer.define("game", GameRoom);

gameServer.listen(PORT).then(() => {
    console.log("Сервер запущен: http://localhost:" + PORT);
    console.log("Игровая комната: game (до 4 игроков). Откройте страницу в браузере.");
});
