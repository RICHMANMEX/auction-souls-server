// Временный клиент стадии 3: лобби, показ лота, отправка скрытой ставки, раскрытие итогов аукциона.
// Боевые эффекты предметов, выбор цели и экран финала появятся на стадии 4.

const { Client } = window.Colyseus;
const $ = (id) => document.getElementById(id);

const PHASE_LABELS = {
    waiting: "Ожидание игроков (лобби)",
    item_reveal: "Показ лота раунда",
    betting: "Приём скрытых ставок",
    result: "Раскрытие ставок и итог аукциона",
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
        addLog(`— Ставки раскрыты [${parts.join(", ")}]. Победитель: ${msg.winnerName} (ставка: ${msg.winnerBet} душ)`);
    });

    room.onMessage("error", (msg) => {
        $("bet-msg").textContent = msg.text;
        addLog("Ошибка: " + msg.text);
    });

    room.onLeave(() => addLog("Соединение с комнатой закрыто."));

    $("ready-btn").onclick = () => {
        const me = room.state.players.get(room.sessionId);
        room.send("ready", { value: !(me && me.ready) });
    };

    $("bet-btn").onclick = submitBet;
    $("bet-range").oninput = (e) => { $("bet-input").value = e.target.value; };
    $("bet-input").oninput = (e) => { $("bet-range").value = e.target.value; };

    render();
}

function submitBet() {
    const me = room.state.players.get(room.sessionId);
    const amount = Number($("bet-input").value);

    if (!me || !me.alive) return;
    if (!Number.isInteger(amount) || amount < 0 || amount > me.souls) {
        $("bet-msg").textContent = `Введите целое число от 0 до ${me ? me.souls : 0}.`;
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

    const showItem = ["item_reveal", "betting", "result"].includes(st.phase);
    $("item-card").classList.toggle("hidden", !showItem);
    if (showItem) {
        $("item-name").textContent = st.itemName;
        $("item-desc").textContent = st.itemDesc;
    }

    $("lobby-controls").classList.toggle("hidden", st.phase !== "waiting");
    if (st.phase === "waiting") {
        $("ready-btn").textContent = me && me.ready ? "Не готов" : "Я готов";
        const total = st.players.size;
        const ready = [...st.players.values()].filter((p) => p.ready).length;
        $("lobby-hint").textContent =
            total < 2
                ? `Ожидание участников (${total}/2 минимум)...`
                : `Готовы: ${ready} из ${total}. Матч стартует автоматически при готовности всех.`;
    }

    const canBet = st.phase === "betting" && me && me.alive && !me.hasBet;
    $("bet-panel").classList.toggle("hidden", !["betting", "result"].includes(st.phase));
    $("bet-btn").disabled = !canBet;
    $("bet-range").disabled = !canBet;
    $("bet-input").disabled = !canBet;
    if (me) {
        $("bet-range").max = me.souls;
        $("bet-input").max = me.souls;
    }
    if (st.phase === "betting" && me && me.hasBet) {
        $("bet-msg").textContent = "Скрытая ставка принята сервером. Ожидание остальных игроков...";
    } else if (st.phase !== "betting") {
        $("bet-msg").textContent = "";
    }
}

function renderPlayers(st) {
    const tbody = $("players-table");
    tbody.innerHTML = "";

    st.players.forEach((p, id) => {
        const tr = document.createElement("tr");
        if (id === room.sessionId) tr.className = "me";

        tr.innerHTML = `
            <td>${escapeHtml(p.name)}</td>
            <td>${p.hp}/${p.maxHp}</td>
            <td>${p.souls}</td>
            <td>${statusText(p, id, st)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function statusText(p, id, st) {
    if (st.phase === "waiting") return p.ready ? "готов" : "не готов";
    if (st.phase === "betting") return p.hasBet ? "ставка сделана (скрыта)" : "думает...";
    if (st.phase === "result" && st.auctionWinnerId === id) return "выиграл лот";
    return "в раунде";
}

function addLog(text) {
    const li = document.createElement("li");
    li.textContent = text;
    const log = $("log");
    log.prepend(li);
    while (log.children.length > 50) log.removeChild(log.lastChild);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
