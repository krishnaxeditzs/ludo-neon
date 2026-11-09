"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../shared/ludo-core");

function makeGame() {
    return core.createGame({
        players: [
            { id: "alice", name: "Alice", color: "red" },
            { id: "bob", name: "Bob", color: "green" }
        ]
    });
}

function token(game, id) {
    return game.tokens.find((t) => t.id === id);
}

test("game setup mirrors the existing board and rules", () => {
    const game = makeGame();
    assert.equal(game.players.length, 2);
    assert.equal(game.tokens.length, 8);
    assert.equal(game.tokens.filter((t) => t.color === "red").length, 4);
    assert.equal(game.turnIndex, 0);
    assert.equal(game.state, "awaiting-roll");
    assert.equal(core.SAFE_ZONES.length, 8);
    assert.equal(core.MAIN_TRACK.length, 52);
});

test("a token can only leave the base on a six", () => {
    const game = makeGame();
    const result = core.rollDice(game, { forced: 4 });
    assert.equal(result.ok, true);
    assert.equal(result.noMoves, true);
    assert.deepEqual(result.legalTokenIds, []);
    assert.equal(game.state, "awaiting-roll");
});

test("rolling a six opens the base and keeps the turn", () => {
    const game = makeGame();
    const rolled = core.rollDice(game, { forced: 6 });
    assert.equal(rolled.dice, 6);
    assert.equal(rolled.legalTokenIds.length, 4);
    assert.equal(game.state, "awaiting-move");

    const moved = core.moveToken(game, "red-0");
    assert.equal(moved.ok, true);
    assert.equal(token(game, "red-0").state, "track");
    assert.equal(token(game, "red-0").relPos, 0);
    // Extra roll from the six: same player, awaiting-roll.
    assert.equal(game.turnIndex, 0);
    assert.equal(game.state, "awaiting-roll");
});

test("a one also grants an extra roll (existing custom rule)", () => {
    const game = makeGame();
    core.rollDice(game, { forced: 6 });
    core.moveToken(game, "red-0");

    const rolled = core.rollDice(game, { forced: 1 });
    assert.equal(rolled.extraTurn, true);
    assert.equal(game.state, "awaiting-move");

    core.moveToken(game, "red-0");
    assert.equal(game.turnIndex, 0, "rolling a 1 keeps the turn");
});

test("no legal move passes the turn, but a six re-rolls", () => {
    const game = makeGame();
    core.rollDice(game, { forced: 4 });
    assert.equal(game.state, "awaiting-roll");
    core.endTurnAfterRoll(game);
    assert.equal(game.turnIndex, 1);

    core.rollDice(game, { forced: 6 });
    core.moveToken(game, "green-0");
    // pretend the only token is blocked far ahead
    token(game, "green-0").relPos = 54;
    token(game, "green-0").state = "home";
    const rolled = core.rollDice(game, { forced: 3 });
    assert.equal(rolled.noMoves, true);
    const turnBefore = game.turnIndex;
    core.endTurnAfterRoll(game);
    assert.notEqual(game.turnIndex, turnBefore, "a non-extra roll with no move passes the turn");
});

test("capture sends opponents back to base and grants an extra roll", () => {
    const game = makeGame();
    token(game, "red-0").state = "track";
    token(game, "red-0").relPos = 4;
    token(game, "green-0").state = "track";
    token(game, "green-0").relPos = 44; // shares the cell red lands on after +1

    assert.deepEqual(
        core.coordsFor("red", "track", 5),
        core.coordsFor("green", "track", 44),
        "test fixture must share a cell"
    );
    assert.equal(core.isSafePosition(5, "red"), false);

    game.dice = 1;
    game.state = "awaiting-move";
    game.extraTurn = false;

    const result = core.moveToken(game, "red-0");
    assert.equal(result.ok, true);
    assert.equal(result.captures.length, 1);
    assert.equal(token(game, "green-0").state, "base");
    assert.equal(token(game, "green-0").relPos, -1);
    assert.equal(game.turnIndex, 0, "capture grants another roll");
});

