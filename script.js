const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
document.addEventListener(
  "click",
  () => {
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  },
  { once: true },
);

// ================== GLOBAL SETTINGS ==================
let isPaused = false;
let soundEnabled = true;
let diceLocked = false;
let controllerToastTimeout = null;
const gameSettings = {
  turnAura: true,

  tokenTrail: true,

  particles: true,

  captureFX: true,

  winnerFX: true,
};
const settingsModal = document.getElementById("settings-modal");

// 🎵 Background Music
const bgMusic = new Audio("sounds/bg.mp3");
bgMusic.loop = true;
bgMusic.volume = 0.4;

// ================== SOUNDS ==================
const sounds = {
  dice: new Audio("sounds/dice.mp3"),
  move: new Audio("sounds/move.mp3"),
  step: new Audio("sounds/step.mp3"),
  cut: new Audio("sounds/cut.mp3"),
  win: new Audio("sounds/win.mp3"),
};

let masterVolume = 1;
let musicVolume = 0.4;
let effectsVolume = 1;

window.addEventListener("DOMContentLoaded", () => {
  const master = document.getElementById("master-volume");
  const music = document.getElementById("music-volume");
  const effects = document.getElementById("effects-volume");
  const bgMusicToggle = document.getElementById("bg-music-setting");
  const soundToggle = document.getElementById("sound-setting");

  if (bgMusicToggle) {
    bgMusicToggle.addEventListener("change", () => {
      if (bgMusicToggle.checked) {
        bgMusic.volume = masterVolume * musicVolume;

        if (!isPaused) {
          bgMusic.play().catch(() => {});
        }
      } else {
        bgMusic.pause();
      }
    });
  }

  if (soundToggle) {
    soundToggle.addEventListener("change", () => {
      soundEnabled = soundToggle.checked;
    });
  }

  if (master) {
    master.addEventListener("input", () => {
      masterVolume = master.value / 100;

      bgMusic.volume = masterVolume * musicVolume;
    });
  }

  if (music) {
    music.addEventListener("input", () => {
      musicVolume = music.value / 100;

      bgMusic.volume = masterVolume * musicVolume;
    });
  }

  if (effects) {
    effects.addEventListener("input", () => {
      effectsVolume = effects.value / 100;
    });
  }

  const controls = [
    ["trail-setting", "tokenTrail"],
    ["turn-aura-setting", "turnAura"],
    ["particles-setting", "particles"],
    ["capture-setting", "captureFX"],
    ["winner-setting", "winnerFX"],
  ];

  controls.forEach(([id, key]) => {
    const checkbox = document.getElementById(id);

    if (!checkbox) return;

    checkbox.checked = gameSettings[key];

    checkbox.addEventListener("change", () => {
      gameSettings[key] = checkbox.checked;

      if (key === "turnAura") {
        updateTurnAura();
      }
    });
  });
});

function playSound(type, token = null) {
  if (isPaused || !soundEnabled) return;
  if (!sounds[type]) return;

  const audio = sounds[type].cloneNode();

  audio.volume = (type === "step" ? 0.8 : 1) * masterVolume * effectsVolume;

  audio.play().catch(() => {});
}

// ================== VIBRATION ==================
function vibrate(type) {
  if (!("vibrate" in navigator)) return;

  try {
    switch (type) {
      case "step":
        navigator.vibrate([30, 20, 30]); // light pulse
        break;

      case "move":
        navigator.vibrate([80, 40, 80]); // medium strong
        break;

      case "dice":
        navigator.vibrate([100, 50, 100, 50, 120]); // rolling feel
        break;

      case "cut":
        navigator.vibrate([150, 70, 150]); // 💥 strong hit
        break;

      case "win":
        navigator.vibrate([200, 100, 200, 100, 300]); // 🏆 very strong
        break;
    }
  } catch (e) {}
}

// ================== PAUSE ==================

function resumeBackgroundMusic() {
  if (soundEnabled && document.getElementById("bg-music-setting").checked) {
    bgMusic.play().catch(() => {});
  }
}

function togglePause() {
  isPaused = !isPaused;

  const pauseScreen = document.getElementById("pause-screen");

  if (isPaused) {
    pauseScreen.classList.remove("hidden");
    bgMusic.pause();
  } else {
    pauseScreen.classList.add("hidden");

    resumeBackgroundMusic();
  }
}

