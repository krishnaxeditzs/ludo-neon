"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameEngine } = require("../server/game-engine");

function makeEngine(forcedDice, options) {
    return new GameEngine(
        [
            { id: "alice", name: "Alice", color: "red" },
            { id: "bob", name: "Bob", color: "green" }
        ],
        Object.assign({ forcedDice: forcedDice, autoSingleMove: true }, options || {})
    );
}

function token(engine, id) {
    return engine.game.tokens.find((t) => t.id === id);
}

test("a roll with exactly one legal move is executed by the server", () => {
    const engine = makeEngine(3);
    const red = token(engine, "red-0");
    red.state = "track";
    red.relPos = 10;

    const result = engine.roll("alice");

    assert.equal(result.ok, true);
    assert.equal(result.dice, 3);
    assert.equal(result.autoMove.tokenId, "red-0");
    assert.equal(red.state, "track");
    assert.equal(red.relPos, 13);
    assert.equal(result.state.revision, 2);
    assert.equal(result.state.turnIndex, 1);
    assert.equal(result.state.state, "awaiting-roll");

    // Replaying the auto move or the roll cannot mutate the game twice.
    assert.equal(engine.move("alice", "red-0").ok, false);
    assert.equal(engine.roll("alice").ok, false);
});

test("base tokens are included when counting legal moves", () => {
    const engine = makeEngine(6);
    ["red-0", "red-1", "red-2"].forEach((id) => {
        token(engine, id).state = "home";
        token(engine, id).relPos = 56;
    });

    const result = engine.roll("alice");

    assert.equal(result.legalTokenIds.length, 1);
    assert.equal(result.autoMove.tokenId, "red-3");
    assert.equal(token(engine, "red-3").state, "track");
    assert.equal(token(engine, "red-3").relPos, 0);
    assert.equal(result.state.turnIndex, 0, "a six keeps the turn");
});

test("a six with multiple legal moves is not auto-executed", () => {
    const engine = makeEngine(6);
    const red = token(engine, "red-0");
    red.state = "track";
    red.relPos = 10;

    const result = engine.roll("alice");

    assert.equal(result.autoMove, null);
    assert.equal(result.legalTokenIds.length, 4);
    assert.equal(result.state.state, "awaiting-move");
    assert.equal(result.state.revision, 1);
    assert.equal(red.relPos, 10);
});

test("zero legal moves still uses the turn-ending path", () => {
    const engine = makeEngine(3);
    const red = token(engine, "red-0");
    red.state = "track";
    red.relPos = 54;

    const result = engine.roll("alice");

    assert.equal(result.ok, true);
    assert.equal(result.autoMove, null);
    assert.equal(result.autoEndTurn, true);
    assert.equal(result.state.state, "resolving");
    assert.deepEqual(result.state.legalTokenIds, []);
    engine.clearTimer();
});

test("an automatic winning move finalises the match", () => {
    const engine = makeEngine(2);
    ["red-0", "red-1", "red-2"].forEach((id) => {
        token(engine, id).state = "home";
        token(engine, id).relPos = 56;
    });
    token(engine, "red-3").state = "home";
    token(engine, "red-3").relPos = 54;

    const result = engine.roll("alice");

    assert.equal(result.autoMove.gameOver, true);
    assert.equal(result.autoMove.move.reachedHome, true);
    assert.equal(result.state.state, "finished");
    assert.equal(result.state.winner, "red");
    assert.deepEqual(result.state.ranks, ["red", "green"]);
});

test("an automatic move still applies captures and the extra turn", () => {
    const engine = makeEngine(1);
    const red = token(engine, "red-0");
    red.state = "track";
    red.relPos = 4;
    const green = token(engine, "green-0");
    green.state = "track";
    green.relPos = 44; // shares red's destination after +1

    const result = engine.roll("alice");

    assert.equal(result.autoMove.move.captures.length, 1);
    assert.equal(green.state, "base");
    assert.equal(green.relPos, -1);
    assert.equal(result.state.turnIndex, 0);
    assert.equal(result.state.state, "awaiting-roll");
});
