"use strict";

const core = require("../shared/ludo-core");

const AUTO_END_DELAY_MS = 1100;

/**
 * Thin server-side wrapper around the shared rule engine.
 * The engine owns the authoritative state; clients only ever receive
 * snapshots produced by `publicState()`.
 */
class GameEngine {
    constructor(players, options = {}) {
        this.game = core.createGame({ players });
        this.autoEndTimer = null;
        this.onAutoEnd = null;
        // Test-only injection; never set from network input or env.
        this.forcedDice = Number.isInteger(options.forcedDice) ? options.forcedDice : null;
    }

    onAutoEndTurn(fn) {
        this.onAutoEnd = typeof fn === "function" ? fn : null;
    }

    publicState() {
        return core.publicGameState(this.game);
    }

    currentPlayer() {
        return this.game.players[this.game.turnIndex] || null;
    }

    playerById(id) {
        return this.game.players.find((p) => p.id === id) || null;
    }

    get isOver() {
        return this.game.state === "finished";
    }

    clearTimer() {
        if (this.autoEndTimer) {
            clearTimeout(this.autoEndTimer);
            this.autoEndTimer = null;
        }
    }

    scheduleAutoEnd() {
        this.clearTimer();
        this.game.state = "resolving";
        this.autoEndTimer = setTimeout(() => {
            this.autoEndTimer = null;
            if (this.game.state !== "resolving") return;
            core.endTurnAfterRoll(this.game);
            if (this.onAutoEnd) this.onAutoEnd(this.publicState());
        }, AUTO_END_DELAY_MS);
    }

    roll(playerId) {
        if (!playerId) {
            return { ok: false, code: "NOT_IN_GAME", error: "Unknown player." };
        }

        const player = this.playerById(playerId);
        if (!player) {
            return { ok: false, code: "NOT_IN_GAME", error: "You are not part of this match." };
        }
        const current = this.currentPlayer();
        if (!current || current.id !== playerId) {
            return {
                ok: false,
                code: "NOT_YOUR_TURN",
                error: `It is ${current ? current.name : "another player"}'s turn.`
            };
        }

        const result = this.forcedDice
            ? core.rollDice(this.game, { forced: this.forcedDice })
            : core.rollDice(this.game);
        if (!result.ok) return result;

        if (result.autoEndTurn) this.scheduleAutoEnd();

        return Object.assign({}, result, { state: this.publicState() });
    }

    move(playerId, tokenId) {
        const player = this.playerById(playerId);
        if (!player) {
            return { ok: false, code: "NOT_IN_GAME", error: "You are not part of this match." };
        }
        const current = this.currentPlayer();
        if (!current || current.id !== playerId) {
            return {
                ok: false,
                code: "NOT_YOUR_TURN",
                error: `It is ${current ? current.name : "another player"}'s turn.`
            };
        }
        if (typeof tokenId !== "string" || tokenId.length > 32) {
            return { ok: false, code: "BAD_INPUT", error: "Invalid token." };
        }

        const result = core.moveToken(this.game, tokenId);
        if (!result.ok) return result;

        this.clearTimer();
        return Object.assign({}, result, { state: this.publicState() });
    }

    forfeit(playerId) {
        this.clearTimer();
        const result = core.removePlayer(this.game, playerId);
        if (!result.ok) return result;
        return Object.assign({}, result, { state: this.publicState() });
    }
}

module.exports = { GameEngine, AUTO_END_DELAY_MS };