function openSettingsFromPause() {
  settingsSource = "pause";

  document.getElementById("pause-screen").classList.add("hidden");

  document.getElementById("settings-modal").classList.remove("hidden");
}

function exitToMenu() {
  if (window.OnlineMultiplayer) window.OnlineMultiplayer.leaveRoom();
  // Close all overlays
  isPaused = false;

  document.getElementById("pause-screen").classList.add("hidden");

  document.getElementById("settings-modal").classList.add("hidden");

  // Hide game
  document.getElementById("game-screen").classList.add("hidden");

  document.getElementById("result-screen").classList.add("hidden");

  // Show setup
  document.getElementById("setup-screen").classList.remove("hidden");

  // Stop music
  bgMusic.pause();
  bgMusic.currentTime = 0;

  // Reset game state
  players = [];
  tokens = [];
  ranks = [];
  turnIndex = 0;
  currentDice = 0;
  extraTurnGranted = false;
  diceLocked = false;
  state = "waiting";

  // Clear board
  document.getElementById("board").innerHTML = "";
  document.getElementById("tokens-layer").innerHTML = "";
  document.getElementById("rankings-list").innerHTML =
    "<li class='italic text-slate-700'>Arena empty.</li>";

  document.getElementById("game-log").innerText = "Initializing...";

  // Reset pause state
  pauseFocus = 0;
}
// ================== SOUND TOGGLE ==================
function toggleSound() {
  soundEnabled = !soundEnabled;

  const btn = document.getElementById("sound-btn");

  if (soundEnabled) {
    btn.innerText = "🔊 SOUND ON";
    bgMusic.play();
  } else {
    btn.innerText = "🔇 SOUND OFF";
    bgMusic.pause();
  }
}

// ================== CONTROLLER POPUP =====================

function showControllerToast(title, subtitle, connected = true) {
  const toast = document.getElementById("controller-toast");

  document.getElementById("controller-toast-title").textContent = title;

  document.getElementById("controller-toast-subtitle").textContent = subtitle;

  document.getElementById("controller-toast-icon").textContent = connected
    ? "🎮"
    : "⚠";

  toast.style.borderColor = connected ? "#00ff99" : "#ff4444";

  clearTimeout(controllerToastTimeout);

  toast.classList.add("show");

  controllerToastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// ================== SMART SLEEP (PAUSE SUPPORT) ==================
const sleep = (ms) =>
  new Promise((resolve) => {
    let start = Date.now();

    function check() {
      if (isPaused) {
        setTimeout(check, 100);
      } else if (Date.now() - start >= ms) {
        resolve();
      } else {
        setTimeout(check, 10);
      }
    }
    check();
  });
const COLORS = ["red", "green", "blue", "yellow"];
const HEX = {
  red: "#ff2a5f",
  green: "#0df0a3",
  blue: "#0ea5e9",
  yellow: "#facc15",
};

const mainTrack = [
  [6, 1],
  [6, 2],
  [6, 3],
  [6, 4],
  [6, 5],
  [5, 6],
  [4, 6],
  [3, 6],
  [2, 6],
  [1, 6],
  [0, 6],
  [0, 7],
  [0, 8],
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [6, 9],
  [6, 10],
  [6, 11],
  [6, 12],
  [6, 13],
  [6, 14],
  [7, 14],
  [8, 14],
  [8, 13],
  [8, 12],
  [8, 11],
  [8, 10],
  [8, 9],
  [9, 8],
  [10, 8],
  [11, 8],
  [12, 8],
  [13, 8],
  [14, 8],
  [14, 7],
  [14, 6],
  [13, 6],
  [12, 6],
  [11, 6],
  [10, 6],
  [9, 6],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
  [7, 0],
  [6, 0],
];
const startOffsets = { red: 0, green: 13, blue: 26, yellow: 39 };
const homeTracks = {
  red: [
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6],
  ],
  green: [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
    [6, 7],
  ],
  blue: [
    [7, 13],
    [7, 12],
    [7, 11],
    [7, 10],
    [7, 9],
    [7, 8],
  ],
  yellow: [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
    [8, 7],
  ],
};
const safeZones = ["6,1", "2,6", "1,8", "6,12", "8,13", "12,8", "13,6", "8,2"];
const baseCoords = {
  red: [
    [2, 2],
    [2, 3],
    [3, 2],
    [3, 3],
  ],
  green: [
    [2, 11],
    [2, 12],
    [3, 11],
    [3, 12],
  ],
  blue: [
    [11, 11],
    [11, 12],
    [12, 11],
    [12, 12],
  ],
  yellow: [
    [11, 2],
    [11, 3],
    [12, 2],
    [12, 3],
  ],
};

