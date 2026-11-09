"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { io: Client } = require("socket.io-client");
const { createServer } = require("../server/server");
const { before, after } = require("node:test");

let httpServer;
let ioServer;
let manager;
let port;
const clients = [];

function connect() {
    return new Promise((resolve, reject) => {
        const socket = Client(`http://127.0.0.1:${port}`, {
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            timeout: 4000
        });
        clients.push(socket);
        socket.once("connect", () => resolve(socket));
        socket.once("connect_error", reject);
    });
}

function request(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), 5000);
        socket.emit(event, payload, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function waitFor(socket, event, predicate) {
    return new Promise((resolve, reject) => {
        const handler = (payload) => {
            if (predicate && !predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timeout waiting for ${event}`));
        }, 5000);
        socket.on(event, handler);
    });
}

before(async () => {
    const created = createServer({
        corsOrigin: "*",
        roomManager: {
            cleanupIntervalMs: 1000,
            emptyRoomTtlMs: 5000,
            // Test-only: deterministic sixes so a legal move always exists.
            gameOptions: { forcedDice: 6 }
        }
    });
    httpServer = created.httpServer;
    ioServer = created.io;
    manager = created.manager;
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    port = httpServer.address().port;
});

after(async () => {
    clients.forEach((socket) => socket.close());
    await new Promise((resolve) => ioServer.close(resolve));
    manager.shutdown();
});

test("create room, join room and reject invalid joins", async () => {
    const alice = await connect();
    const bob = await connect();
    const carol = await connect();

    const created = await request(alice, "create-room", { name: "Alice" });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z0-9]{5}$/);
    assert.equal(created.you.isHost, true);
    assert.equal(created.room.players.length, 1);

    const joined = await request(bob, "join-room", { code: created.code, name: "Bob" });
    assert.equal(joined.ok, true);
    assert.equal(joined.room.players.length, 2);
    assert.equal(joined.you.isHost, false);
    assert.notEqual(joined.you.color, created.you.color);

    const missing = await request(carol, "join-room", { code: "ZZZZZ", name: "Carol" });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "ROOM_NOT_FOUND");

    const duplicate = await request(carol, "join-room", { code: created.code, name: "bob" });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, "NAME_TAKEN");

    const badCode = await request(carol, "join-room", { code: "no!", name: "Carol" });
    assert.equal(badCode.ok, false);
    assert.equal(badCode.code, "BAD_CODE");

    await request(alice, "leave-room", {});
    await request(bob, "leave-room", {});
    alice.close();
    bob.close();
    carol.close();
});

test("only the host starts and the server keeps both clients in sync", async () => {
    const alice = await connect();
    const bob = await connect();

    const created = await request(alice, "create-room", { name: "Alice" });
    await request(bob, "join-room", { code: created.code, name: "Bob" });

    const notHost = await request(bob, "start-game", {});
    assert.equal(notHost.ok, false);
    assert.equal(notHost.code, "NOT_HOST");

    const aliceStart = waitFor(alice, "game-started");
    const bobStart = waitFor(bob, "game-started");
    const started = await request(alice, "start-game", {});
    assert.equal(started.ok, true);

    const [aliceEvent, bobEvent] = await Promise.all([aliceStart, bobStart]);
    assert.deepEqual(aliceEvent.state.tokens, bobEvent.state.tokens);
    assert.equal(aliceEvent.state.players.length, 2);
    assert.equal(aliceEvent.state.turnPlayerId, created.you.id);

    const bobRoll = await request(bob, "roll-dice", {});
    assert.equal(bobRoll.ok, false);
    assert.equal(bobRoll.code, "NOT_YOUR_TURN");

    const axiom = waitFor(bob, "dice-rolled");
    const rolled = await request(alice, "roll-dice", {});
    assert.equal(rolled.ok, true);
    const diceEvent = await axiom;
    assert.equal(diceEvent.dice, rolled.dice);
    assert.equal(diceEvent.state.dice, rolled.dice);

    // Invalid action: try to move a token the current player does not own.
    const invalid = await request(alice, "move-token", { tokenId: "green-0" });
    assert.equal(invalid.ok, false);
    assert.ok(["NOT_YOUR_TOKEN", "ILLEGAL_MOVE", "WRONG_PHASE"].includes(invalid.code));

    // A legal move must reach both clients identically (dice are forced to 6 in tests).
    const current = (await request(alice, "request-game-state", {})).state;
    assert.equal(current.state, "awaiting-move");
    assert.ok(current.legalTokenIds.length > 0);
    const tokenId = current.legalTokenIds[0];
    const bobMove = waitFor(bob, "token-moved");
    const moved = await request(alice, "move-token", { tokenId });
    assert.equal(moved.ok, true);
    const moveEvent = await bobMove;
    assert.equal(moveEvent.tokenId, tokenId);
    assert.equal(moveEvent.move.from.state, "base");
    assert.equal(moveEvent.move.to.relPos, 0);
    const bobState = (await request(bob, "request-game-state", {})).state;
    assert.equal(bobState.revision, moveEvent.state.revision);
    assert.deepEqual(bobState.tokens, moveEvent.state.tokens);

    // Replaying the same move is rejected (turn already advanced / phase changed).
    const replay = await request(alice, "move-token", { tokenId });
    assert.equal(replay.ok, false);

    await request(alice, "leave-room", {});
    alice.close();
    bob.close();
});

test("disconnect, host migration and reconnection restore the seat", async () => {
    const alice = await connect();
    const bob = await connect();

    const created = await request(alice, "create-room", { name: "Alice" });
    const joined = await request(bob, "join-room", { code: created.code, name: "Bob" });

    const migrated = waitFor(bob, "lobby-updated", (payload) => payload.room.hostId === joined.you.id);
    alice.close();
    const lobby = await migrated;
    assert.equal(lobby.room.hostId, joined.you.id, "host moves to the connected player");

    const reconnected = await connect();
    const resumed = await request(reconnected, "reconnect-player", {
        code: created.code,
        playerId: created.you.id,
        token: created.token
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.you.id, created.you.id);
    assert.equal(resumed.you.name, "Alice");
    assert.equal(resumed.you.isHost, false);

    const thief = await connect();
    const hijack = await request(thief, "reconnect-player", {
        code: created.code,
        playerId: created.you.id,
        token: "0".repeat(48)
    });
    assert.equal(hijack.ok, false);
    assert.equal(hijack.code, "INVALID_SESSION");

    thief.close();
    reconnected.close();
    bob.close();
});

test("a full room rejects a fifth player", async () => {
    const sockets = [];
    for (let i = 0; i < 5; i++) sockets.push(await connect());

    const created = await request(sockets[0], "create-room", { name: "P1" });
    for (let i = 1; i <= 3; i++) {
        const joined = await request(sockets[i], "join-room", {
            code: created.code,
            name: `P${i + 1}`
        });
        assert.equal(joined.ok, true);
    }
    const full = await request(sockets[4], "join-room", { code: created.code, name: "P5" });
    assert.equal(full.ok, false);
    assert.equal(full.code, "ROOM_FULL");

    await request(sockets[0], "leave-room", {});
    sockets.forEach((socket) => socket.close());
});

test("leaving mid-match forfeits and ends the match for the opponent", async () => {
    const alice = await connect();
    const bob = await connect();

    const created = await request(alice, "create-room", { name: "Alice" });
    await request(bob, "join-room", { code: created.code, name: "Bob" });
    await request(alice, "start-game", {});

    const gameOver = waitFor(bob, "game-over");
    await request(alice, "leave-room", {});
    const over = await gameOver;

    assert.ok(over.ranks.includes("green"), "remaining player is ranked");
    assert.equal(over.state.winner, "green");

    alice.close();
    bob.close();
});


test("host can restart a finished match, guests cannot", async () => {
    const alice = await connect();
    const bob = await connect();

    const created = await request(alice, "create-room", { name: "Host" });
    await request(bob, "join-room", { code: created.code, name: "Guest" });
    await request(alice, "start-game", {});

    const room = manager.getRoom(created.code);
    room.game.game.state = "finished";
    room.game.game.ranks = [created.you.color];
    room.game.game.winner = created.you.color;
    room.status = "finished";

    const guestAttempt = await request(bob, "rematch", {});
    assert.equal(guestAttempt.ok, false);
    assert.equal(guestAttempt.code, "NOT_HOST");

    const guestStart = waitFor(bob, "game-started", (payload) => payload.rematch === true);
    const restarted = await request(alice, "rematch", {});
    assert.equal(restarted.ok, true);

    const event = await guestStart;
    assert.equal(event.state.revision, 0);
    assert.equal(event.state.ranks.length, 0);
    assert.equal(event.state.tokens.filter((t) => t.state === "track").length, 0);
    assert.equal(event.state.players.length, 2);

    await request(alice, "leave-room", {});
    alice.close();
    bob.close();
});

test("burst actions are rate limited", async () => {
    const alice = await connect();
    const bob = await connect();

    const created = await request(alice, "create-room", { name: "Racer" });
    await request(bob, "join-room", { code: created.code, name: "Racer2" });
    await request(alice, "start-game", {});

    const responses = [];
    for (let i = 0; i < 12; i++) {
        responses.push(await request(alice, "roll-dice", {}));
    }
    assert.ok(
        responses.some((response) => response.code === "RATE_LIMITED"),
        "expected at least one RATE_LIMITED rejection"
    );

    await request(alice, "leave-room", {});
    alice.close();
    bob.close();
});
