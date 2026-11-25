// npm test — поднимает сервер на 3457 и прогоняет две комнаты:
// A: случайные лоты, полный матч до победителя, перезапуск, отключение.
// B: фиксированная последовательность лотов — каждый эффект точными числами.
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const { Client } = require("@colyseus/sdk");

const PORT = 3457;
const URL = `ws://localhost:${PORT}`;
const ROOT = path.join(__dirname, "..");
const MAX_ARMOR = 6;
const START_HP = 5;

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

async function waitForPhase(room, phase, timeoutMs = 20000) {
    const started = Date.now();
    while (room.state.phase !== phase) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(`Фаза "${phase}" не наступила за ${timeoutMs} мс (сейчас: "${room.state.phase}")`);
        }
        await sleep(25);
    }
}

function waitForMessage(room, type, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Сообщение "${type}" не получено`)), timeoutMs);
        room.onMessage(type, (msg) => {
            clearTimeout(timer);
            resolve(msg);
        });
    });
}

async function waitUntil(room, predicate, label, timeoutMs = 20000) {
    const started = Date.now();
    while (!predicate(room.state)) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(`Не дождались: ${label} (фаза "${room.state.phase}", раунд ${room.state.round})`);
        }
        await sleep(25);
    }
}

function playerList(room) {
    return [...room.state.players.values()];
}

function watchInvariants(room) {
    room.onStateChange(() => {
        room.state.players.forEach((p) => {
            if (!(p.hp >= 0 && p.hp <= p.maxHp)) {
                failures += 1;
                console.log(`  ОШИБКА [инвариант]: ${p.name} hp=${p.hp}`);
            }
            if (!(p.souls >= 0)) {
                failures += 1;
                console.log(`  ОШИБКА [инвариант]: ${p.name} souls=${p.souls}`);
            }
            if (!(p.armor >= 0 && p.armor <= MAX_ARMOR)) {
                failures += 1;
                console.log(`  ОШИБКА [инвариант]: ${p.name} armor=${p.armor}`);
            }
        });
    });
}

// Set по раундам: серверный hasBet возвращается с задержкой, без него шлём ставку дважды
function autoplay(room) {
    const betRounds = new Set();
    room.onStateChange(() => {
        const st = room.state;
        if (st.phase !== "betting" || betRounds.has(st.round)) return;
        const me = st.players.get(room.sessionId);
        if (me && me.alive && !me.hasBet) {
            betRounds.add(st.round);
            room.send("bet", { amount: Math.floor(Math.random() * 3) });
        }
    });
}

// первый свой item_action шлём заведомо битую цель, дальше играем нормально
function playTargets(room, errorSink) {
    let invalidSent = false;
    room.onMessage("error", (m) => errorSink.push(m.text));
    room.onStateChange(() => {
        const st = room.state;
        if (st.phase !== "item_action") return;
        if (st.auctionWinnerId !== room.sessionId) return;
        if (!invalidSent) {
            invalidSent = true;
            room.send("choose_target", { targetId: "нет-такого-игрока" });
            return;
        }
        const other = [...st.players.entries()].find(([id, p]) => id !== room.sessionId && p.alive);
        if (other) room.send("choose_target", { targetId: other[0] });
    });
}

function mute(room) {
    room.onMessage("event", () => {});
    room.onMessage("auction_result", () => {});
    room.onMessage("error", () => {});
}

// управляемый раунд: победитель ставит bid, соперник 0, затем указываем цель.
// возвращает управление в фазе resolution (эффект применён, доход раунда ещё не начислен)
async function forcedRound(host, winner, loser, bid, needTarget) {
    await waitForPhase(host, "betting");
    const round = host.state.round;
    winner.send("bet", { amount: bid });
    loser.send("bet", { amount: 0 });
    await waitUntil(host, (st) => st.phase !== "betting", "закрытие торгов");
    if (needTarget) {
        await waitForPhase(host, "item_action");
        winner.send("choose_target", { targetId: loser.sessionId });
    }
    await waitUntil(host, (st) => st.phase === "resolution" || st.phase === "game_over", "применение эффекта");
    await sleep(60);
    return round;
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

        console.log("2. Комната A: подключение трёх клиентов");
        const c1 = new Client(URL);
        const c2 = new Client(URL);
        const c3 = new Client(URL);
        const r1 = await c1.create("game", { fastTimings: true, name: "Анна" });
        const r2 = await c2.joinById(r1.roomId, { name: "Борис" });
        const r3 = await c3.joinById(r1.roomId, { name: "Вера" });
        for (const r of [r1, r2, r3]) { mute(r); watchInvariants(r); }

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
        r2.send("bet", { amount: 999 });
        r2.send("bet", { amount: -1 });
        r2.send("bet", { amount: 1.5 });
        await sleep(400);
        check(errors2.length === 3, `три недопустимые ставки отклонены сервером (ошибок: ${errors2.length})`);
        const boris = r1.state.players.get(r2.sessionId);
        check(!boris.hasBet, "после отклонённых ставок флаг hasBet остаётся false");

        console.log("5. Скрытый аукцион: ставки, ничья, списание душ");
        const resultPromise = waitForMessage(r1, "auction_result");
        r2.send("bet", { amount: 2 });
        await sleep(150);
        check(boris.hasBet === true && boris.souls === 10 && !("bet" in boris),
            "до раскрытия виден только флаг hasBet, сумма ставки скрыта на сервере");
        r2.send("bet", { amount: 3 });
        r1.send("bet", { amount: 2 });
        r3.send("bet", { amount: 0 });
        const result = await resultPromise;
        check(errors2.length === 4, "повторная ставка в одном раунде отклонена сервером");
        check(result.winnerBet === 2, `побеждает наибольшая ставка (${result.winnerBet})`);
        check(result.winnerId === r1.sessionId,
            `при ничье 2:2 побеждает приоритет по порядку входа (победил: ${result.winnerName})`);
        check(result.bets[r3.sessionId] === 0, `ставка 0 принята и раскрыта (${result.bets[r3.sessionId]})`);
        await waitUntil(r1, (st) => st.phase === "result" && st.round === 1, "фаза result 1-го раунда");
        const anna = r1.state.players.get(r1.sessionId);
        const vera = r1.state.players.get(r3.sessionId);
        check(anna.souls === 8, `у победителя списана его ставка (души Анны: ${anna.souls})`);
        check(boris.souls === 10 && vera.souls === 10, "проигравшие участники душ не теряют");

        console.log("6. Второй раунд: доход и отключение игрока во время торгов");
        await waitUntil(r1, (st) => st.round === 2 && st.phase === "betting", "старт торгов 2-го раунда");
        check(anna.hasBet === false && boris.hasBet === false, "во 2-м раунде флаги hasBet сброшены");
        check(anna.souls === 10 && boris.souls === 12,
            `доход раунда +2 начислен живым игрокам (Анна: ${anna.souls}, Борис: ${boris.souls})`);
        const result2Promise = waitForMessage(r1, "auction_result");
        r1.send("bet", { amount: 1 });
        r2.send("bet", { amount: 3 });
        r3.leave();
        const result2 = await result2Promise;
        // сообщение и патч состояния приходят разными пакетами — ждём именно состояние
        await waitUntil(r1, (st) => st.players.size === 2, "удаление вышедшего игрока из состояния");
        check(result2.winnerId === r2.sessionId && r1.state.players.size === 2,
            "при выходе третьего игрока во время торгов аукцион завершается без зависания");

        console.log("7. Полный матч со случайными лотами до победителя");
        const targetErrors = [];
        const seenItems = new Set();
        let itemActionSeen = 0;
        r1.onStateChange(() => {
            if (r1.state.itemId) seenItems.add(r1.state.itemId);
            if (r1.state.phase === "item_action") itemActionSeen += 1;
        });
        autoplay(r1);
        autoplay(r2);
        playTargets(r1, targetErrors);
        playTargets(r2, targetErrors);
        await waitForPhase(r1, "game_over", 240000);

        check(itemActionSeen > 0, `фаза выбора цели отработала (${itemActionSeen} раз)`);
        check(targetErrors.some((t) => t.includes("Недопустимая цель")), "несуществующая цель отклонена сервером");
        check(seenItems.size >= 4, `взвешенный каталог дал разные лоты за матч (${seenItems.size} разных)`);
        const aliveAtEnd = playerList(r1).filter((p) => p.alive).length;
        const winnerId = r1.state.gameWinnerId;
        const winner = winnerId ? r1.state.players.get(winnerId) : null;
        const finalOk = winnerId === ""
            ? aliveAtEnd === 0
            : aliveAtEnd === 1 && !!winner && winner.alive === true;
        check(finalOk, `партия доведена до финала: живых ${aliveAtEnd}, победитель ${winner ? winner.name : "ничья"}`);

        console.log("8. Перезапуск партии без перезапуска сервера");
        r1.send("restart");
        await waitForPhase(r1, "waiting");
        await sleep(300);
        check(r1.state.round === 1 && playerList(r1).every((p) =>
            p.hp === START_HP && p.souls === 10 && p.alive && !p.ready && p.armor === 0 && !p.hasBet),
            "после restart раунд, HP, души, броня и готовность сброшены");

        console.log("9. Отключение соперника во время активного матча");
        r1.send("ready", { value: true });
        r2.send("ready", { value: true });
        await waitForPhase(r1, "betting");
        r2.leave();
        await waitForPhase(r1, "game_over");
        check(r1.state.gameWinnerId === r1.sessionId,
            "при выходе соперника последний живой игрок побеждает автоматически");

        console.log("10. Комната B: точная проверка эффектов, дохода и невостребованного лота");
        const sequence = [
            "white_pearl",     // R1  Глеб 1 : 0 -> +5 душ
            "shell_1",         // R2  0 : 0  -> лот невостребован
            "black_pearl",     // R3  Дора 1 : 0 -> кража 2
            "fork",            // R4  1 урон
            "shell_1",         // R5  броня 1
            "trident",         // R6  2 урона: 1 гасится, 1 проходит
            "shell_3",         // R7  броня 3
            "coral",           // R8  пробивает, броня целая
            "shell_2",         // R9  броня 5
            "shell_2",         // R10 броня 6 (лимит)
            "trident",         // R11 полное поглощение
            "potion",          // R12 лечение
            "legend_trident",  // R13 пробивает, смерть
        ];
        const c4 = new Client(URL);
        const c5 = new Client(URL);
        const g = await c4.create("game", { fastTimings: true, itemSequence: sequence, name: "Глеб" });
        const d = await c5.joinById(g.roomId, { name: "Дора" });
        for (const r of [g, d]) { mute(r); watchInvariants(r); }
        await sleep(300);
        g.send("ready", { value: true });
        d.send("ready", { value: true });
        await waitForPhase(g, "item_reveal");
        check(g.state.itemId === "white_pearl",
            `тестовый режим фиксированных лотов работает (первый лот: ${g.state.itemName})`);

        const G = () => g.state.players.get(g.sessionId);
        const D = () => g.state.players.get(d.sessionId);

        // R1: белая жемчужина +5 (10 - 1 ставка + 5)
        await forcedRound(g, g, d, 1, false);
        check(G().souls === 14, `белая жемчужина даёт +5 душ (у Глеба: ${G().souls})`);

        // доход +2 каждому живому в начале 2-го раунда
        await waitForPhase(g, "betting");
        check(G().souls === 16 && D().souls === 12,
            `доход раунда +2 начислен обоим (Глеб: ${G().souls}, Дора: ${D().souls})`);

        // R2: все ставки 0 — лот никому не достаётся
        await forcedRound(g, g, d, 0, false);
        check(g.state.auctionWinnerId === "" && D().armor === 0 && G().armor === 0,
            "при нулевых ставках лот уходит невостребованным, эффект не применяется");

        // R3: чёрная жемчужина крадёт 2
        await forcedRound(g, d, g, 1, true);
        check(G().souls === 16 && D().souls === 15,
            `чёрная жемчужина крадёт 2 души (Глеб: ${G().souls}, Дора: ${D().souls})`);

        // R4: вилка 1 урон
        await forcedRound(g, g, d, 1, true);
        check(D().hp === 4, `вилка наносит 1 урон (HP Доры: ${D().hp})`);

        // R5: раковина I -> броня 1
        await forcedRound(g, d, g, 1, false);
        check(D().armor === 1, `раковина I даёт 1 единицу брони (броня: ${D().armor})`);

        // R6: трезубец 2 против брони 1 -> частичное поглощение
        await forcedRound(g, g, d, 1, true);
        check(D().hp === 3 && D().armor === 0,
            `броня вычитается из урона: 2 - 1 = 1 урон по HP (HP: ${D().hp}, броня: ${D().armor})`);

        // R7: раковина III -> броня 3
        await forcedRound(g, d, g, 1, false);
        check(D().armor === 3, `раковина III даёт 3 единицы брони (броня: ${D().armor})`);

        // R8: коралл пробивает и не тратит броню
        await forcedRound(g, g, d, 1, true);
        check(D().hp === 2 && D().armor === 3,
            `коралл пробивает броню и не расходует её (HP: ${D().hp}, броня: ${D().armor})`);

        // R9: раковина II -> броня 5
        await forcedRound(g, d, g, 1, false);
        check(D().armor === 5, `броня копится: 3 + 2 = 5 (броня: ${D().armor})`);

        // R10: ещё раковина II -> лимит 6
        await forcedRound(g, d, g, 1, false);
        check(D().armor === MAX_ARMOR,
            `броня ограничена лимитом ${MAX_ARMOR} (броня: ${D().armor})`);

        // R11: трезубец 2 против брони 6 -> полное поглощение
        await forcedRound(g, g, d, 1, true);
        check(D().hp === 2 && D().armor === 4,
            `броня гасит урон полностью: 6 - 2 = 4 брони, HP не тронут (HP: ${D().hp}, броня: ${D().armor})`);

        // R12: зелье лечит
        await forcedRound(g, d, g, 1, false);
        check(D().hp === 3, `зелье глубин восстанавливает 1 HP (HP Доры: ${D().hp})`);

        // R13: легендарка 3 пробивает броню 4 -> смерть
        await forcedRound(g, g, d, 1, true);
        check(D().hp === 0 && D().alive === false && D().armor === 4,
            `легендарный трезубец пробивает броню: 3 урона по HP (HP: ${D().hp}, жив: ${D().alive})`);

        await g.leave();
        await d.leave();
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