let players = [],
  tokens = [],
  turnIndex = 0,
  ranks = [],
  state = "waiting",
  currentDice = 0,
  extraTurnGranted = false;
let consecutiveSixes = 0;

function generateBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
        if (r === 6 && c === 6) {
          const center = document.createElement("div");
          center.className = "home-center";
          center.innerHTML = `
                                <svg class="crown-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5Z" fill="#facc15" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M5 18H19V20H5V18Z" fill="#facc15"/>
                                </svg>
                            `;
          board.appendChild(center);
        }
        continue;
      }

      const cell = document.createElement("div");
      cell.className = "cell";
      cell.id = `cell-${r}-${c}`;

      if (r < 6 && c < 6) applyBaseStyles(cell, r, c, "red");
      else if (r < 6 && c > 8) applyBaseStyles(cell, r, c - 9, "green");
      else if (r > 8 && c > 8) applyBaseStyles(cell, r - 9, c - 9, "blue");
      else if (r > 8 && c < 6) applyBaseStyles(cell, r - 9, c, "yellow");
      else if (r === 7 && c >= 1 && c <= 5) cell.classList.add("path-red");
      else if (c === 7 && r >= 1 && r <= 5) cell.classList.add("path-green");
      else if (r === 7 && c >= 9 && c <= 13) cell.classList.add("path-blue");
      else if (c === 7 && r >= 9 && r <= 13) cell.classList.add("path-yellow");

      if (
        (r === 6 && c === 1) ||
        (r === 1 && c === 8) ||
        (r === 8 && c === 13) ||
        (r === 13 && c === 6)
      ) {
        let col =
          r === 6 ? "red" : r === 1 ? "green" : r === 8 ? "blue" : "yellow";
        cell.classList.add("bg-" + col);
        cell.classList.add("safe-zone");
      } else if (safeZones.includes(`${r},${c}`)) {
        cell.classList.add("safe-zone");
      }
      board.appendChild(cell);
    }
  }
}

function applyBaseStyles(cell, lr, lc, color) {
  cell.style.background = `rgba(0,0,0,0.4)`;
  cell.style.borderColor = `rgba(255,255,255,0.05)`;
  if (lr >= 1 && lr <= 4 && lc >= 1 && lc <= 4) {
    cell.style.background = `radial-gradient(circle, rgba(0,0,0,0.8) 0%, #000 100%)`;
    cell.style.border = `1px solid var(--neon-${color})`;
    cell.style.boxShadow = `0 0 10px rgba(0,0,0,0.5), inset 0 0 15px var(--neon-${color}44)`;
  }
}
function createParticles(x, y, color) {
  if (!gameSettings.particles) return;
  const container = document.getElementById("tokens-layer");

  for (let i = 0; i < 8; i++) {
    const p = document.createElement("div");
    p.className = "particle";

    // 🎨 color
    p.style.background = color;

    // random direction
    const angle = Math.random() * 2 * Math.PI;
    const distance = 30 + Math.random() * 30;

    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    p.style.setProperty("--x", dx + "px");
    p.style.setProperty("--y", dy + "px");

    // position
    p.style.left = x + "px";
    p.style.top = y + "px";

    container.appendChild(p);

    // remove after animation
    setTimeout(() => p.remove(), 600);
  }
}

// Trail
function createTrail(token) {
  if (!gameSettings.tokenTrail) return;
  const trail = document.createElement("div");

  trail.className = `token-trail ${token.color}`;

  trail.style.left = token.el.style.left;
  trail.style.top = token.el.style.top;
  trail.style.transform = token.el.style.transform;

  document.getElementById("tokens-layer").appendChild(trail);

  trail.addEventListener("animationend", () => {
    trail.remove();
  });
}

function startMotion(token) {
  token.el.classList.add("moving");
}

function stopMotion(token) {
  token.el.classList.remove("moving");
}

