/* Клиент «Аукциона Душ», Стадия 4: торги, выбор цели, броня, финал партии. */
const { Client } = window.Colyseus;
const $ = (id) => document.getElementById(id);

const PHASE_LABELS = {
    waiting: "Ожидание игроков",
    item_reveal: "Показ предмета",
    betting: "Приём ставок",
    result: "Результат аукциона",
    item_action: "Выбор цели",
    resolution: "Подведение итогов",
    game_over: "Игра окончена",
};

let room = null;

$("connect-btn").onclick = async () => {
    const name = $("name-input").value.trim();
    $("connect-msg").textContent = "Подключение...";
    try {
        const client = new Client(location.origin);
        room = await client.joinOrCreate("game", { name });
        $("connect-screen").hidden = true;
        $("game-screen").hidden = false;
        setupRoom();
    } catch (err) {
        $("connect-msg").textContent = "Не удалось подключиться: " + (err.message || err);
    }
};
$("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("connect-btn").click();
});

function setupRoom() {
    room.onStateChange(() => render());
    room.onMessage("event", (msg) => addLog(msg.text));
    room.onMessage("auction_result", (msg) => {
        const parts = Object.entries(msg.bets).map(([id, bet]) => {
            const p = room.state.players.get(id);
            return `${p ? p.name : id}: ${bet}`;
        });
        addLog(`— Ставки раскрыты [${parts.join(", ")}]. Победитель: ${msg.winnerName} (${msg.winnerBet} душ)`);
    });
    room.onMessage("error", (msg) => {
        $("bet-msg").textContent = msg.text;
        addLog("⚠ " + msg.text);
    });
    room.onLeave(() => addLog("Соединение с комнатой закрыто."));

    $("ready-btn").onclick = () => {
        const me = room.state.players.get(room.sessionId);
        room.send("ready", { value: !(me && me.ready) });
    };
    $("bet-btn").onclick = submitBet;
    $("bet-range").oninput = (e) => { $("bet-input").value = e.target.value; };
    $("bet-input").oninput = (e) => { $("bet-range").value = e.target.value; };
    $("restart-btn").onclick = () => room.send("restart");
    render();
}

function submitBet() {
    const me = room.state.players.get(room.sessionId);
    const amount = Number($("bet-input").value);
    if (!me || !me.alive) return;
    if (!Number.isInteger(amount) || amount < 0 || amount > me.souls) {
        $("bet-msg").textContent = `Ставка — целое число от 0 до ${me ? me.souls : 0}.`;
        return;
    }
    $("bet-msg").textContent = "";
    room.send("bet", { amount });
}

function render() {
    const st = room.state;
    const me = st.players.get(room.sessionId);

    $("round-label").textContent = st.phase === "waiting" ? "Раунд: —" : `Раунд: ${st.round}`;
    $("phase-label").textContent = `Фаза: ${PHASE_LABELS[st.phase] || st.phase}`;
    renderPlayers(st);

    // карточка лота видна во всех фазах раунда, включая выбор цели
    const showItem = ["item_reveal", "betting", "result", "item_action", "resolution"].includes(st.phase);
    $("item-card").classList.toggle("hidden", !showItem);
    if (showItem) {
        $("item-name").textContent = st.itemName;
        $("item-desc").textContent = st.itemDesc;
    }

    // выбор цели показываем только победителю аукциона и только в фазе item_action
    const myChoice = st.phase === "item_action" && st.auctionWinnerId === room.sessionId;
    $("action-panel").classList.toggle("hidden", !myChoice);
    if (myChoice) {
        $("action-title").textContent = `Выберите цель для «${st.itemName}»:`;
        renderTargets(st);
    }

    $("lobby-controls").classList.toggle("hidden", st.phase !== "waiting");
    if (st.phase === "waiting") {
        $("ready-btn").textContent = me && me.ready ? "Не готов" : "Я готов";
        const total = st.players.size;
        const ready = [...st.players.values()].filter((p) => p.ready).length;
        $("lobby-hint").textContent = total < 2
            ? `Ждём игроков (${total}/2 минимум)...`
            : `Готовы: ${ready} из ${total}. Матч начнётся, когда будут готовы все.`;
    }

    const canBet = st.phase === "betting" && me && me.alive && !me.hasBet;
    $("bet-panel").classList.toggle("hidden", !["betting", "result", "resolution"].includes(st.phase));
    $("bet-btn").disabled = !canBet;
    $("bet-range").disabled = !canBet;
    $("bet-input").disabled = !canBet;
    if (me) {
        $("bet-range").max = me.souls;
        $("bet-input").max = me.souls;
    }
    if (st.phase === "betting" && me && me.hasBet) {
        $("bet-msg").textContent = "Ставка принята. Ждём остальных...";
    } else if (st.phase !== "betting") {
        $("bet-msg").textContent = "";
    }

    $("gameover-panel").classList.toggle("hidden", st.phase !== "game_over");
    if (st.phase === "game_over") {
        if (st.gameWinnerId === "") {
            $("gameover-title").textContent = "Партия окончена. Все погибли — ничья";
        } else {
            const w = st.players.get(st.gameWinnerId);
            const winnerName = w ? w.name : "?";
            $("gameover-title").textContent = st.gameWinnerId === room.sessionId
                ? "Вы победили!"
                : `Партия окончена. Победитель: ${winnerName}`;
        }
    }
}

function renderPlayers(st) {
    const tbody = $("players-table");
    tbody.innerHTML = "";
    st.players.forEach((p, id) => {
        const tr = document.createElement("tr");
        if (id === room.sessionId) tr.className = "me";
        if (!p.alive) tr.className = "dead";
        const hearts = "♥".repeat(p.hp) + "♡".repeat(Math.max(0, p.maxHp - p.hp));
        const armor = p.armor > 0 ? "🛡".repeat(p.armor) : "—";
        tr.innerHTML = `
            <td>${escapeHtml(p.name)}</td>
            <td>${hearts} (${p.hp}/${p.maxHp})</td>
            <td>${p.souls}</td>
            <td>${armor}</td>
            <td>${statusText(p, st)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function statusText(p, st) {
    if (!p.alive) return "погиб";
    if (st.phase === "waiting") return p.ready ? "готов" : "не готов";
    if (st.phase === "betting" && p.hasBet) return "ставка сделана";
    if (st.auctionWinnerId !== "" && st.auctionWinnerId === idOf(p, st)) return "выиграл аукцион";
    return "в раунде";
}

function idOf(player, st) {
    let found = "";
    st.players.forEach((p, id) => {
        if (p === player) found = id;
    });
    return found;
}

function renderTargets(st) {
    const list = $("target-list");
    list.innerHTML = "";
    st.players.forEach((p, id) => {
        if (id === room.sessionId || !p.alive) return;
        const btn = document.createElement("button");
        btn.textContent = p.name;
        btn.onclick = () => room.send("choose_target", { targetId: id });
        list.appendChild(btn);
    });
}

function addLog(text) {
    const li = document.createElement("li");
    li.textContent = text;
    const log = $("log");
    log.prepend(li);
    while (log.children.length > 60) log.removeChild(log.lastChild);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&", "<": "<", ">": ">", '"': "&quot;", "'": "&#39;",
    }[c]));
}