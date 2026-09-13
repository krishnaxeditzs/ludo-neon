/* Online mode is deliberately separate from the local game engine in script.js. */
const OnlineMultiplayer = (() => {
  let socket;
  let roomCode = null;
  let myColor = null;
  let active = false;
  let receivingState = false;
  const COLORS = ["red", "green"];

  const $ = (id) => document.getElementById(id);
  const status = (message, error = false) => {
    $("online-status").textContent = message;
    $("online-status").className = `mt-4 min-h-5 text-center text-sm ${error ? "text-red-400" : "text-zinc-400"}`;
  };
  const serverUrl = () => {
    if (location.protocol === "http:" || location.protocol === "https:") {
      return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    }
    return null;
  };

  function connect(action, code = "") {
    const url = serverUrl();
    if (!url) {
      status("Online rooms need the game server. Run npm install, then npm start, and open http://localhost:3000.", true);
      return;
    }
    status("Connecting to arena...");
    socket?.close();
    socket = new WebSocket(url);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: action, code })));
    socket.addEventListener("error", () => status("Could not reach the game server.", true));
    socket.addEventListener("close", () => {
      if (active) logMsg("Connection lost. Your game is paused.");
    });
    socket.addEventListener("message", ({ data }) => receive(JSON.parse(data)));
  }

  function receive(message) {
    if (message.type === "error") return status(message.message, true);
    if (message.type === "room-created") {
      roomCode = message.code;
      status(`Room ${roomCode} created — share this code with a friend.`);
      return;
    }
    if (message.type === "game-ready") {
      roomCode = message.code;
      myColor = message.color;
      active = true;
      $("online-modal").classList.add("hidden");
      startGame();
      logMsg(`Online room ${roomCode}: you are ${myColor.toUpperCase()}.`);
      return;
    }
    if (message.type === "state" && message.state && !receivingState) applyState(message.state);
    if (message.type === "opponent-left") logMsg("Your opponent left the room.");
  }

  function snapshot() {
    return {
      players: players.map(({ color, type, finished }) => ({ color, type, finished })),
      tokens: tokens.map(({ id, color, playerIndex, state, relPos }) => ({ id, color, playerIndex, state, relPos })),
      turnIndex, ranks: [...ranks], currentDice, extraTurnGranted, consecutiveSixes,
    };
  }

  function applyState(next) {
    receivingState = true;
    players = next.players;
    ranks = next.ranks;
    turnIndex = next.turnIndex;
    currentDice = next.currentDice;
    extraTurnGranted = next.extraTurnGranted;
    consecutiveSixes = next.consecutiveSixes;
    next.tokens.forEach((saved) => {
      const token = tokens.find((item) => item.id === saved.id);
      if (token) Object.assign(token, saved);
    });
    updateTokenVisuals();
    updateRankingsUI();
    if (isGameOver()) showResults();
    else startTurn();
    receivingState = false;
  }

  return {
    isActive: () => active,
    canAct: (color) => active && color === myColor,
    getConfig: () => (active ? { colors: COLORS } : null),
    syncGameState: () => {
      if (active && !receivingState && socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "state", state: snapshot() }));
      }
    },
    leaveRoom: () => {
      active = false;
      roomCode = null;
      myColor = null;
      socket?.close();
      socket = null;
    },
  };
})();

window.OnlineMultiplayer = OnlineMultiplayer;

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("online-modal");
  document.getElementById("open-online-btn").onclick = () => {
    modal.classList.remove("hidden");
    if (location.protocol === "file:") {
      status("Start the game server first: npm install, then npm start. Open http://localhost:3000 — not the index.html file.", true);
    } else {
      status("");
    }
  };
  document.getElementById("close-online-btn").onclick = () => modal.classList.add("hidden");
  document.getElementById("create-room-btn").onclick = () => OnlineMultiplayer.leaveRoom() || connect("create");
  document.getElementById("join-room-btn").onclick = () => {
    const code = document.getElementById("room-code-input").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return status("Enter the six-character room code.", true);
    OnlineMultiplayer.leaveRoom();
    connect("join", code);
  };
});