test("safe zones prevent captures", () => {
    const game = makeGame();
    token(game, "red-0").state = "track";
    token(game, "red-0").relPos = 12;
    token(game, "green-0").state = "track";
    token(game, "green-0").relPos = 0; // green start cell = safe [1,8]

    assert.equal(core.isSafePosition(13, "red"), true);
    game.dice = 1;
    game.state = "awaiting-move";

    const result = core.moveToken(game, "red-0");
    assert.equal(result.ok, true);
    assert.equal(result.captures.length, 0);
    assert.equal(token(game, "green-0").state, "track");
});

test("a token needs an exact roll to reach home", () => {
    const game = makeGame();
    token(game, "red-0").state = "home";
    token(game, "red-0").relPos = 54;

    game.dice = 3;
    game.state = "awaiting-move";
    const overshoot = core.moveToken(game, "red-0");
    assert.equal(overshoot.ok, false);
    assert.equal(overshoot.code, "ILLEGAL_MOVE");

    game.dice = 2;
    game.state = "awaiting-move";
    const exact = core.moveToken(game, "red-0");
    assert.equal(exact.ok, true);
    assert.equal(token(game, "red-0").relPos, 56);
});

test("finishing all four tokens wins and finalises the ranks", () => {
    const game = makeGame();
    ["red-0", "red-1", "red-2"].forEach((id) => {
        token(game, id).state = "home";
        token(game, id).relPos = 56;
    });
    token(game, "red-3").state = "home";
    token(game, "red-3").relPos = 54;

    game.dice = 2;
    game.state = "awaiting-move";
    const result = core.moveToken(game, "red-3");

    assert.equal(result.ok, true);
    assert.equal(result.move.playerFinished, true);
    assert.equal(result.gameOver, true);
    assert.deepEqual(game.ranks, ["red", "green"]);
    assert.equal(game.winner, "red");
    assert.equal(game.state, "finished");
});

test("three consecutive sixes forfeit the turn", () => {
    const game = makeGame();
    core.rollDice(game, { forced: 6 });
    core.moveToken(game, "red-0");
    core.rollDice(game, { forced: 6 });
    core.moveToken(game, "red-0");

    const third = core.rollDice(game, { forced: 6 });
    assert.equal(third.tripleSix, true);
    assert.equal(third.autoEndTurn, true);
    core.endTurnAfterRoll(game);
    assert.equal(game.turnIndex, 1);
    assert.equal(game.state, "awaiting-roll");
    assert.equal(game.dice, 0);
});

test("actions are validated against ownership and phase", () => {
    const game = makeGame();
    game.dice = 6;
    game.state = "awaiting-move";

    const wrongOwner = core.moveToken(game, "green-0");
    assert.equal(wrongOwner.ok, false);
    assert.equal(wrongOwner.code, "NOT_YOUR_TOKEN");

    const unknown = core.moveToken(game, "red-9");
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, "UNKNOWN_TOKEN");

    game.state = "awaiting-roll";
    const earlyMove = core.moveToken(game, "red-0");
    assert.equal(earlyMove.ok, false);
    assert.equal(earlyMove.code, "WRONG_PHASE");

    const doubleRoll = core.rollDice(game, { forced: 6 });
    assert.equal(doubleRoll.ok, true);
    const secondMoveRoll = core.rollDice(game);
    assert.equal(secondMoveRoll.ok, false);
    assert.equal(secondMoveRoll.code, "WRONG_PHASE");
});

test("a forfeiting player is removed and the match resolves", () => {
    const game = makeGame();
    const result = core.removePlayer(game, "bob");
    assert.equal(result.ok, true);
    assert.equal(result.gameOver, true);
    assert.equal(game.players.length, 1);
    assert.equal(game.tokens.filter((t) => t.color === "green").length, 0);
    assert.equal(game.state, "finished");
});