function getTokenScreenPosition(t) {
  const rect = t.el.getBoundingClientRect();
  const parentRect = document
    .getElementById("tokens-layer")
    .getBoundingClientRect();

  return {
    x: rect.left - parentRect.left + rect.width / 2,
    y: rect.top - parentRect.top + rect.height / 2,
  };
}

window.startGame = function () {
  if (soundEnabled) bgMusic.play();
  players = [];
  tokens = [];
  const onlineConfig = window.OnlineMultiplayer?.getConfig();
  COLORS.forEach((color) => {
    const type = onlineConfig
      ? onlineConfig.colors.includes(color)
        ? "human"
        : "none"
      : document.getElementById(`p-${color}`).value;
    if (type !== "none") {
      players.push({ color, type, finished: false });
      for (let i = 0; i < 4; i++) {
        tokens.push({
          id: `${color}-${i}`,
          color,
          playerIndex: players.length - 1,
          state: "base",
          relPos: -1,
          el: null,
        });
      }
    }
  });
  if (players.length < 2) {
    document.getElementById("setup-err").classList.remove("hidden");
    return;
  }
  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  generateBoard();
  createTokensDom();
  if (typeof Haptics !== "undefined") {
    Haptics.startGame();
  }
  updateTokenVisuals();
  turnIndex = 0;
  updateTurnAura();
  state = "waiting";
  startTurn();
  if (onlineConfig && window.OnlineMultiplayer.shouldPublishInitialState()) {
    window.OnlineMultiplayer.syncGameState();
  }
};

function createTokensDom() {
  const layer = document.getElementById("tokens-layer");
  layer.innerHTML = "";
  tokens.forEach((t) => {
    const token = document.createElement("div");

    token.className = `token ${t.color}`;

    token.id = `token-${t.id}`;

    token.innerHTML = `
                    <div class="token-core">

                        <div class="token-ring"></div>

                        <div class="token-body"></div>

                        <div class="selection-corners">

                            <span class="tl"></span>
                            <span class="tr"></span>
                            <span class="bl"></span>
                            <span class="br"></span>

                        </div>

                    </div>
                    `;

    layer.appendChild(token);

    t.el = token;
  });
}

function getTokenCoords(t) {
  if (t.state === "base") {
    const idx = parseInt(t.id.split("-")[1]);
    return baseCoords[t.color][idx];
  }
  if (t.state === "track" || t.state === "home") {
    if (t.relPos <= 50) {
      const absIdx = (startOffsets[t.color] + t.relPos) % 52;
      return mainTrack[absIdx];
    } else {
      const homeIdx = t.relPos - 51;
      return homeTracks[t.color][homeIdx];
    }
  }
  return [0, 0];
}

function updateTokenVisuals() {
  const cellMap = {};
  tokens.forEach((t) => {
    if (t.state === "home" && t.relPos === 56) return;
    const [r, c] = getTokenCoords(t);
    const key = `${r},${c}`;
    if (!cellMap[key]) cellMap[key] = [];
    cellMap[key].push(t);
  });
  const step = 100 / 15;
  tokens.forEach((t) => {
    if (t.state === "home" && t.relPos === 56) {
      t.el.style.display = "none";
      return;
    }
    t.el.style.display = "block";
    const [r, c] = getTokenCoords(t);
    const key = `${r},${c}`;
    const siblings = cellMap[key];
    const count = siblings.length;
    const idx = siblings.indexOf(t);
    let baseTop = r * step;
    let baseLeft = c * step;
    let scale = 1,
      tx = 0,
      ty = 0;
    if (t.state !== "base" && count > 1) {
      scale = 0.65;
      const offsets = [
        [-15, -15],
        [15, 15],
        [-15, 15],
        [15, -15],
        [0, -20],
        [0, 20],
        [-20, 0],
        [20, 0],
      ];
      if (idx < offsets.length) {
        tx = offsets[idx][0];
        ty = offsets[idx][1];
      }
    }
    t.el.style.top = `${baseTop}%`;
    t.el.style.left = `${baseLeft}%`;
    t.el.style.transform = `scale(${scale}) translate(${tx}%, ${ty}%)`;
  });
}

function logMsg(msg) {
  document.getElementById("game-log").innerText = msg;
}
function createRipple(event) {
  const btn = event.currentTarget;

  const ripple = document.createElement("span");
  ripple.className = "ripple";

  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);

  ripple.style.width = size + "px";
  ripple.style.height = size + "px";

  ripple.style.left = event.clientX - rect.left + "px";

  ripple.style.top = event.clientY - rect.top + "px";

  btn.appendChild(ripple);

  ripple.addEventListener("animationend", () => {
    ripple.remove();
  });
}

