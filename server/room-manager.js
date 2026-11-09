"use strict";

const crypto = require("crypto");
const { GameEngine } = require("./game-engine");
const { COLORS } = require("../shared/ludo-core");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

class RoomError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function sha256(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function randomToken() {
    return crypto.randomBytes(24).toString("hex");
}

function lobbyView(room) {
    return {
        code: room.code,
        hostId: room.hostId,
        status: room.status,
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        createdAt: room.createdAt,
        players: room.players.map((p) => {
            const gamePlayer = room.game
                ? room.game.game.players.find((gp) => gp.id === p.id)
                : null;
            return {
                id: p.id,
                name: p.name,
                color: p.color,
                connected: p.connected,
                isHost: p.id === room.hostId,
                finished: gamePlayer ? gamePlayer.finished : false
            };
        })
    };
}

/**
 * In-memory room store.
 *
 * Everything lives inside a Map, so a server restart drops all rooms and
 * live matches. The API is deliberately storage-agnostic: swapping this
 * class for a Redis/Postgres backed implementation only requires
 * implementing the same methods.
 */
class RoomManager {
    constructor(options = {}) {
        this.rooms = new Map();
        this.gameOptions = options.gameOptions || {};
        this.maxRooms = options.maxRooms || Number(process.env.MAX_ROOMS) || 500;
        this.reconnectTtlMs =
            options.reconnectTtlMs || Number(process.env.RECONNECT_TTL_MS) || 10 * 60 * 1000;
        this.emptyRoomTtlMs =
            options.emptyRoomTtlMs || Number(process.env.EMPTY_ROOM_TTL_MS) || 5 * 60 * 1000;
        this.idleRoomTtlMs =
            options.idleRoomTtlMs || Number(process.env.IDLE_ROOM_TTL_MS) || 2 * 60 * 60 * 1000;
        this.cleanupIntervalMs = options.cleanupIntervalMs || 60 * 1000;

        this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    generateCode() {
        let code = "";
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        }
        return code;
    }

    getRoom(code) {
        if (typeof code !== "string") return null;
        return this.rooms.get(code.trim().toUpperCase()) || null;
    }

    playersInRoom(room) {
        return room.players.length;
    }

    pickColor(room, requested) {
        if (requested && COLORS.includes(requested)) {
            const taken = room.players.some((p) => p.color === requested);
            if (taken) throw new RoomError("COLOR_TAKEN", "That color is already taken.");
            return requested;
        }
        const free = COLORS.find((c) => !room.players.some((p) => p.color === c));
        if (!free) throw new RoomError("ROOM_FULL", "That room is already full.");
        return free;
    }

    createRoom({ socketId, name, color }) {
        if (this.rooms.size >= this.maxRooms) {
            throw new RoomError("ROOM_LIMIT", "The server is at capacity. Please try again later.");
        }

        let code = this.generateCode();
        let guard = 0;
        while (this.rooms.has(code) && guard++ < 100) code = this.generateCode();

        const token = randomToken();
        const now = Date.now();
        const player = {
            id: crypto.randomUUID(),
            name,
            color: COLORS.includes(color) ? color : "red",
            socketId,
            connected: true,
            tokenHash: sha256(token),
            joinedAt: now,
            disconnectedAt: null
        };

        const room = {
            code,
            hostId: player.id,
            players: [player],
            status: "lobby",
            game: null,
            createdAt: now,
            updatedAt: now,
            lastActivity: now,
            winnerAnnounced: false,
            forfeitTimers: new Map()
        };

        this.rooms.set(code, room);
        return { room, player, token };
    }

    joinRoom({ code, socketId, name, color }) {
        const room = this.getRoom(code);
        if (!room) throw new RoomError("ROOM_NOT_FOUND", "That room code does not exist.");
        if (room.status !== "lobby") {
            throw new RoomError("ROOM_IN_PROGRESS", "That match has already started.");
        }
        if (room.players.length >= MAX_PLAYERS) {
            throw new RoomError("ROOM_FULL", "That room is already full (4 players).");
        }

        const normalized = name.toLowerCase();
        if (room.players.some((p) => p.connected && p.name.toLowerCase() === normalized)) {
            throw new RoomError("NAME_TAKEN", "That name is already used in this room.");
        }

        const assignedColor = this.pickColor(room, color);
        const token = randomToken();
        const now = Date.now();
        const player = {
            id: crypto.randomUUID(),
            name,
            color: assignedColor,
            socketId,
            connected: true,
            tokenHash: sha256(token),
            joinedAt: now,
            disconnectedAt: null
        };

        room.players.push(player);
        room.updatedAt = now;
        room.lastActivity = now;

        return { room, player, token };
    }

    reconnect({ code, playerId, token, socketId }) {
        const room = this.getRoom(code);
        if (!room) {
            throw new RoomError("ROOM_CLOSED", "That room no longer exists. It may have expired.");
        }
        if (typeof playerId !== "string" || typeof token !== "string" || !token) {
            throw new RoomError("INVALID_SESSION", "Missing reconnection credentials.");
        }

        const player = room.players.find((p) => p.id === playerId);
        if (!player) {
            throw new RoomError("UNKNOWN_PLAYER", "Your seat in this room is no longer available.");
        }
        if (player.tokenHash !== sha256(token)) {
            throw new RoomError("INVALID_SESSION", "Invalid reconnection token.");
        }
        if (
            !player.connected &&
            player.disconnectedAt &&
            Date.now() - player.disconnectedAt > this.reconnectTtlMs
        ) {
            this.removePlayer(room, player.id);
            throw new RoomError("SESSION_EXPIRED", "Your reconnection window expired.");
        }

        player.socketId = socketId;
        player.connected = true;
        player.disconnectedAt = null;
        room.updatedAt = Date.now();
        room.lastActivity = Date.now();

        return { room, player };
    }

    markDisconnected(room, playerId, socketId) {
        const player = room.players.find((p) => p.id === playerId);
        if (!player) return null;
        if (socketId && player.socketId && player.socketId !== socketId) return null;
        player.connected = false;
        player.disconnectedAt = Date.now();
        room.updatedAt = Date.now();
        this.ensureHost(room);
        return player;
    }

    ensureHost(room) {
        if (!room.players.length) return;
        const host = room.players.find((p) => p.id === room.hostId);
        if (host && host.connected) return;
        const nextHost = room.players.find((p) => p.connected) || room.players[0];
        room.hostId = nextHost.id;
    }

    startGame(room) {
        const connected = room.players.filter((p) => p.connected);
        if (connected.length < MIN_PLAYERS) {
            throw new RoomError("NOT_ENOUGH_PLAYERS", "At least 2 connected players are required.");
        }
        if (connected.length !== room.players.length) {
            const waiting = room.players.filter((p) => !p.connected).map((p) => p.name);
            throw new RoomError(
                "PLAYER_DISCONNECTED",
                `Waiting for ${waiting.join(", ")} to reconnect.`
            );
        }

        room.game = new GameEngine(
            room.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
            this.gameOptions
        );
        room.status = "playing";
        room.winnerAnnounced = false;
        room.updatedAt = Date.now();
        room.lastActivity = Date.now();
        return room.game;
    }

    rematch(room) {
        const connected = room.players.filter((p) => p.connected);
        if (connected.length < MIN_PLAYERS) {
            throw new RoomError("NOT_ENOUGH_PLAYERS", "At least 2 connected players are required.");
        }

        const previous = new Map(room.players.map((p) => [p.id, p]));
        room.game = new GameEngine(
            connected.map((p) => ({ id: p.id, name: p.name, color: p.color })),
            this.gameOptions
        );
        // Preserve display order / colors of the remaining seats.
        void previous;
        room.status = "playing";
        room.winnerAnnounced = false;
        room.updatedAt = Date.now();
        room.lastActivity = Date.now();
        return room.game;
    }

    removePlayer(room, playerId) {
        const index = room.players.findIndex((p) => p.id === playerId);
        if (index === -1) return false;
        const timer = room.forfeitTimers && room.forfeitTimers.get(playerId);
        if (timer) {
            clearTimeout(timer);
            room.forfeitTimers.delete(playerId);
        }
        room.players.splice(index, 1);
        room.updatedAt = Date.now();
        room.lastActivity = Date.now();

        if (!room.players.length) {
            this.destroyRoom(room.code);
            return true;
        }
        this.ensureHost(room);
        return true;
    }

    destroyRoom(code) {
        const room = this.rooms.get(code);
        if (!room) return false;
        if (room.game) room.game.clearTimer();
        if (room.forfeitTimers) {
            room.forfeitTimers.forEach((timer) => clearTimeout(timer));
            room.forfeitTimers.clear();
        }
        this.rooms.delete(code);
        return true;
    }

    cleanup() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            const allGone = room.players.length === 0 || room.players.every((p) => !p.connected);

            if (allGone && now - room.lastActivity > this.emptyRoomTtlMs) {
                this.destroyRoom(code);
                continue;
            }
            if (now - room.lastActivity > this.idleRoomTtlMs) {
                this.destroyRoom(code);
                continue;
            }

            if (room.status === "lobby") {
                const before = room.players.length;
                room.players = room.players.filter(
                    (p) =>
                        p.connected ||
                        !p.disconnectedAt ||
                        now - p.disconnectedAt <= this.reconnectTtlMs
                );
                if (room.players.length !== before) {
                    if (!room.players.length) {
                        this.destroyRoom(code);
                        continue;
                    }
                    this.ensureHost(room);
                }
            }
        }
    }

    stats() {
        let connected = 0;
        let playing = 0;
        for (const room of this.rooms.values()) {
            connected += room.players.filter((p) => p.connected).length;
            if (room.status === "playing") playing += 1;
        }
        return { rooms: this.rooms.size, players: connected, playing };
    }

    shutdown() {
        clearInterval(this.cleanupTimer);
        for (const code of Array.from(this.rooms.keys())) {
            this.destroyRoom(code);
        }
    }
}

module.exports = {
    RoomManager,
    RoomError,
    lobbyView,
    MIN_PLAYERS,
    MAX_PLAYERS
};
