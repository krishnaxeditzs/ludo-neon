/* ============================================================
   LUDO NEON — ONLINE MULTIPLAYER CLIENT
   The server is authoritative. This file only renders server
   snapshots and forwards player intents.
   ============================================================ */
(function () {
    "use strict";

    const COLORS = ["red", "green", "blue", "yellow"];
    const HEX = {
        red: "#ff2a5f",
        green: "#0df0a3",
        blue: "#0ea5e9",
        yellow: "#facc15"
    };
    const SESSION_KEY = "ludo-neon-session";
    const SERVER_KEY = "ludo-neon-server-url";
    const NAME_KEY = "ludo-neon-name";
    const DICE_FACES = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

    const Online = {
        active: false,
        socket: null,
        connected: false,
        room: null,
        you: null,
        session: null,
        gameState: null,
        boardReady: false,
        animating: false,
        pendingState: null,
        movePending: false,
        diceLocked: false,
        wantReconnect: false,
        reconnecting: false,
        animationQueue: Promise.resolve(),
        animationEpoch: 0,
        pendingResults: null,
        dicePreviewTimer: null,
        dicePreviewSafety: null,
        lastDiceRevision: -1,
        lastMoveRevision: -1,
        resultsRevision: -1
    };

    /* ------------------------------ helpers ------------------------------ */

    function $(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const el = $(id);
        if (el) el.textContent = value;
    }

    function show(id, visible) {
        const el = $(id);
        if (el) el.classList.toggle("hidden", !visible);
    }

    function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    let toastTimer = null;
    function toast(message, kind) {
        const el = $("online-toast");
        if (!el || !message) return;
        el.textContent = message;
        el.className = "online-toast show" + (kind === "error" ? " error" : "");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.className = "online-toast";
        }, 3200);
    }

    function showBanner(message) {
        const el = $("connection-banner");
        if (!el) return;
        el.textContent = message;
        el.classList.remove("hidden");
    }

    function hideBanner() {
        const el = $("connection-banner");
        if (el) el.classList.add("hidden");
    }

    function resolveServerUrl() {
        const params = new URLSearchParams(location.search);
        const fromQuery = params.get("server");
        if (fromQuery) {
            try {
                localStorage.setItem(SERVER_KEY, fromQuery.replace(/\/+$/, ""));
            } catch (e) {}
        }
        let stored = null;
        try {
            stored = localStorage.getItem(SERVER_KEY);
        } catch (e) {}
        if (stored) return stored.replace(/\/+$/, "");
        if (window.LUDO_CONFIG && window.LUDO_CONFIG.serverUrl) {
            return String(window.LUDO_CONFIG.serverUrl).replace(/\/+$/, "");
        }
        if (location.protocol === "file:") return "http://localhost:3000";
        return location.origin;
    }

    function updateServerLabel() {
        const label = $("online-server-label");
        if (!label) return;
        const url = resolveServerUrl();
        label.textContent = url || "same origin";
        label.title = url;
    }

    function connectionError(err) {
        const base = "Cannot reach the game server";
        const url = resolveServerUrl();
        if (err && err.message && /socket/i.test(err.message)) return err.message;
        return `${base} at ${url}. Start it with "npm start" or set the backend URL in config.js.`;
    }

    /* ---------------------------- socket layer --------------------------- */

    function getSocket() {
        if (Online.socket) return Online.socket;
        if (typeof window.io !== "function") {
            throw new Error("Socket.IO client failed to load (vendor/socket.io.min.js).");
        }
        Online.socket = window.io(resolveServerUrl(), {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionDelay: 800,
            reconnectionDelayMax: 6000,
            timeout: 10000
        });
        bindSocket(Online.socket);
        return Online.socket;
    }

    function ensureConnected() {
        const socket = getSocket();
        if (socket.connected) return Promise.resolve(socket);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error("Timed out connecting to the game server."));
            }, 10000);
            function cleanup() {
                clearTimeout(timer);
                socket.off("connect", onConnect);
                socket.off("connect_error", onError);
            }
            function onConnect() {
                cleanup();
                resolve(socket);
            }
            function onError() {
                cleanup();
                reject(new Error("Could not connect to the game server."));
            }
            socket.once("connect", onConnect);
            socket.once("connect_error", onError);
            socket.connect();
        });
    }

    async function emitAck(event, payload) {
        const socket = await ensureConnected();
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({ ok: false, error: "The server did not respond in time." });
            }, 12000);
            socket.emit(event, payload, (response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(response || { ok: false, error: "Empty response from the server." });
            });
        });
    }

    function bindSocket(socket) {
        socket.on("connect", () => {
            Online.connected = true;
            hideBanner();
            updateConnectionUI();
            if (Online.session && (Online.wantReconnect || Online.active)) {
                resumeRoom(true);
            }
        });

        socket.on("disconnect", () => {
            Online.connected = false;
            Online.diceLocked = false;
            Online.movePending = false;
            stopDicePreview();
            updateConnectionUI();
            if (Online.active || Online.room) {
                showBanner("Connection lost — reconnecting to the room…");
            }
        });

        socket.on("connect_error", () => {
            Online.connected = false;
            updateConnectionUI();
            if (Online.active || Online.room) {
                showBanner(`Cannot reach the game server at ${resolveServerUrl()}`);
            }
        });

        socket.on("lobby-updated", (payload) => {
            if (!payload || !payload.room) return;
            Online.room = payload.room;
            if (!Online.active) {
                renderLobby(payload.room);
            } else {
                updateConnectionUI();
                refreshResultActions();
            }
        });

        socket.on("game-started", (payload) => {
            if (!payload || !payload.state) return;
            if (payload.room) Online.room = payload.room;
            enterOnlineGame(payload.state, { restarted: payload.rematch === true });
        });

        socket.on("dice-rolled", (payload) => {
            if (!payload || !payload.state) return;
            const revision = payload.state.revision;
            if (Number.isInteger(revision) && revision === Online.lastDiceRevision) return;
            if (Number.isInteger(revision)) Online.lastDiceRevision = revision;

            stopDicePreview();
            Online.diceLocked = true;
            const isRoller = !!Online.you && payload.playerId === Online.you.id;
            enqueueAnimation(async (epoch) => {
                Online.animating = true;
                try {
                    playSound("dice");
                    if (!isRoller) {
                        vibrate("dice");
                        if (typeof Haptics !== "undefined") Haptics.dice();
                    }
                    await animateDiceRoll(payload.dice);
                    const name = (payload.playerName || payload.color || "Player").toUpperCase();
                    if (payload.dice === 0) {
                        logMsg(`${name}: three consecutive sixes — turn skipped.`);
                        toast("Three sixes — turn lost!", "error");
                    } else if (payload.noMoves) {
                        logMsg(`${name} rolled ${payload.dice} — no legal moves.`);
                    } else {
                        logMsg(`${name} rolled ${payload.dice}.`);
                    }
                    if (payload.autoMove) {
                        await runMoveAnimation(
                            Object.assign({}, payload.autoMove, {
                                playerName: payload.playerName,
                                color: payload.color
                            })
                        );
                    }
                } finally {
                    if (epoch === Online.animationEpoch) {
                        settleAfterAnimation(payload.state);
                    }
                }
            });
        });

        socket.on("token-moved", (payload) => {
            if (!payload || !payload.state) return;
            const revision = payload.state.revision;
            if (Number.isInteger(revision) && revision === Online.lastMoveRevision) return;
            if (Number.isInteger(revision)) Online.lastMoveRevision = revision;
            enqueueAnimation(async (epoch) => {
                Online.animating = true;
                Online.movePending = true;
                try {
                    await runMoveAnimation(payload);
                } finally {
                    if (epoch === Online.animationEpoch) {
                        settleAfterAnimation(payload.state);
                    }
                }
            });
        });

        socket.on("game-state-updated", (payload) => {
            if (!payload || !payload.state) return;
            if (payload.reason === "turn-ended" && !Online.animating) {
                Online.movePending = false;
                Online.diceLocked = false;
            }
            applyServerState(payload.state);
        });

        socket.on("turn-timer", (payload) => {
            if (!payload || !payload.ok) return;
            // Ignore stale timers from previous turns
            if (payload.turnId !== Online.turnTimerId) return;
            
            const remaining = payload.remaining;
            const deadline = payload.deadline;
            
            if (remaining <= 0) {
                // Turn timeout handled server-side
                if (!Online.animating) {
                    Online.movePending = false;
                    Online.diceLocked = false;
                }
                return;
            }
            
            // Update the timer display
            const textEl = document.getElementById('timer-countdown');
            if (textEl) {
                textEl.textContent = `${remaining}s`;
                
                // Update colour based on remaining time
                if (remaining > 20) {
                    textEl.style.color = '#34d399'; // Green
                } else if (remaining > 10) {
                    textEl.style.color = '#f59e0b'; // Yellow
                } else {
                    textEl.style.color = '#f87171'; // Red
                }
            }
            
            // Update perimeter animation offset
            const perimeter = document.getElementById('perimeter-circle');
            if (perimeter) {
                const progress = (40 - remaining) / 40;
                const offset = 251.2 * progress;
                perimeter.style.strokeDashoffset = offset + 'px';
            }
        });

        socket.on("player-disconnected", (payload) => {
            if (!payload) return;
            if (payload.room) Online.room = payload.room;
            if (payload.state) applyServerState(payload.state);
            const name = payload.name || "A player";
            if (payload.permanent) {
                toast(`${name} left the match.`, "error");
                logMsg(`${name} left the match.`);
            } else {
                toast(`${name} disconnected — waiting for reconnection…`, "error");
                logMsg(`${name} disconnected. The match is paused for them.`);
            }
            updateConnectionUI();
        });

        socket.on("player-reconnected", (payload) => {
            if (!payload) return;
            if (payload.room) Online.room = payload.room;
            if (payload.state) applyServerState(payload.state);
            toast(`${payload.player ? payload.player.name : "A player"} reconnected.`);
            logMsg(`${payload.player ? payload.player.name : "Player"} is back.`);
        });

        socket.on("player-won", (payload) => {
            if (!payload || !payload.winner) return;
            toast(`${payload.winner.name} wins!`);
        });

        socket.on("game-over", (payload) => {
            if (!payload || !payload.state) return;
            if (Online.animating) {
                Online.pendingResults = payload.state;
                return;
            }
            showOnlineResults(payload.state);
        });

        socket.on("room-closed", (payload) => {
            const reason = payload && payload.reason;
            toast(reason === "empty" ? "The room was closed." : "The room is no longer available.", "error");
            clearSession();
            leaveUiToSetup();
        });

        socket.on("action-rejected", (payload) => {
            if (!payload || !payload.error) return;
            stopDicePreview();
            Online.diceLocked = false;
            Online.movePending = false;
            updateDiceAvailability(Online.gameState);
            toast(payload.error, "error");
            logMsg(payload.error);
        });
    }

    /* --------------------------- animation queue ------------------------- */

    function reducedMotion() {
        return !!(
            window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
    }

    function randomDiceFace(exclude) {
        let face = Math.floor(Math.random() * 6) + 1;
        if (exclude >= 1 && exclude <= 6 && face === exclude) {
            face = (face % 6) + 1;
        }
        return face;
    }

    function startDicePreview() {
        if (Online.dicePreviewTimer || Online.dicePreviewSafety) return;
        const diceEl = $("dice-visual");

        if (!reducedMotion() && diceEl) {
            const dots = diceEl.querySelectorAll(".dot");
            diceEl.classList.remove("roll-animation");
            void diceEl.offsetWidth;
            diceEl.classList.add("roll-animation");
            renderDice(randomDiceFace(0), dots, DICE_FACES);
            Online.dicePreviewTimer = setInterval(() => {
                renderDice(randomDiceFace(0), dots, DICE_FACES);
            }, 30);
        }

        Online.dicePreviewSafety = setTimeout(() => {
            stopDicePreview();
            Online.diceLocked = false;
            updateDiceAvailability(Online.gameState);
        }, 8000);
    }

    function stopDicePreview() {
        if (Online.dicePreviewTimer) {
            clearInterval(Online.dicePreviewTimer);
            Online.dicePreviewTimer = null;
        }
        if (Online.dicePreviewSafety) {
            clearTimeout(Online.dicePreviewSafety);
            Online.dicePreviewSafety = null;
        }
        const diceEl = $("dice-visual");
        if (diceEl) diceEl.classList.remove("roll-animation");
        const gs = Online.gameState;
        showDiceValue(gs && gs.state === "awaiting-move" ? gs.dice : 0);
    }

    async function animateDiceRoll(value) {
        const diceEl = $("dice-visual");
        if (!diceEl) return;
        const dots = diceEl.querySelectorAll(".dot");

        // Always show the rolling animation for consistent cross-platform feel.
        // reducedMotion users still get a single-frame reveal after the loop.
        diceEl.classList.remove("roll-animation");
        void diceEl.offsetWidth;
        diceEl.classList.add("roll-animation");
        for (let i = 0; i < 8; i++) {
            renderDice(randomDiceFace(value), dots, DICE_FACES);
            await sleep(30);
        }
        showDiceValue(value);
        await sleep(220);
        diceEl.classList.remove("roll-animation");
    }

    function enqueueAnimation(task) {
        const epoch = Online.animationEpoch;
        const guarded = () => (epoch === Online.animationEpoch ? task(epoch) : null);
        const run = Online.animationQueue.then(guarded, guarded);
        Online.animationQueue = run.catch(() => {});
        return run;
    }

    function settleAfterAnimation(state) {
        Online.animating = false;
        Online.diceLocked = false;
        Online.movePending = false;

        if (state) applyServerState(state, { force: true });

        const pending = Online.pendingState;
        Online.pendingState = null;
        if (pending && (!Online.gameState || pending.revision > Online.gameState.revision)) {
            applyServerState(pending, { force: true });
        }

        const results = Online.pendingResults;
        Online.pendingResults = null;
        const gameScreen = $("game-screen");
        if (results && gameScreen && !gameScreen.classList.contains("hidden")) {
            showOnlineResults(results);
        }

        updateDiceAvailability(Online.gameState);
    }

    /* --------------------------- setup / lobby UI ------------------------- */

    const localState = {
        count: 2,
        players: [
            { name: "Player 1", color: "red" },
            { name: "Player 2", color: "blue" },
            { name: "Player 3", color: "green" },
            { name: "Player 4", color: "yellow" }
        ]
    };

    function buildLocalPlayers() {
        const container = $("local-players");
        if (!container) return;
        container.innerHTML = "";

        for (let i = 0; i < localState.count; i++) {
            const entry = localState.players[i];
            const row = document.createElement("div");
            row.className = "mp-player-row";
            row.dataset.index = String(i);

            const swatch = document.createElement("span");
            swatch.className = "mp-swatch";
            swatch.style.background = HEX[entry.color];

            const input = document.createElement("input");
            input.className = "mp-input mp-name-input";
            input.maxLength = 16;
            input.value = entry.name;
            input.setAttribute("aria-label", `Player ${i + 1} name`);

            const select = document.createElement("select");
            select.className = "mp-input mp-color-select";
            select.setAttribute("aria-label", `Player ${i + 1} color`);
            COLORS.forEach((color) => {
                const option = document.createElement("option");
                option.value = color;
                option.textContent = color.toUpperCase();
                if (color === entry.color) option.selected = true;
                select.appendChild(option);
            });

            input.addEventListener("input", () => {
                localState.players[i].name = input.value;
            });
            select.addEventListener("change", () => {
                localState.players[i].color = select.value;
                swatch.style.background = HEX[select.value];
            });

            row.appendChild(swatch);
            row.appendChild(input);
            row.appendChild(select);
            container.appendChild(row);
        }
    }

    function setLocalError(message) {
        const el = $("local-err");
        if (!el) return;
        el.textContent = message || "";
        el.classList.toggle("hidden", !message);
    }

    function startLocalMatch() {
        setLocalError("");
        const rows = Array.from(document.querySelectorAll("#local-players .mp-player-row"));
        const config = [];
        const used = new Set();

        rows.forEach((row, i) => {
            const input = row.querySelector(".mp-name-input");
            const select = row.querySelector(".mp-color-select");
            const name = (input.value || "").trim() || `Player ${i + 1}`;
            const color = select.value;
            if (used.has(color)) {
                setLocalError("Each player needs a different color.");
                return;
            }
            used.add(color);
            config.push({ color, type: "human", name });
        });

        if (config.length !== rows.length) return;
        if (config.length < 2) {
            setLocalError("Local multiplayer needs at least 2 players.");
            return;
        }

        Online.active = false;
        Online.wantReconnect = false;
        resetResultButtons();
        startGameWithConfig(config);
    }

    function setMode(mode) {
        document.querySelectorAll(".mode-tab").forEach((tab) => {
            const isActive = tab.dataset.mode === mode;
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        show("setup-single", mode === "single");
        show("setup-local", mode === "local");
        show("setup-online", mode === "online");
        if (mode === "online") updateServerLabel();
    }

    function setOnlineError(message) {
        const el = $("online-err");
        if (!el) return;
        el.textContent = message || "";
        el.classList.toggle("hidden", !message);
    }

    function clearOnlineError() {
        setOnlineError("");
    }

    function onlineName() {
        const input = $("online-name");
        return input ? input.value.trim() : "";
    }

    function rememberName(name) {
        try {
            localStorage.setItem(NAME_KEY, name);
        } catch (e) {}
    }

    function saveSession(session) {
        Online.session = session;
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (e) {}
    }

    function clearSession() {
        Online.session = null;
        try {
            localStorage.removeItem(SESSION_KEY);
        } catch (e) {}
        const resume = $("online-resume-btn");
        if (resume) resume.classList.add("hidden");
    }

    function handleRoomAuth(response) {
        if (!response || !response.you) return;
        Online.you = response.you;
        Online.room = response.room;
        Online.wantReconnect = true;
        saveSession({
            code: response.code,
            playerId: response.you.id,
            token: response.token,
            name: response.you.name
        });
        rememberName(response.you.name);
        if (response.state) {
            enterOnlineGame(response.state);
        } else {
            renderLobby(response.room);
        }
    }

    async function createRoom() {
        clearOnlineError();
        const name = onlineName();
        if (!name) return setOnlineError("Enter your name first.");
        rememberName(name);

        const btn = $("create-room-btn");
        btn.disabled = true;
        try {
            const response = await emitAck("create-room", {
                name,
                color: $("online-color").value || null
            });
            if (!response.ok) return setOnlineError(response.error || "Could not create the room.");
            handleRoomAuth(response);
        } catch (err) {
            setOnlineError(connectionError(err));
        } finally {
            btn.disabled = false;
        }
    }

    async function joinRoom() {
        clearOnlineError();
        const name = onlineName();
        if (!name) return setOnlineError("Enter your name first.");
        const code = ($("join-code").value || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{4,6}$/.test(code)) return setOnlineError("Enter a valid room code.");
        rememberName(name);

        const btn = $("join-room-btn");
        btn.disabled = true;
        try {
            const response = await emitAck("join-room", {
                code,
                name,
                color: $("online-color").value || null
            });
            if (!response.ok) return setOnlineError(response.error || "Could not join the room.");
            handleRoomAuth(response);
        } catch (err) {
            setOnlineError(connectionError(err));
        } finally {
            btn.disabled = false;
        }
    }

    async function resumeRoom(silent) {
        if (!Online.session || Online.reconnecting) return;
        Online.reconnecting = true;
        try {
            const response = await emitAck("reconnect-player", {
                code: Online.session.code,
                playerId: Online.session.playerId,
                token: Online.session.token
            });
            if (!response.ok) {
                clearSession();
                if (!silent) setOnlineError(response.error || "Could not rejoin that room.");
                else leaveUiToSetup();
                return;
            }
            Online.you = response.you;
            Online.room = response.room;
            Online.wantReconnect = true;
            saveSession({
                code: response.code,
                playerId: response.you.id,
                token: response.token || Online.session.token,
                name: response.you.name
            });
            if (response.state) {
                enterOnlineGame(response.state, { resumed: true });
                toast(`Reconnected to room ${response.code}`);
            } else {
                renderLobby(response.room);
                toast(`Reconnected to room ${response.code}`);
            }
        } catch (err) {
            if (!silent) setOnlineError(connectionError(err));
        } finally {
            Online.reconnecting = false;
        }
    }

    function renderLobby(room) {
        if (!room) return;
        Online.room = room;
        Online.active = false;
        show("setup-screen", false);
        show("game-screen", false);
        show("result-screen", false);
        show("lobby-screen", true);
        hideHud();

        setText("lobby-code", room.code);
        setText("lobby-count", `${room.players.length}/${room.maxPlayers}`);

        const me = room.players.find((p) => p.id === (Online.you && Online.you.id));
        if (me) Online.you = Object.assign({}, Online.you, me);

        const connectedCount = room.players.filter((p) => p.connected).length;
        const status = $("lobby-status-text");
        if (status) {
            status.textContent = Online.connected === false
                ? "Reconnecting…"
                : `${connectedCount} connected · ${room.status === "lobby" ? "waiting to start" : room.status}`;
        }

        const list = $("lobby-players");
        if (list) {
            list.innerHTML = room.players
                .map((player) => {
                    const isYou = player.id === (Online.you && Online.you.id);
                    return `<li class="lobby-player">
                        <span class="lobby-swatch" style="background:${HEX[player.color] || "#fff"}"></span>
                        <span class="lobby-player-name">${esc(player.name)}${isYou ? " (you)" : ""}</span>
                        <span class="lobby-player-meta">${player.color.toUpperCase()}</span>
                        <span class="lobby-player-tag">${player.isHost ? "👑 HOST" : "PLAYER"} ${player.connected ? "🟢" : "🔴"}</span>
                    </li>`;
                })
                .join("");
        }

        const isHost = room.hostId === (Online.you && Online.you.id);
        const startBtn = $("lobby-start-btn");
        if (startBtn) {
            startBtn.classList.toggle("hidden", !isHost);
            startBtn.disabled = room.players.length < room.minPlayers;
        }

        const hint = $("lobby-hint");
        if (hint) {
            if (!isHost) {
                hint.textContent = "Waiting for the host to start the match…";
            } else if (room.players.length < room.minPlayers) {
                hint.textContent = "Waiting for at least one more player. Share the room code.";
            } else {
                hint.textContent = "Everyone in? Start the match.";
            }
        }
        updateConnectionUI();
    }

    function updateConnectionUI() {
        const connected = Online.connected !== false;
        const dot = $("hud-dot");
        if (dot) dot.classList.toggle("offline", !connected);
        const lobbyDot = $("lobby-dot");
        if (lobbyDot) lobbyDot.classList.toggle("offline", !connected);
        const label = $("hud-connection");
        if (label) label.textContent = connected ? "CONNECTED" : "RECONNECTING";
    }

    /* ------------------------------ game UI ------------------------------ */

    function isMyTurn(state) {
        if (!state || !Online.you) return false;
        const current = state.players[state.turnIndex];
        return !!current && current.id === Online.you.id;
    }

    function playerNameOf(state, index) {
        const player = state && state.players[index];
        return (player && (player.name || player.color)) || "Player";
    }

    function hideHud() {
        show("online-hud", false);
        show("online-wait", false);
    }

    function applyServerState(gs, opts) {
        opts = opts || {};
        if (!gs) return;
        if (!opts.force && Online.gameState && gs.revision < Online.gameState.revision) {
            return;
        }
        if (Online.animating && !opts.force) {
            if (!Online.pendingState || gs.revision >= Online.pendingState.revision) {
                Online.pendingState = gs;
            }
            return;
        }
        if (!Online.boardReady) {
            rebuildBoard(gs);
        } else if ((tokens || []).some((t) => !t.el)) {
            rebuildBoard(gs);
        }

        Online.gameState = gs;

        const previousEls = {};
        (tokens || []).forEach((t) => {
            if (t.el) previousEls[t.id] = t.el;
        });

        players = gs.players.map((player, index) => ({
            id: player.id,
            color: player.color,
            name: player.name,
            type: "human",
            finished: player.finished,
            online: player.connected,
            seat: index
        }));

        tokens = gs.tokens.map((t) => ({
            id: t.id,
            color: t.color,
            playerIndex: gs.players.findIndex((p) => p.color === t.color),
            state: t.state,
            relPos: t.relPos,
            el: previousEls[t.id] || document.getElementById("token-" + t.id) || null
        }));

        turnIndex = gs.turnIndex;
        ranks = gs.ranks.slice();
        currentDice = gs.dice;
        extraTurnGranted = false;
        state = isMyTurn(gs) && gs.state === "awaiting-move" ? "selecting" : "waiting";
        window.validControllerTokens = [];

        updateTokenVisuals();
        if (players.length) updateTurnAura();

        updateTurnIndicator(gs);
        updateDiceAvailability(gs);
        updateLegalHighlights(gs);
        renderOnlineRankings(gs);
        updateWaitingMessage(gs);

        setText("hud-you", "YOU: " + (Online.you ? Online.you.color.toUpperCase() : "—"));
        setText("hud-room", "ROOM " + (Online.room ? Online.room.code : Online.session ? Online.session.code : "-----"));

        if (gs.state === "finished") showOnlineResults(gs);
    }

    function rebuildBoard(gs) {
        players = [];
        tokens = [];
        generateBoard();
        players = gs.players.map((player, index) => ({
            id: player.id,
            color: player.color,
            name: player.name,
            type: "human",
            finished: player.finished,
            online: player.connected,
            seat: index
        }));
        tokens = gs.tokens.map((t) => ({
            id: t.id,
            color: t.color,
            playerIndex: gs.players.findIndex((p) => p.color === t.color),
            state: t.state,
            relPos: t.relPos,
            el: null
        }));
        createTokensDom();
        Online.boardReady = true;
    }

    function updateTurnIndicator(gs) {
        const ind = $("turn-indicator");
        if (!ind) return;
        const current = gs.players[gs.turnIndex];
        if (!current) return;
        const color = HEX[current.color] || "#fff";
        ind.innerText = isMyTurn(gs) ? "YOUR TURN" : `${(current.name || current.color).toUpperCase()} TURN`;
        ind.parentElement.style.borderColor = color;
        ind.style.color = color;
        ind.style.textShadow = `0 0 10px ${color}55`;
    }

    function updateDiceAvailability(gs) {
        if (!Online.active) return;
        const btn = $("dice-btn");
        if (!btn) return;
        const canRoll = !!gs && isMyTurn(gs) && gs.state === "awaiting-roll" && !Online.diceLocked;
        btn.disabled = !canRoll;
        btn.classList.toggle("online-disabled", !canRoll);
    }

    function updateLegalHighlights(gs) {
        if (!tokens || !tokens.length) return;
        const legal = new Set();
        if (gs && gs.state === "awaiting-move" && isMyTurn(gs)) {
            (gs.legalTokenIds || []).forEach((id) => legal.add(id));
        }
        tokens.forEach((t) => {
            if (!t.el) return;
            t.el.classList.toggle("highlight", legal.has(t.id));
            t.el.classList.toggle("online-movable", legal.has(t.id));
        });
    }

    function renderOnlineRankings(gs) {
        const list = $("rankings-list");
        if (!list) return;
        if (!gs.ranks.length) {
            list.innerHTML = '<li class="italic text-slate-700">Arena empty.</li>';
            return;
        }
        list.innerHTML = gs.ranks
            .map((color, index) => {
                const owner = gs.players.find((p) => p.color === color);
                const name = owner ? owner.name : color;
                return `<li class="font-black" style="color:${HEX[color] || "#fff"}">${index + 1}. ${esc(
                    name.toUpperCase()
                )}</li>`;
            })
            .join("");
    }

    function updateWaitingMessage(gs) {
        if (!Online.active) return;
        const el = $("online-wait");
        if (!el) return;
        let message = "";
        if (gs.state === "resolving") {
            message = "Resolving turn…";
        } else if (!isMyTurn(gs)) {
            const name = playerNameOf(gs, gs.turnIndex);
            message = gs.state === "awaiting-move"
                ? `Waiting for ${name} to move…`
                : `Waiting for ${name} to roll…`;
        } else if (gs.state === "awaiting-roll") {
            message = "Your turn — roll the dice.";
        }
        if (!message) {
            el.classList.add("hidden");
        } else {
            el.textContent = message;
            el.classList.remove("hidden");
        }
    }

    function showDiceValue(value) {
        const diceEl = $("dice-visual");
        if (!diceEl) return;
        const dots = diceEl.querySelectorAll(".dot");
        if (value >= 1 && value <= 6) {
            renderDice(value, dots, DICE_FACES);
        } else {
            dots.forEach((dot) => dot.classList.add("hidden"));
        }
    }

    function showOnlineResults(gs) {
        const revision = gs && Number.isInteger(gs.revision) ? gs.revision : -1;
        if (revision >= 0 && revision === Online.resultsRevision) return;
        Online.resultsRevision = revision;
        Online.active = true;
        Online.pendingResults = null;
        show("game-screen", false);
        show("result-screen", true);
        hideHud();

        const winner = gs.players.find((p) => p.color === gs.winner);
        const subtitle = $("result-subtitle");
        if (subtitle) {
            subtitle.textContent = winner ? `${winner.name} wins the arena` : "Battle finalized";
        }

        const finalRankings = $("final-rankings");
        if (finalRankings) {
            finalRankings.innerHTML = gs.ranks
                .map((color, index) => {
                    const owner = gs.players.find((p) => p.color === color);
                    const name = owner ? owner.name : color;
                    return `<div class="p-4 bg-black border border-[#333] rounded-xl font-black text-sm tracking-widest" style="color:${HEX[color] || "#fff"}">
                        RANK ${index + 1}: ${esc(name.toUpperCase())}
                    </div>`;
                })
                .join("");
        }

        refreshResultActions();
        playSound("win");
        if (Online.room) Online.room.status = "finished";
    }

    function refreshResultActions() {
        if (!Online.active) return;
        const primary = $("result-primary-btn");
        const secondary = $("result-secondary-btn");
        if (!primary || !secondary) return;
        const isHost = !!Online.room && !!Online.you && Online.room.hostId === Online.you.id;
        primary.textContent = isHost ? "↻ PLAY AGAIN" : "WAITING FOR HOST…";
        primary.disabled = !isHost;
        primary.classList.toggle("opacity-50", !isHost);
        secondary.classList.remove("hidden");
    }

    function resetResultButtons() {
        const primary = $("result-primary-btn");
        const secondary = $("result-secondary-btn");
        if (primary) {
            primary.textContent = "NEW SIMULATION";
            primary.disabled = false;
            primary.classList.remove("opacity-50");
        }
        if (secondary) secondary.classList.add("hidden");
        const subtitle = $("result-subtitle");
        if (subtitle) subtitle.textContent = "Battle Finalized";
    }

    async function runMoveAnimation(event) {
        const move = event.move;
        if (!move) return;
        const token = (tokens || []).find((t) => t.id === event.tokenId);
        if (!token || !token.el) return;

        Online.animating = true;
        token.el.style.zIndex = "50";

        if (move.from.state === "base") {
            token.state = "track";
            token.relPos = 0;
            playSound("move");
            vibrate("move");
            if (typeof Haptics !== "undefined") Haptics.leaveBase();
            startMotion(token);
            for (let i = 0; i < move.path.length; i++) {
                token.relPos = move.path[i];
                if (token.relPos > 50) token.state = "home";
                playSound("step");
                vibrate("step");
                if (typeof Haptics !== "undefined") Haptics.step();
                createTrail(token);
                updateTokenVisuals();
                await sleep(170);
            }
            stopMotion(token);
        } else {
            startMotion(token);
            vibrate("move");
            for (let i = 0; i < move.path.length; i++) {
                token.relPos = move.path[i];
                if (token.relPos > 50) token.state = "home";
                playSound("step");
                vibrate("step");
                if (typeof Haptics !== "undefined") Haptics.step();
                createTrail(token);
                updateTokenVisuals();
                await sleep(170);
            }
            stopMotion(token);
        }

        if (move.captures && move.captures.length) {
            move.captures.forEach((capture) => {
                const victim = (tokens || []).find((t) => t.id === capture.id);
                if (victim) {
                    victim.state = "base";
                    victim.relPos = -1;
                }
            });
            if (token.el.style.display !== "none") {
                const pos = getTokenScreenPosition(token);
                createParticles(pos.x, pos.y, "#ffffff");
            }
            playSound("cut");
            vibrate("cut");
            if (typeof Haptics !== "undefined") Haptics.capture();
            const mover = (event.playerName || event.color || "Player").toUpperCase();
            logMsg(`${mover} captured ${move.captures.length} token(s)!`);
            updateTokenVisuals();
            await sleep(800);
        }

        if (move.reachedHome) {
            if (token.el.style.display !== "none") {
                const pos = getTokenScreenPosition(token);
                createParticles(pos.x, pos.y, HEX[token.color] || "#fff");
            }
            playSound("win");
            vibrate("win");
            if (typeof Haptics !== "undefined") {
                Haptics.victory();
                Haptics.home();
            }
            logMsg(`${(event.playerName || event.color || "Player").toUpperCase()} reached home!`);
            await sleep(800);
        }

        token.el.style.zIndex = "";
    }

    function enterOnlineGame(gs, opts) {
        opts = opts || {};
        Online.active = true;
        Online.wantReconnect = true;
        stopDicePreview();
        Online.animationEpoch += 1;
        Online.animationQueue = Promise.resolve();
        Online.animating = false;
        Online.pendingState = null;
        Online.pendingResults = null;
        Online.movePending = false;
        Online.diceLocked = false;
        Online.lastDiceRevision = -1;
        Online.lastMoveRevision = -1;
        Online.resultsRevision = -1;

        show("setup-screen", false);
        show("lobby-screen", false);
        show("result-screen", false);
        show("game-screen", true);
        show("online-hud", true);
        isPaused = false;
        hideBanner();
        resetResultButtons();
        hideBanner();

        if (!Online.boardReady || opts.restarted) {
            rebuildBoard(gs);
        }
        applyServerState(gs, { force: true });
        // Initialize dice face immediately so it's never blank on any mode
        showDiceValue(gs.state === "awaiting-move" ? gs.dice : 1);
        updateConnectionUI();

        if (!opts.resumed && typeof Haptics !== "undefined") Haptics.startGame();
        bgMusic.play().catch(() => {});
        if (opts.restarted) logMsg("New match started.");
        if (opts.resumed) logMsg("Reconnected — game restored.");
    }

    function leaveUiToSetup() {
        stopDicePreview();
        Online.animationEpoch += 1;
        Online.animationQueue = Promise.resolve();
        Online.active = false;
        Online.wantReconnect = false;
        Online.boardReady = false;
        Online.animating = false;
        Online.pendingState = null;
        Online.pendingResults = null;
        Online.movePending = false;
        Online.diceLocked = false;
        Online.lastDiceRevision = -1;
        Online.lastMoveRevision = -1;
        Online.resultsRevision = -1;
        Online.gameState = null;
        Online.room = null;
        Online.you = null;
        hideHud();
        hideBanner();
        resetResultButtons();
        show("lobby-screen", false);
        show("game-screen", false);
        show("result-screen", false);
        show("setup-screen", true);
        setMode("online");
    }

    async function leaveRoom(opts) {
        opts = opts || {};
        const socket = Online.socket;
        if (socket && socket.connected) {
            try {
                await emitAck("leave-room", {});
            } catch (e) {}
        }
        clearSession();
        leaveUiToSetup();
        if (!opts.silent) toast("Left the room.");
    }

    async function requestRematch() {
        const response = await emitAck("rematch", {}).catch((err) => ({ ok: false, error: connectionError(err) }));
        if (!response || !response.ok) {
            toast((response && response.error) || "Could not restart the match.", "error");
        }
    }

    function handleDiceClick() {
        const gs = Online.gameState;
        if (!gs || Online.diceLocked) return;
        if (gs.state !== "awaiting-roll") return;
        if (!isMyTurn(gs)) {
            toast("Wait for your turn.");
            return;
        }
        Online.diceLocked = true;
        vibrate("dice");
        updateDiceAvailability(gs);
        startDicePreview();
        emitAck("roll-dice", {})
            .then((response) => {
                if (!response || !response.ok) {
                    stopDicePreview();
                    Online.diceLocked = false;
                    updateDiceAvailability(Online.gameState);
                    if (response) toast(response.error || "Roll rejected.", "error");
                    return;
                }

                // If the room broadcast is lost, never leave the board locked.
                if (response.state) {
                    setTimeout(() => {
                        if (
                            Online.diceLocked &&
                            Online.gameState &&
                            response.state.revision > Online.gameState.revision
                        ) {
                            stopDicePreview();
                            Online.diceLocked = false;
                            applyServerState(response.state, { force: true });
                        }
                    }, 2500);
                }
            })
            .catch((err) => {
                stopDicePreview();
                Online.diceLocked = false;
                updateDiceAvailability(Online.gameState);
                toast(connectionError(err), "error");
            });
    }

    function submitMove(tokenId) {
        const gs = Online.gameState;
        if (!gs || gs.state !== "awaiting-move") return;
        if (!isMyTurn(gs)) {
            toast("Wait for your turn.");
            return;
        }
        if (!(gs.legalTokenIds || []).includes(tokenId)) {
            toast("That token cannot make that move.", "error");
            return;
        }
        if (Online.movePending) return;

        Online.movePending = true;
        emitAck("move-token", { tokenId })
            .then((response) => {
                if (!response || !response.ok) {
                    Online.movePending = false;
                    if (response) toast(response.error || "Move rejected.", "error");
                }
            })
            .catch((err) => {
                Online.movePending = false;
                toast(connectionError(err), "error");
            });
    }

    function handleTokenClick(event) {
        const el = event.target.closest ? event.target.closest(".token") : null;
        if (!el) return;
        event.preventDefault();
        submitMove(el.id.replace("token-", ""));
    }

    function copyRoomCode() {
        const code = Online.room ? Online.room.code : Online.session ? Online.session.code : "";
        if (!code) return;
        const done = () => toast(`Room code ${code} copied.`);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(done).catch(() => toast(`Room code: ${code}`));
        } else {
            toast(`Room code: ${code}`);
        }
    }

    function restoreSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (raw) Online.session = JSON.parse(raw);
        } catch (e) {
            Online.session = null;
        }

        const resumeBtn = $("online-resume-btn");
        if (Online.session && Online.session.code && resumeBtn) {
            resumeBtn.textContent = `↻ RESUME ROOM ${Online.session.code}`;
            resumeBtn.classList.remove("hidden");
        }

        const savedName = localStorage.getItem(NAME_KEY);
        if (savedName && $("online-name")) $("online-name").value = savedName;

        const params = new URLSearchParams(location.search);
        if (params.get("room") && $("join-code")) {
            $("join-code").value = params.get("room").toUpperCase();
        }
        if (params.get("resume") === "1" && Online.session) {
            Online.wantReconnect = true;
            ensureConnected()
                .then(() => resumeRoom(false))
                .catch((err) => setOnlineError(connectionError(err)));
        }
    }

    /* ------------------------------- wiring ------------------------------ */

    function bindUi() {
        document.querySelectorAll(".mode-tab").forEach((tab) => {
            tab.addEventListener("click", () => setMode(tab.dataset.mode));
        });

        document.querySelectorAll(".mp-count-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                localState.count = Number(btn.dataset.count);
                document.querySelectorAll(".mp-count-btn").forEach((b) => {
                    b.classList.toggle("active", b === btn);
                });
                buildLocalPlayers();
                setLocalError("");
            });
        });

        const localStart = $("local-start-btn");
        if (localStart) localStart.addEventListener("click", startLocalMatch);

        const localSettings = $("local-settings-btn");
        if (localSettings) {
            localSettings.addEventListener("click", () => {
                settingsSource = "setup";
                $("settings-modal").classList.remove("hidden");
            });
        }

        const createBtn = $("create-room-btn");
        if (createBtn) createBtn.addEventListener("click", createRoom);

        const joinBtn = $("join-room-btn");
        if (joinBtn) joinBtn.addEventListener("click", joinRoom);

        const joinCode = $("join-code");
        if (joinCode) {
            joinCode.addEventListener("keydown", (event) => {
                if (event.key === "Enter") joinRoom();
            });
            joinCode.addEventListener("input", () => {
                joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            });
        }

        const resumeBtn = $("online-resume-btn");
        if (resumeBtn) {
            resumeBtn.addEventListener("click", () => {
                clearOnlineError();
                resumeRoom(false);
            });
        }

        const copyBtn = $("copy-code-btn");
        if (copyBtn) copyBtn.addEventListener("click", copyRoomCode);

        const lobbyStart = $("lobby-start-btn");
        if (lobbyStart) {
            lobbyStart.addEventListener("click", async () => {
                lobbyStart.disabled = true;
                const response = await emitAck("start-game", {}).catch((err) => ({
                    ok: false,
                    error: connectionError(err)
                }));
                if (!response || !response.ok) {
                    lobbyStart.disabled = false;
                    toast((response && response.error) || "Could not start the match.", "error");
                }
            });
        }

        const lobbyLeave = $("lobby-leave-btn");
        if (lobbyLeave) lobbyLeave.addEventListener("click", () => leaveRoom());

        updateServerLabel();
        buildLocalPlayers();
        setMode("single");
    }

    Online.handleDiceClick = handleDiceClick;
    Online.handleTokenClick = handleTokenClick;
    Online.submitMove = submitMove;
    Online.leaveRoom = leaveRoom;
    Online.requestRematch = requestRematch;
    Online.resumeRoom = resumeRoom;
    window.LudoOnline = Online;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindUi);
    } else {
        bindUi();
    }
})();