async function startTurn() {
  if (isGameOver()) return;
  let cp = players[turnIndex];
  updateTurnAura();
  if (cp.finished) {
    turnIndex = (turnIndex + 1) % players.length;
    return startTurn();
  }
  extraTurnGranted = false;
  currentDice = 0;
  state = "waiting";
  const turnInd = document.getElementById("turn-indicator");
  turnInd.innerText = `${cp.color.toUpperCase()} TURN`;
  turnInd.parentElement.style.borderColor = HEX[cp.color];
  turnInd.style.color = HEX[cp.color];
  turnInd.style.textShadow = `0 0 10px ${HEX[cp.color]}55`;

  const btn = document.getElementById("dice-btn");
  btn.disabled = false;
  if (window.OnlineMultiplayer?.isActive() && !window.OnlineMultiplayer.canAct(cp.color)) {
    btn.disabled = true;
    logMsg(`Waiting for ${cp.color.toUpperCase()}...`);
    return;
  }
  if (cp.type === "ai") {
    btn.disabled = true;
    logMsg(`AI CALCULATING...`);
    await sleep(800);
    rollDiceLogic();
  } else {
    logMsg(`Ready to roll.`);
  }
}

function handleDiceClick() {
  if (diceLocked) return;

  if (state !== "waiting") return;

  if (players[turnIndex].type === "ai") return;
  if (window.OnlineMultiplayer?.isActive() && !window.OnlineMultiplayer.canAct(players[turnIndex].color)) return;

  diceLocked = true;

  state = "rolling";

  vibrate("dice");

  document.getElementById("dice-btn").disabled = true;

  rollDiceLogic();
}

async function rollDiceLogic() {
  playSound("dice");
  let rolls = 8;
  const diceFaces = [
    [4],
    [0, 8],
    [0, 4, 8],
    [0, 2, 6, 8],
    [0, 2, 4, 6, 8],
    [0, 2, 3, 5, 6, 8],
  ];
  const diceEl = document.getElementById("dice-visual");
  diceEl.classList.remove("roll-animation");

  // restart animation
  void diceEl.offsetWidth;

  diceEl.classList.add("roll-animation");
  const dots = diceEl.querySelectorAll(".dot");
  for (let i = 0; i < rolls; i++) {
    let v = Math.floor(Math.random() * 6) + 1;
    renderDice(v, dots, diceFaces);
    await sleep(30);
  }
  const cp = players[turnIndex];

  if (window.debugForcedDice) {
    currentDice = window.debugForcedDice;
    window.debugForcedDice = null;
  } else {
    currentDice = Math.floor(Math.random() * 6) + 1;
    // ===== Three consecutive sixes rule =====
    if (currentDice === 6) {
      consecutiveSixes++;

      if (consecutiveSixes >= 3) {
        logMsg("⚠ Three consecutive sixes! Turn skipped.");

        playSound("cut");
        vibrate("cut");
        Haptics.capture();

        if (typeof Haptics !== "undefined") {
          Haptics.capture(); // or Haptics.penalty() if you create one
        }

        // Dice shake animation
        const dice = document.getElementById("dice-btn");
        dice.classList.add("dice-penalty");

        setTimeout(() => {
          dice.classList.remove("dice-penalty");
        }, 450);

        currentDice = 0;
        extraTurnGranted = false;
        consecutiveSixes = 0;
        diceLocked = false;

        await sleep(800);

        endTurn();
        return;
      }
    } else {
      consecutiveSixes = 0;
    }
  }
  renderDice(currentDice, dots, diceFaces);
  logMsg(`Rolled a ${currentDice}.`);
  await sleep(220);
  diceEl.classList.remove("roll-animation");
  if (currentDice === 6 || currentDice === 1) extraTurnGranted = true;
  processMoves();
}

function renderDice(val, dots, faces) {
  dots.forEach((d) => d.classList.add("hidden"));
  faces[val - 1].forEach((idx) => dots[idx].classList.remove("hidden"));
}

