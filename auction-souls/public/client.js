// Клиент стадии 2: вход в комнату, список игроков, готовность, журнал.
// Ставки и предметы здесь нет — это план стадии 3.

const { Client } = window.Colyseus;
const $ = (id) => document.getElementById(id);

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

function setupRoom() {
    room.onStateChange(() => render());
    room.onMessage("event", (msg) => addLog(msg.text));
    room.onLeave(() => addLog("Соединение закрыто."));

    $("ready-btn").onclick = () => {
        const me = room.state.players.get(room.sessionId);
        room.send("ready", { value: !(me && me.ready) });
    };

    render();
}

function render() {
    const tbody = $("players-table");
    tbody.innerHTML = "";

    room.state.players.forEach((p, id) => {
        const tr = document.createElement("tr");
        if (id === room.sessionId) tr.className = "me";
        tr.innerHTML = `
            <td>${escapeHtml(p.name)}</td>
            <td>${p.hp}/${p.maxHp}</td>
            <td>${p.souls}</td>
            <td>${p.ready ? "готов" : "не готов"}</td>
        `;
        tbody.appendChild(tr);
    });

    const me = room.state.players.get(room.sessionId);
    $("ready-btn").textContent = me && me.ready ? "Не готов" : "Я готов";
}

function addLog(text) {
    const li = document.createElement("li");
    li.textContent = text;
    const log = $("log");
    log.prepend(li);
    while (log.children.length > 40) log.removeChild(log.lastChild);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}
