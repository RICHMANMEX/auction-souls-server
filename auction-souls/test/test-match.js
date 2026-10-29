// Автотест стадии 2: базовая инфраструктура.
// Проверяет: запуск сервера, вход двух игроков, синхронизацию состава
// комнаты и готовности, выход игрока.
// Запуск из папки проекта: npm test

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

        console.log("2. Подключение двух клиентов к одной комнате");
        const c1 = new Client(URL);
        const c2 = new Client(URL);
        const r1 = await c1.create("game", { fastTimings: true, name: "Анна" });
        const r2 = await c2.joinById(r1.roomId, { name: "Борис" });

        for (const r of [r1, r2]) r.onMessage("event", () => {});

        await sleep(400);
        check(r1.state.players.size === 2, `в комнате видны 2 игрока (видно: ${r1.state.players.size})`);
        const names = [...r1.state.players.values()].map((p) => p.name).sort().join(",");
        check(names === "Анна,Борис", `имена игроков синхронизированы (${names})`);
        check(r1.state.phase === "waiting", "фаза waiting (лобби)");
        const anyPlayer = [...r1.state.players.values()][0];
        check(anyPlayer.hp === 3 && anyPlayer.souls === 10, "стартовые характеристики: 3 HP и 10 душ");

        console.log("3. Готовность в лобби");
        r1.send("ready", { value: true });
        await sleep(400);
        const anna = r1.state.players.get(r1.sessionId);
        const boris = r1.state.players.get(r2.sessionId);
        check(anna.ready === true, "флаг готовности синхронизирован");
        check(boris.ready === false, "готовность другого игрока не изменилась");

        console.log("4. Отключение игрока");
        r2.leave();
        await sleep(600);
        check(r1.state.players.size === 1, "после выхода в комнате остался 1 игрок");
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