function getValidTokens(player) {
  let pTokens = tokens.filter((t) => t.color === player.color);

  const valid = pTokens.filter((t) => {
    if (t.state === "base") return currentDice === 6;

    if (t.state === "track" || t.state === "home")
      return t.relPos + currentDice <= 56;

    return false;
  });

  // 🌉 Make valid tokens available globally
  window.validControllerTokens = valid;

  return valid;
}

async function processMoves() {
  let cp = players[turnIndex];
  let valid = getValidTokens(cp);
  selectedTokenIndex = 0;

  refreshSelectableTokens();

  if (valid.length === 0) {
    logMsg("No moves available.");
    await sleep(1000);
    endTurn();
    return;
  }

  if (valid.length === 1 && cp.type === "human") {
    executeMove(valid[0]);
    return;
  }

  if (cp.type === "human") {
    state = "selecting";

    logMsg("Choose a unit.");

    valid.forEach((t) => t.el.classList.add("highlight"));

    window.validControllerTokens = valid;

    selectedTokenIndex = 0;

    if (gamepad) {
      updateControllerHighlight();
    }
  } else {
    state = "animating";

    executeMove(aiChooseMove(valid));
  }
}

document.getElementById("tokens-layer").addEventListener("click", (e) => {
  if (state !== "selecting") return;
  if (window.OnlineMultiplayer?.isActive() && !window.OnlineMultiplayer.canAct(players[turnIndex].color)) return;

  let el = e.target.closest(".token");
  if (!el) return;

  vibrate("move"); // ✅ USER TOUCH → works perfectly

  let t = tokens.find((x) => x.id === el.id.replace("token-", ""));
  let valid = getValidTokens(players[turnIndex]);

  if (valid.includes(t)) {
    valid.forEach((vt) => vt.el.classList.remove("highlight"));
    executeMove(t);
  }
});

function aiChooseMove(validTokens) {
  let bestScore = -9999;
  let bestToken = validTokens[0];

  for (let t of validTokens) {
    let score = 0;

    let targetRel = t.state === "base" ? 0 : t.relPos + currentDice;

    // 🚀 ENTER BOARD
    if (t.state === "base") score += 60;

    // 🏁 FINISH PRIORITY
    if (targetRel === 56) score += 200;

    // 📍 POSITION CALC
    let coords = null;
    let isSafe = false;

    if (targetRel <= 50) {
      let absIdx = (startOffsets[t.color] + targetRel) % 52;
      coords = mainTrack[absIdx].join(",");
      isSafe = safeZones.includes(coords);
    }

    // 🩸 KILL BONUS (VERY HIGH)
    let canKill = tokens.some(
      (ot) =>
        ot.color !== t.color &&
        ot.state === "track" &&
        getTokenCoords(ot).join(",") === coords &&
        !isSafe,
    );

    if (canKill) score += 150;

    // 🛡 SAFE ZONE BONUS
    if (isSafe) score += 40;

    // ⚠️ DANGER CHECK (enemy nearby)
    let danger = tokens.some((ot) => {
      if (ot.color === t.color || ot.state !== "track") return false;

      let dist = (t.relPos - ot.relPos + 52) % 52;
      return dist > 0 && dist <= 6;
    });

    if (danger) score -= 50;

    // 🧠 PROGRESS FORWARD
    score += targetRel;

    // 🎯 RANDOMNESS (avoid predictable AI)
    score += Math.random() * 10;

    if (score > bestScore) {
      bestScore = score;
      bestToken = t;
    }
  }

  return bestToken;
}

async function executeMove(t) {
  if (window.OnlineMultiplayer?.isActive() && !window.OnlineMultiplayer.canAct(players[turnIndex].color)) return;
  state = "animating";
  window.validControllerTokens = [];

  selectedTokenIndex = 0;

  document
    .querySelectorAll(".controller-selected")
    .forEach((el) => el.classList.remove("controller-selected"));

  if (t.state === "base") {
    t.state = "track";
    t.relPos = 0;

    playSound("move");
    if (typeof Haptics !== "undefined") {
      Haptics.leaveBase();
    }
    updateTokenVisuals();

    await sleep(300);
  } else {
    startMotion(t);

    for (let i = 0; i < currentDice; i++) {
      t.relPos++;

      if (t.relPos > 50) t.state = "home";

      playSound("step", t);

      if (typeof Haptics !== "undefined") {
        Haptics.step();
      }

      createTrail(t);

      updateTokenVisuals();

      await sleep(170);
    }

    stopMotion(t); // <- only once after movement ends
  }

  t.el.classList.remove("controller-selected");
  t.el.style.zIndex = "";

  await checkInteractions(t);
}

