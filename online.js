/* Online mode stays separate from the local game engine in script.js. */
const OnlineMultiplayer = (() => {
  const ALL_COLORS = ["red", "green", "blue", "yellow"];
  let socket, roomCode = null, myColor = null, playerColors = [], isHost = false, active = false, receivingState = false;
  const $ = (id) => document.getElementById(id);
  const status = (message, error = false) => {
    $("online-status").textContent = message;
    $("online-status").className = `mt-4 min-h-5 text-center text-sm ${error ? "text-red-400" : "text-zinc-400"}`;
  };
  const serverUrl = () => (location.protocol === "http:" || location.protocol === "https:")
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}` : null;

  function connect(action, code = "") {
    const url = serverUrl();
    if (!url) return status("Online rooms need the game server. Run npm install, then npm start, and open http://localhost:3000.", true);
    status("Connecting to arena...");
    socket?.close(); socket = new WebSocket(url);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: action, code })));
    socket.addEventListener("error", () => status("Could not reach the game server.", true));
    socket.addEventListener("close", () => { if (active) logMsg("Connection lost. Your game is paused."); });
    socket.addEventListener("message", ({ data }) => receive(JSON.parse(data)));
  }
  const send = (message) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };

  function renderLobby(message) {
    roomCode = message.code; myColor = message.yourColor || null; playerColors = message.colors; isHost = message.isHost;
    $("color-picker").classList.remove("hidden");
    $("color-choice-buttons").innerHTML = ALL_COLORS.map((color) => {
      const used = playerColors.includes(color), mine = myColor === color;
      return `<button onclick="OnlineMultiplayer.chooseColor('${color}')" ${used && !mine ? "disabled" : ""} class="rounded-lg border px-3 py-2 font-black capitalize transition ${mine ? "border-cyan-300 bg-cyan-400 text-black" : used ? "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600" : "border-zinc-600 bg-black text-white hover:border-white"}">${mine ? "✓ " : ""}${color}</button>`;
    }).join("");
    const start = $("start-match-btn");
    start.classList.toggle("hidden", !isHost);
    start.disabled = playerColors.length < 2 || !myColor;
    start.classList.toggle("opacity-40", start.disabled);
    status(`Room ${roomCode}: ${playerColors.length}/4 players. ${myColor ? `You chose ${myColor.toUpperCase()}.` : "Choose an available color."}`);
  }
  function receive(message) {
    if (message.type === "error") return status(message.message, true);
    if (message.type === "room-created") { roomCode = message.code; return status(`Room ${roomCode} created — share this code with friends.`); }
    if (message.type === "room-lobby") return renderLobby(message);
    if (message.type === "game-ready") {
      roomCode = message.code; myColor = message.color; playerColors = message.colors; isHost = message.isHost; active = true;
      $("online-modal").classList.add("hidden"); startGame(); logMsg(`Online room ${roomCode}: you are ${myColor.toUpperCase()}.`); return;
    }
    if (message.type === "state" && message.state && !receivingState) applyState(message.state);
    if (message.type === "opponent-left") logMsg("A player left the room.");
  }
  function snapshot() {
    return { players: players.map(({ color, type, finished }) => ({ color, type, finished })), tokens: tokens.map(({ id, color, playerIndex, state, relPos }) => ({ id, color, playerIndex, state, relPos })), turnIndex, ranks: [...ranks], currentDice, extraTurnGranted, consecutiveSixes };
  }
  function applyState(next) {
    receivingState = true; players = next.players; ranks = next.ranks; turnIndex = next.turnIndex; currentDice = next.currentDice; extraTurnGranted = next.extraTurnGranted; consecutiveSixes = next.consecutiveSixes;
    next.tokens.forEach((saved) => { const token = tokens.find((item) => item.id === saved.id); if (token) Object.assign(token, saved); });
    updateTokenVisuals(); updateRankingsUI(); if (isGameOver()) showResults(); else startTurn(); receivingState = false;
  }
  return {
    isActive: () => active,
    canAct: (color) => active && color === myColor,
    getConfig: () => (active ? { colors: playerColors } : null),
    shouldPublishInitialState: () => active && isHost,
    syncGameState: () => { if (active && !receivingState) send({ type: "state", state: snapshot() }); },
    leaveRoom: () => { active = false; roomCode = null; myColor = null; playerColors = []; isHost = false; socket?.close(); socket = null; },
    createRoom: () => { OnlineMultiplayer.leaveRoom(); connect("create"); },
    joinRoom: (rawCode) => { const code = rawCode.trim().toUpperCase(); if (!/^[A-Z0-9]{6}$/.test(code)) return status("Enter the six-character room code.", true); OnlineMultiplayer.leaveRoom(); connect("join", code); },
    chooseColor: (color) => send({ type: "choose-color", color }),
    startMatch: () => send({ type: "start-match" }),
  };
})();
window.OnlineMultiplayer = OnlineMultiplayer;
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("online-modal");
  document.getElementById("open-online-btn").onclick = () => { modal.classList.remove("hidden"); if (location.protocol === "file:") status("Start the game server first: npm install, then npm start. Open http://localhost:3000 — not the index.html file.", true); else status(""); };
  document.getElementById("close-online-btn").onclick = () => modal.classList.add("hidden");
});
