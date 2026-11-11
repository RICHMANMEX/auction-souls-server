// Автоматический тест Стадии 3: сетевой прототип и основная игровая логика аукциона.
// Проверяет: запуск сервера, подключение 3 клиентов, старт матча по готовности всех,
// показ лота, отклонение невалидных и повторных ставок, скрытие сумм ставок до раскрытия,
// определение победителя, разрешение ничьей 2:2 по приоритету входа, списание душ,
// переход к следующему раунду и корректную обработку отключения игрока во время торгов.
// Запуск: npm test

const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const { Client } = require("@colyseus/sdk");

const PORT = 3457;
const URL = `ws://localhost:${PORT}`;
const ROOT = path.join(__dirname, "..");

let failures = 0;
let checks = 0;

function check(condition, label) {
    checks += 1;
    if (condition) {
        console.log(`  ok: ${label}`);
    } else {
        failures += 1;
        console.log(`  ОШИБКА: ${label}`);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForPort(port, timeoutMs = 15000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        function attempt() {
            const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
                res.resume();
                resolve();
            });
            req.on("error", () => {
                if (Date.now() - started > timeoutMs) {
                    reject(new Error("Сервер не поднялся за " + timeoutMs + " мс"));
                } else {
                    setTimeout(attempt, 250);
                }
            });
        }
        attempt();
    });
}

async function waitForPhase(room, phase, timeoutMs = 15000) {
    const started = Date.now();
    while (room.state.phase !== phase) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(`Фаза "${phase}" не наступила за ${timeoutMs} мс (сейчас: "${room.state.phase}")`);
        }
        await sleep(30);
    }
}

function waitForMessage(room, type, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Сообщение "${type}" не получено`)), timeoutMs);
        room.onMessage(type, (msg) => {
            clearTimeout(timer);
            resolve(msg);
        });
    });
}

async function waitUntil(room, predicate, label, timeoutMs = 10000) {
    const started = Date.now();
    while (!predicate(room.state)) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(`Не дождались: ${label} (сейчас: "${room.state.phase}", раунд ${room.state.round})`);
        }
        await sleep(30);
    }
}

function playerList(room) {
    return [...room.state.players.values()];
}

async function main() {
    console.log("1. Запуск сервера на порту", PORT);
    const server = spawn(process.execPath, ["server.js"], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (d) => process.stdout.write("[сервер] " + d));
    server.stderr.on("data", (d) => process.stderr.write("[сервер:err] " + d));

    try {
        await waitForPort(PORT);
        check(true, "сервер поднялся и раздаёт страницу по HTTP");

        console.log("2. Подключение трёх клиентов к одной комнате");
        const c1 = new Client(URL);
        const c2 = new Client(URL);
        const c3 = new Client(URL);

        const r1 = await c1.create("game", { fastTimings: true, name: "Анна" });
        const r2 = await c2.joinById(r1.roomId, { name: "Борис" });
        const r3 = await c3.joinById(r1.roomId, { name: "Вера" });

        for (const r of [r1, r2, r3]) {
            r.onMessage("event", () => {});
            r.onMessage("auction_result", () => {});
        }

        await sleep(400);
        check(r1.state.players.size === 3, `в комнате видны 3 игрока (видно: ${r1.state.players.size})`);
        const names = playerList(r1).map((p) => p.name).sort().join(",");
        check(names === "Анна,Борис,Вера", `имена игроков синхронизированы (${names})`);
        check(r1.state.phase === "waiting", "фаза waiting после подключения");

        console.log("3. Готовность и автоматический старт матча");
        const errors2 = [];
        r2.onMessage("error", (m) => errors2.push(m.text));

        r1.send("ready", { value: true });
        r2.send("ready", { value: true });
        await sleep(300);
        check(r1.state.phase === "waiting", "матч не стартует, пока не готовы все участники");

        r3.send("ready", { value: true });
        await waitForPhase(r1, "item_reveal");
        check(r1.state.itemName.length > 0, `лот раунда выбран и передан клиентам («${r1.state.itemName}»)`);

        console.log("4. Серверная валидация недопустимых ставок");
        await waitForPhase(r1, "betting");
        r2.send("bet", { amount: 999 }); // больше текущего запаса душ
        r2.send("bet", { amount: -1 });  // отрицательная ставка
        r2.send("bet", { amount: 1.5 }); // дробная ставка
        await sleep(400);
        check(errors2.length === 3, `три недопустимые ставки отклонены сервером (ошибок: ${errors2.length})`);
        const boris = r1.state.players.get(r2.sessionId);
        check(!boris.hasBet, "после отклонённых ставок флаг hasBet остаётся false");

        console.log("5. Скрытый аукцион: приём ставок, разрешение ничьей и списание душ");
        const resultPromise = waitForMessage(r1, "auction_result");
        r2.send("bet", { amount: 2 });
        await sleep(150);
        check(boris.hasBet === true && boris.souls === 10 && !("bet" in boris),
            "до раскрытия ставок виден только флаг hasBet, сама сумма скрыта на сервере");

        r2.send("bet", { amount: 3 }); // повторная ставка в том же раунде — отклоняется
        r1.send("bet", { amount: 2 }); // ничья 2:2 с Борисом
        r3.send("bet", { amount: 0 }); // нулевая ставка допустима
        const result = await resultPromise;

        check(errors2.length === 4, "повторная ставка в одном раунде отклонена сервером");
        check(result.winnerBet === 2, `побеждает наибольшая ставка (${result.winnerBet})`);
        check(result.winnerId === r1.sessionId,
            `при ничье 2:2 побеждает приоритет по порядку входа (победил: ${result.winnerName})`);
        check(result.bets[r3.sessionId] === 0, `ставка 0 корректно принята и раскрыта (${result.bets[r3.sessionId]})`);

        await waitUntil(r1, (st) => st.phase === "result" && st.round === 1, "фаза result 1-го раунда");
        const anna = r1.state.players.get(r1.sessionId);
        const vera = r1.state.players.get(r3.sessionId);
        check(anna.souls === 8, `у победителя списана его ставка (души Анны: ${anna.souls})`);
        check(boris.souls === 10 && vera.souls === 10, "проигравшие участники душ не теряют");

        console.log("6. Переход к следующему раунду и отключение игрока во время торгов");
        await waitUntil(r1, (st) => st.round === 2 && st.phase === "betting", "старт торгов 2-го раунда");
        check(anna.hasBet === false && boris.hasBet === false, "во 2-м раунде флаги hasBet сброшены");

        const result2Promise = waitForMessage(r1, "auction_result");
        r1.send("bet", { amount: 1 });
        r2.send("bet", { amount: 3 });
        r3.leave(); // Вера отключается во время приёма ставок — сервер должен закрыть торги досрочно
        const result2 = await result2Promise;
        check(result2.winnerId === r2.sessionId && r1.state.players.size === 2,
            "при выходе третьего игрока во время торгов аукцион завершается без зависания");
    } finally {
        server.kill();
        await sleep(300);
    }

    console.log("");
    console.log(`ИТОГ: проверок ${checks}, ошибок ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("ТЕСТ УПАЛ:", err.message);
    process.exit(1);
});
