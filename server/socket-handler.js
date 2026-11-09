"use strict";

const { RoomError, lobbyView, MAX_PLAYERS } = require("./room-manager");
const { COLORS } = require("../shared/ludo-core");

const FORFEIT_AFTER_MS = Number(process.env.FORFEIT_AFTER_MS) || 5 * 60 * 1000;
const ROOM_CODE_RE = /^[A-Z0-9]{4,6}$/;

function cleanName(value) {
    if (typeof value !== "string") return "";
    return value
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 16);
}

function cleanCode(value) {
    if (typeof value !== "string") return "";
    return value.trim().toUpperCase().slice(0, 6);
}

function createRateLimiter() {
    const buckets = new Map();
    return function allow(key, max, windowMs) {
        const now = Date.now();
        const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
        if (hits.length >= max) {
            buckets.set(key, hits);
            return false;
        }
        hits.push(now);
        buckets.set(key, hits);
        return true;
    };
}

/**
 * Wires Socket.IO events to the room manager and authoritative engine.
 * Clients send intents only; they never send dice values or positions.
 */
function attachSocketHandlers(io, manager) {
    const reject = (socket, ack, code, message) => {
        const payload = { ok: false, code, error: message };
        if (typeof ack === "function") ack(payload);
        socket.emit("action-rejected", payload);
        return payload;
    };

    const reply = (ack, payload) => {
        if (typeof ack === "function") ack(payload);
        return payload;
    };

    const broadcastLobby = (room) => {
        io.to(room.code).emit("lobby-updated", { ok: true, room: lobbyView(room) });
    };

    const stateOf = (room) => (room.game ? room.game.publicState() : null);

    const broadcastState = (room, event, extra) => {
        io.to(room.code).emit(
            event,
            Object.assign({ ok: true }, extra || {}, { state: stateOf(room) })
        );
    };

    const announceGameOver = (room) => {
        if (!room.game || !room.game.isOver) return;
        if (room.winnerAnnounced) return;
        room.winnerAnnounced = true;
        const state = stateOf(room);
        const winner = state.players.find((p) => p.color === state.winner) || null;
        io.to(room.code).emit("player-won", {
            ok: true,
            winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null,
            ranks: state.ranks,
            state
        });
        io.to(room.code).emit("game-over", { ok: true, ranks: state.ranks, state });
        room.status = "finished";
        room.updatedAt = Date.now();
    };

    const memberOf = (socket) => {
        const ref = socket.data && socket.data.member;
        if (!ref) return null;
        const room = manager.getRoom(ref.code);
        if (!room) return null;
        const player = room.players.find((p) => p.id === ref.playerId);
        if (!player) return null;
        return { room, player };
    };

    const scheduleForfeit = (room, player) => {
        if (!room.forfeitTimers) room.forfeitTimers = new Map();
        const existing = room.forfeitTimers.get(player.id);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            room.forfeitTimers.delete(player.id);
            const stillHere = room.players.find((p) => p.id === player.id);
            if (!stillHere || stillHere.connected) return;

            if (room.game && room.status === "playing") {
                const result = room.game.forfeit(player.id);
                if (result.ok) {
                    broadcastState(room, "game-state-updated", { reason: "player-forfeited" });
                    announceGameOver(room);
                }
            }
            manager.removePlayer(room, player.id);
            if (manager.getRoom(room.code)) {
                io.to(room.code).emit("player-disconnected", {
                    ok: true,
                    permanent: true,
                    playerId: player.id,
                    name: player.name,
                    color: player.color,
                    room: lobbyView(room),
                    state: stateOf(room)
                });
                broadcastLobby(room);
            }
        }, FORFEIT_AFTER_MS);

        if (timer.unref) timer.unref();
        room.forfeitTimers.set(player.id, timer);
    };

    const leaveCurrentRoom = (socket) => {
        const member = memberOf(socket);
        if (!member) {
            if (socket.data) socket.data.member = null;
            return;
        }

        const { room, player } = member;
        socket.leave(room.code);

        if (room.game && room.status === "playing") {
            const result = room.game.forfeit(player.id);
            if (result.ok) {
                manager.removePlayer(room, player.id);
                if (manager.getRoom(room.code)) {
                    broadcastState(room, "game-state-updated", {
                        reason: "player-left"
                    });
                    announceGameOver(room);
                    io.to(room.code).emit("player-disconnected", {
                        ok: true,
                        permanent: true,
                        playerId: player.id,
                        name: player.name,
                        color: player.color,
                        room: lobbyView(room),
                        state: stateOf(room)
                    });
                    broadcastLobby(room);
                }
            } else {
                manager.removePlayer(room, player.id);
            }
        } else {
            manager.removePlayer(room, player.id);
            if (manager.getRoom(room.code)) {
                io.to(room.code).emit("player-disconnected", {
                    ok: true,
                    permanent: true,
                    playerId: player.id,
                    name: player.name,
                    color: player.color,
                    room: lobbyView(room),
                    state: stateOf(room)
                });
                broadcastLobby(room);
            }
        }

        if (!manager.getRoom(room.code)) {
            io.to(room.code).emit("room-closed", {
                ok: true,
                code: room.code,
                reason: "empty"
            });
        }

        if (socket.data) socket.data.member = null;
    };

    io.on("connection", (socket) => {
        const allow = createRateLimiter();
        socket.data.member = socket.data.member || null;

        socket.on("create-room", (payload, ack) => {
            if (!allow("create", 5, 10000)) {
                return reject(socket, ack, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
            }
            const name = cleanName(payload && payload.name);
            if (!name) return reject(socket, ack, "BAD_NAME", "Enter a name (1-16 characters).");
            const color = payload && payload.color;
            if (color && !COLORS.includes(color)) {
                return reject(socket, ack, "BAD_COLOR", "Unknown color.");
            }

            leaveCurrentRoom(socket);

            let created;
            try {
                created = manager.createRoom({ socketId: socket.id, name, color });
            } catch (err) {
                if (err instanceof RoomError) return reject(socket, ack, err.code, err.message);
                throw err;
            }

            const { room, player, token } = created;
            socket.join(room.code);
            socket.data.member = { code: room.code, playerId: player.id };

            const out = {
                ok: true,
                code: room.code,
                token,
                you: { id: player.id, name: player.name, color: player.color, isHost: true },
                room: lobbyView(room)
            };
            socket.emit("room-created", out);
            return reply(ack, out);
        });

        socket.on("join-room", (payload, ack) => {
            if (!allow("join", 6, 10000)) {
                return reject(socket, ack, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
            }
            const name = cleanName(payload && payload.name);
            if (!name) return reject(socket, ack, "BAD_NAME", "Enter a name (1-16 characters).");

            const code = cleanCode(payload && payload.code);
            if (!ROOM_CODE_RE.test(code)) {
                return reject(socket, ack, "BAD_CODE", "Enter a valid room code.");
            }

            const color = payload && payload.color;
            if (color && !COLORS.includes(color)) {
                return reject(socket, ack, "BAD_COLOR", "Unknown color.");
            }

            leaveCurrentRoom(socket);

            let joined;
            try {
                joined = manager.joinRoom({ code, socketId: socket.id, name, color });
            } catch (err) {
                if (err instanceof RoomError) return reject(socket, ack, err.code, err.message);
                throw err;
            }

            const { room, player, token } = joined;
            socket.join(room.code);
            socket.data.member = { code: room.code, playerId: player.id };

            const out = {
                ok: true,
                code: room.code,
                token,
                you: { id: player.id, name: player.name, color: player.color, isHost: false },
                room: lobbyView(room)
            };
            socket.emit("room-joined", out);
            socket.to(room.code).emit("room-joined", {
                ok: true,
                player: { id: player.id, name: player.name, color: player.color },
                room: lobbyView(room)
            });
            broadcastLobby(room);
            return reply(ack, out);
        });

        socket.on("reconnect-player", (payload, ack) => {
            if (!allow("reconnect", 10, 10000)) {
                return reject(socket, ack, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
            }

            const code = cleanCode(payload && payload.code);
            const playerId = payload && payload.playerId;
            const token = payload && payload.token;

            let resumed;
            try {
                resumed = manager.reconnect({
                    code,
                    playerId: typeof playerId === "string" ? playerId : "",
                    token: typeof token === "string" ? token : "",
                    socketId: socket.id
                });
            } catch (err) {
                if (err instanceof RoomError) return reject(socket, ack, err.code, err.message);
                throw err;
            }

            const { room, player } = resumed;
            if (room.forfeitTimers && room.forfeitTimers.has(player.id)) {
                clearTimeout(room.forfeitTimers.get(player.id));
                room.forfeitTimers.delete(player.id);
            }

            socket.join(room.code);
            socket.data.member = { code: room.code, playerId: player.id };

            socket.to(room.code).emit("player-reconnected", {
                ok: true,
                player: { id: player.id, name: player.name, color: player.color },
                room: lobbyView(room),
                state: stateOf(room)
            });

            const out = {
                ok: true,
                code: room.code,
                token,
                you: {
                    id: player.id,
                    name: player.name,
                    color: player.color,
                    isHost: room.hostId === player.id
                },
                room: lobbyView(room),
                state: stateOf(room)
            };
            socket.emit("room-joined", out);
            broadcastLobby(room);
            return reply(ack, out);
        });

        socket.on("start-game", (payload, ack) => {
            const member = memberOf(socket);
            if (!member) return reject(socket, ack, "NOT_IN_ROOM", "Join a room first.");
            if (!allow("start", 3, 10000)) {
                return reject(socket, ack, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
            }
            const { room, player } = member;
            if (room.hostId !== player.id) {
                return reject(socket, ack, "NOT_HOST", "Only the host can start the match.");
            }
            if (room.status !== "lobby") {
                return reject(socket, ack, "GAME_IN_PROGRESS", "The match has already started.");
            }
            if (room.players.length < 2) {
                return reject(socket, ack, "NOT_ENOUGH_PLAYERS", "At least 2 players are required.");
            }
            if (room.players.length > MAX_PLAYERS) {
                return reject(socket, ack, "ROOM_FULL", "Too many players.");
            }

            let engine;
            try {
                engine = manager.startGame(room);
            } catch (err) {
                if (err instanceof RoomError) return reject(socket, ack, err.code, err.message);
                throw err;
            }

            engine.onAutoEndTurn((state) => {
                io.to(room.code).emit("game-state-updated", {
                    ok: true,
                    reason: "turn-ended",
                    state
                });
            });

            room.winnerAnnounced = false;
            io.to(room.code).emit("game-started", {
                ok: true,
                room: lobbyView(room),
                state: engine.publicState()
            });
            return reply(ack, { ok: true, state: engine.publicState() });
        });

        socket.on("rematch", (payload, ack) => {
            const member = memberOf(socket);
            if (!member) return reject(socket, ack, "NOT_IN_ROOM", "Join a room first.");
            if (!allow("rematch", 3, 10000)) {
                return reject(socket, ack, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
            }
            const { room, player } = member;
            if (room.hostId !== player.id) {
                return reject(socket, ack, "NOT_HOST", "Only the host can restart the match.");
            }
            if (room.status === "playing" && room.game && !room.game.isOver) {
                return reject(socket, ack, "GAME_IN_PROGRESS", "The match is still running.");
            }

            let engine;
            try {
                engine = manager.rematch(room);
            } catch (err) {
                if (err instanceof RoomError) return reject(socket, ack, err.code, err.message);
                throw err;
            }

            engine.onAutoEndTurn((state) => {
                io.to(room.code).emit("game-state-updated", {
                    ok: true,
                    reason: "turn-ended",
                    state
                });
            });

            io.to(room.code).emit("game-started", {
                ok: true,
                rematch: true,
                room: lobbyView(room),
                state: engine.publicState()
            });
            return reply(ack, { ok: true, state: engine.publicState() });
        });

        socket.on("roll-dice", (payload, ack) => {
            const member = memberOf(socket);
            if (!member) return reject(socket, ack, "NOT_IN_ROOM", "Join a room first.");
            if (!allow("roll", 8, 3000)) {
                return reject(socket, ack, "RATE_LIMITED", "Easy there — too many rolls.");
            }
            const { room, player } = member;
            if (room.status !== "playing" || !room.game) {
                return reject(socket, ack, "GAME_NOT_STARTED", "The match has not started yet.");
            }
            if (room.game.isOver) {
                return reject(socket, ack, "GAME_OVER", "The match is already over.");
            }

            const result = room.game.roll(player.id);
            if (!result.ok) return reject(socket, ack, result.code, result.error);

            room.lastActivity = Date.now();
            broadcastState(room, "dice-rolled", {
                dice: result.dice,
                color: result.color,
                playerId: result.playerId,
                playerName: result.playerName,
                tripleSix: result.tripleSix,
                noMoves: result.noMoves,
                autoEndTurn: result.autoEndTurn,
                extraTurn: result.extraTurn,
                autoMove: result.autoMove || null
            });

            if (result.autoMove && result.autoMove.gameOver) {
                announceGameOver(room);
            }

            return reply(ack, {
                ok: true,
                dice: result.dice,
                autoMove: result.autoMove || null,
                gameOver: !!(result.autoMove && result.autoMove.gameOver),
                state: result.state
            });
        });

        socket.on("move-token", (payload, ack) => {
            const member = memberOf(socket);
            if (!member) return reject(socket, ack, "NOT_IN_ROOM", "Join a room first.");
            if (!allow("move", 12, 3000)) {
                return reject(socket, ack, "RATE_LIMITED", "Easy there — too many moves.");
            }
            const { room, player } = member;
            if (room.status !== "playing" || !room.game) {
                return reject(socket, ack, "GAME_NOT_STARTED", "The match has not started yet.");
            }

            const tokenId = payload && payload.tokenId;
            const result = room.game.move(player.id, tokenId);
            if (!result.ok) return reject(socket, ack, result.code, result.error);

            room.lastActivity = Date.now();
            io.to(room.code).emit("token-moved", {
                ok: true,
                tokenId: result.tokenId,
                color: result.color,
                playerId: result.playerId,
                playerName: result.playerName,
                move: result.move,
                captures: result.captures,
                extraTurn: result.extraTurn,
                gameOver: result.gameOver,
                winner: result.winner,
                state: result.state
            });

            announceGameOver(room);
            return reply(ack, { ok: true, gameOver: result.gameOver, state: result.state });
        });

        socket.on("request-game-state", (payload, ack) => {
            const member = memberOf(socket);
            if (!member) return reject(socket, ack, "NOT_IN_ROOM", "Join a room first.");
            const { room } = member;
            return reply(ack, {
                ok: true,
                room: lobbyView(room),
                state: stateOf(room)
            });
        });

        socket.on("leave-room", (payload, ack) => {
            const member = memberOf(socket);
            if (!member) return reply(ack, { ok: true, left: true });
            leaveCurrentRoom(socket);
            return reply(ack, { ok: true, left: true });
        });

        socket.on("disconnect", () => {
            const member = memberOf(socket);
            if (!member) return;
            const { room, player } = member;
            const marked = manager.markDisconnected(room, player.id, socket.id);
            if (!marked) return;

            io.to(room.code).emit("player-disconnected", {
                ok: true,
                permanent: false,
                playerId: player.id,
                name: player.name,
                color: player.color,
                hostId: room.hostId,
                room: lobbyView(room),
                state: stateOf(room)
            });
            broadcastLobby(room);

            if (room.status === "playing") {
                scheduleForfeit(room, player);
            }
        });
    });
}

module.exports = {
    attachSocketHandlers,
    cleanName,
    cleanCode,
    createRateLimiter
};