async function checkInteractions(t) {
  if (t.relPos === 56) {
    logMsg(`Destination reached.`);
    playSound("win");
    vibrate("win"); // ✅ added
    if (typeof Haptics !== "undefined") {
      console.log("Vibrate");
      Haptics.victory();
    }
    if (typeof Haptics !== "undefined") {
      console.log("vibrate");
      Haptics.home();
    }

    const pos = getTokenScreenPosition(t);
    createParticles(pos.x, pos.y, HEX[t.color]);
    extraTurnGranted = true;

    await sleep(800);
    checkPlayerFinish(t.color);
  } else if (t.state === "track") {
    const currentCoords = getTokenCoords(t).join(",");
    if (!safeZones.includes(currentCoords)) {
      let cuts = tokens.filter(
        (ot) =>
          ot.color !== t.color &&
          ot.state === "track" &&
          getTokenCoords(ot).join(",") === currentCoords,
      );
      if (cuts.length > 0) {
        cuts.forEach((ot) => {
          ot.state = "base";
          ot.relPos = -1;
        });

        logMsg(`${t.color.toUpperCase()} unit captured.`);
        playSound("cut");
        vibrate("cut"); // ✅ added
        if (typeof Haptics !== "undefined") {
          console.log("Vibrate");
          Haptics.capture();
        }

        const pos = getTokenScreenPosition(t);
        createParticles(pos.x, pos.y, HEX[t.color]);

        extraTurnGranted = true;
        updateTokenVisuals();

        await sleep(800);
      }
    }
  }
  endTurn();
}

function checkPlayerFinish(color) {
  let pTokens = tokens.filter((t) => t.color === color);
  if (pTokens.every((t) => t.relPos === 56)) {
    let p = players.find((x) => x.color === color);
    if (!p.finished) {
      p.finished = true;
      ranks.push(color);
      updateRankingsUI();
    }
  }
}

function updateRankingsUI() {
  const list = document.getElementById("rankings-list");
  list.innerHTML = "";
  ranks.forEach((col, idx) => {
    list.innerHTML += `<li class="font-black" style="color:${HEX[col]}">${idx + 1}. ${col.toUpperCase()}</li>`;
  });
}

function endTurn() {
  if (isGameOver()) {
    window.OnlineMultiplayer?.syncGameState();
    return showResults();
  }

  if (!extraTurnGranted) {
    consecutiveSixes = 0;
    turnIndex = (turnIndex + 1) % players.length;
  }

  updateTurnAura();

  diceLocked = false;

  window.OnlineMultiplayer?.syncGameState();

  startTurn();
}

function isGameOver() {
  let active = players.filter((p) => !p.finished);
  if (active.length <= 1 && players.length > 1) {
    if (active.length === 1) ranks.push(active[0].color);
    return true;
  }
  return false;
}

function showResults() {
  playSound("win");
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("result-screen").classList.remove("hidden");
  const fr = document.getElementById("final-rankings");
  fr.innerHTML = ranks
    .map(
      (c, i) => `
                <div class="p-4 bg-black border border-[#333] rounded-xl font-black text-sm tracking-widest" style="color: ${HEX[c]}">
                    RANK ${i + 1}: ${c.toUpperCase()}
                </div>
            `,
    )
    .join("");
}

document.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", createRipple);
});

document.getElementById("open-settings-btn").addEventListener("click", () => {
  document.getElementById("settings-modal").classList.remove("hidden");
});

document.getElementById("close-settings-btn").addEventListener("click", () => {
  settingsModal.classList.add("hidden");

  if (settingsSource === "pause") {
    document.getElementById("pause-screen").classList.remove("hidden");

    settingsSource = "setup";
  }
});

function updateTurnAura() {
  // Remove previous player's aura
  tokens.forEach((t) => {
    t.el.classList.remove("turn-active", "turn-base");
  });

  if (!gameSettings.turnAura) {
    return;
  }

  const currentColor = players[turnIndex].color;

  tokens.forEach((t) => {
    if (t.color !== currentColor) return;

    if (t.state === "base") {
      t.el.classList.add("turn-base");
    } else {
      t.el.classList.add("turn-active");
    }
  });
}
