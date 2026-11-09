/*
 * Ludo Neon — shared rules engine.
 *
 * This module is a faithful extraction of the rule set implemented in
 * script.js (board geometry, start offsets, safe zones, base escape,
 * exact-home finish, captures, extra rolls, three-sixes penalty and
 * ranking). It is loaded by the Node backend as CommonJS and can be
 * loaded in the browser as `window.LudoCore` if ever needed.
 *
 * The single-player / local client keeps using its original inline
 * implementation, so no existing gameplay behaviour is changed.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.LudoCore = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var COLORS = ["red", "green", "blue", "yellow"];

    var HEX = {
        red: "#ff2a5f",
        green: "#0df0a3",
        blue: "#0ea5e9",
        yellow: "#facc15"
    };

    var START_OFFSETS = { red: 0, green: 13, blue: 26, yellow: 39 };

    var MAIN_TRACK = [
        [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
        [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
        [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
        [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0]
    ];

    var HOME_TRACKS = {
        red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
        green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
        blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
        yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
    };

    var BASE_COORDS = {
        red: [[2, 2], [2, 3], [3, 2], [3, 3]],
        green: [[2, 11], [2, 12], [3, 11], [3, 12]],
        blue: [[11, 11], [11, 12], [12, 11], [12, 12]],
        yellow: [[11, 2], [11, 3], [12, 2], [12, 3]]
    };

    var SAFE_ZONES = [
        "6,1", "2,6", "1,8", "6,12", "8,13", "12,8", "13,6", "8,2"
    ];

    var TRACK_END = 50;   // last shared-track position (0..50)
    var HOME_END = 56;    // finished position
    var TOKENS_PER_PLAYER = 4;

    function fail(code, message) {
        return { ok: false, code: code, error: message, message: message };
    }

    function normalizePlayers(players) {
        return (players || []).map(function (p, index) {
            return {
                id: String(p.id || p.color),
                name: String(p.name || p.color).slice(0, 16),
                color: String(p.color),
                seat: index,
                finished: false,
                connected: p.connected !== false
            };
        });
    }

    function createGame(options) {
        options = options || {};
        var players = normalizePlayers(options.players);

        if (players.length < 2) {
            throw new Error("A game needs at least 2 players.");
        }
        if (players.length > 4) {
            throw new Error("A game supports at most 4 players.");
        }

        var seen = {};
        players.forEach(function (p) {
            if (COLORS.indexOf(p.color) === -1) {
                throw new Error("Unknown color: " + p.color);
            }
            if (seen[p.color]) {
                throw new Error("Duplicate color: " + p.color);
            }
            seen[p.color] = true;
        });

        var tokens = [];
        players.forEach(function (p, playerIndex) {
            for (var i = 0; i < TOKENS_PER_PLAYER; i++) {
                tokens.push({
                    id: p.color + "-" + i,
                    color: p.color,
                    playerIndex: playerIndex,
                    state: "base",
                    relPos: -1
                });
            }
        });

        return {
            players: players,
            tokens: tokens,
            turnIndex: 0,
            dice: 0,
            consecutiveSixes: 0,
            extraTurn: false,
            state: "awaiting-roll",
            ranks: [],
            winner: null,
            revision: 0
        };
    }

    function touch(game) {
        game.revision += 1;
        return game.revision;
    }

    /* ---------- board helpers (used for capture / safety checks) ---------- */

    function trackCell(relPos, color) {
        var absIdx = (START_OFFSETS[color] + relPos) % 52;
        return MAIN_TRACK[absIdx];
    }

    function coordsFor(color, state, relPos) {
        if (state === "base") {
            return null;
        }
        if (state === "home") {
            return HOME_TRACKS[color][relPos - (TRACK_END + 1)] || null;
        }
        if (relPos < 0 || relPos > TRACK_END) {
            return null;
        }
        return trackCell(relPos, color);
    }

    function isSafePosition(relPos, color) {
        if (relPos < 0 || relPos > TRACK_END) return false;
        var cell = trackCell(relPos, color);
        return SAFE_ZONES.indexOf(cell.join(",")) !== -1;
    }

    function sameCell(a, b) {
        return a && b && a[0] === b[0] && a[1] === b[1];
    }

    /* ------------------------------ rules ------------------------------ */

    function getValidTokenIds(game, playerIndex, dice) {
        if (typeof dice !== "number") dice = game.dice;
        var player = game.players[playerIndex];
        if (!player) return [];
        return game.tokens
            .filter(function (t) { return t.color === player.color; })
            .filter(function (t) {
                if (t.state === "base") return dice === 6;
                if (t.state === "track" || t.state === "home") {
                    return t.relPos + dice <= HOME_END;
                }
                return false;
            })
            .map(function (t) { return t.id; });
    }

    function activePlayers(game) {
        return game.players.filter(function (p) { return !p.finished; });
    }

    function advanceToNextActive(game) {
        if (!game.players.length) return;
        for (var i = 0; i < game.players.length; i++) {
            game.turnIndex = (game.turnIndex + 1) % game.players.length;
            if (!game.players[game.turnIndex].finished) return;
        }
    }

    function checkPlayerFinish(game, color) {
        var player = null;
        for (var i = 0; i < game.players.length; i++) {
            if (game.players[i].color === color) { player = game.players[i]; break; }
        }
        if (!player || player.finished) return false;

        var ownTokens = game.tokens.filter(function (t) { return t.color === color; });
        var allHome = ownTokens.length === TOKENS_PER_PLAYER && ownTokens.every(function (t) {
            return t.relPos === HOME_END;
        });

        if (allHome) {
            player.finished = true;
            if (game.ranks.indexOf(color) === -1) game.ranks.push(color);
            return true;
        }
        return false;
    }

    function checkGameOver(game) {
        if (game.players.length < 2) return false;
        var active = activePlayers(game);
        if (active.length > 1) return false;

        if (active.length === 1 && game.ranks.indexOf(active[0].color) === -1) {
            game.ranks.push(active[0].color);
        }
        game.state = "finished";
        game.winner = game.ranks[0] || null;
        return true;
    }

    function rollDice(game, options) {
        options = options || {};
        if (game.state === "finished") return fail("GAME_OVER", "The match is already over.");
        if (game.state !== "awaiting-roll") {
            return fail("WRONG_PHASE", "The dice cannot be rolled right now.");
        }

        var player = game.players[game.turnIndex];
        if (!player) return fail("NO_PLAYER", "No active player.");

        var dice = options.forced != null
            ? Math.max(1, Math.min(6, Math.floor(options.forced)))
            : Math.floor(Math.random() * 6) + 1;

        game.extraTurn = false;

        if (dice === 6) {
            game.consecutiveSixes += 1;
        } else {
            game.consecutiveSixes = 0;
        }

        // Existing custom rule: three consecutive sixes lose the turn.
        if (dice === 6 && game.consecutiveSixes >= 3) {
            game.dice = 0;
            game.consecutiveSixes = 0;
            game.extraTurn = false;
            game.state = "awaiting-roll";
            touch(game);
            return {
                ok: true,
                dice: dice,
                tripleSix: true,
                noMoves: true,
                autoEndTurn: true,
                playerId: player.id,
                color: player.color,
                playerName: player.name,
                legalTokenIds: [],
                extraTurn: false
            };
        }

        game.dice = dice;
        // Existing custom rule: a 6 or a 1 grants another roll.
        game.extraTurn = (dice === 6 || dice === 1);

        var legal = getValidTokenIds(game, game.turnIndex, dice);
        game.state = legal.length ? "awaiting-move" : "awaiting-roll";

        touch(game);
        return {
            ok: true,
            dice: dice,
            tripleSix: false,
            noMoves: legal.length === 0,
            autoEndTurn: legal.length === 0,
            playerId: player.id,
            color: player.color,
            playerName: player.name,
            legalTokenIds: legal,
            extraTurn: game.extraTurn
        };
    }

    /**
     * Ends a roll that produced no move (or a triple-six penalty).
     * A 6/1 keeps the turn (existing rule), otherwise the turn passes.
     */
    function endTurnAfterRoll(game) {
        if (game.state === "finished") return;
        game.dice = 0;
        if (!game.extraTurn) {
            game.consecutiveSixes = 0;
            advanceToNextActive(game);
        }
        game.extraTurn = false;
        game.state = "awaiting-roll";
        touch(game);
    }

    function moveToken(game, tokenId) {
        if (game.state === "finished") return fail("GAME_OVER", "The match is already over.");
        if (game.state !== "awaiting-move") {
            return fail("WRONG_PHASE", "No token move is pending.");
        }

        var player = game.players[game.turnIndex];
        if (!player) return fail("NO_PLAYER", "No active player.");

        var token = null;
        for (var i = 0; i < game.tokens.length; i++) {
            if (game.tokens[i].id === tokenId) { token = game.tokens[i]; break; }
        }
        if (!token) return fail("UNKNOWN_TOKEN", "That token does not exist.");
        if (token.color !== player.color) {
            return fail("NOT_YOUR_TOKEN", "That token belongs to another player.");
        }

        var legal = getValidTokenIds(game, game.turnIndex, game.dice);
        if (legal.indexOf(tokenId) === -1) {
            return fail("ILLEGAL_MOVE", "That token cannot move " + game.dice + " step(s).");
        }

        var from = { state: token.state, relPos: token.relPos };
        var path = [];
        var dice = game.dice;

        if (token.state === "base") {
            token.state = "track";
            token.relPos = 0;
            path.push(0);
        } else {
            var start = token.relPos;
            for (var step = 1; step <= dice; step++) {
                token.relPos = start + step;
                path.push(token.relPos);
            }
            if (token.relPos > TRACK_END) token.state = "home";
        }

        var captures = [];
        var reachedHome = token.relPos === HOME_END;
        var captureCells = [];

        if (reachedHome) {
            game.extraTurn = true;
        } else if (token.state === "track" && !isSafePosition(token.relPos, token.color)) {
            var landing = coordsFor(token.color, token.state, token.relPos);
            game.tokens.forEach(function (other) {
                if (other.color === token.color) return;
                if (other.state !== "track") return;
                var otherCell = coordsFor(other.color, other.state, other.relPos);
                if (sameCell(landing, otherCell)) {
                    captures.push({ id: other.id, color: other.color });
                    captureCells.push(otherCell);
                    other.state = "base";
                    other.relPos = -1;
                }
            });
            if (captures.length) game.extraTurn = true;
        }

        var justFinished = false;
        if (reachedHome) {
            justFinished = checkPlayerFinish(game, token.color);
        }

        var gameOver = checkGameOver(game);

        if (!gameOver) {
            if (game.extraTurn) {
                // Same player rolls again.
                game.state = "awaiting-roll";
            } else {
                game.consecutiveSixes = 0;
                advanceToNextActive(game);
                game.state = "awaiting-roll";
            }
        }

        game.dice = 0;
        game.extraTurn = false;
        touch(game);

        return {
            ok: true,
            tokenId: token.id,
            playerId: player.id,
            color: player.color,
            playerName: player.name,
            move: {
                from: from,
                path: path,
                to: { state: token.state, relPos: token.relPos },
                captures: captures,
                captureCells: captureCells,
                reachedHome: reachedHome,
                playerFinished: justFinished
            },
            captures: captures,
            extraTurn: !gameOver && (game.state === "awaiting-roll" && game.turnIndex === game.players.indexOf(player)) ? true : false,
            ranks: game.ranks.slice(),
            gameOver: gameOver,
            winner: game.winner
        };
    }

    /**
     * Removes a player (intentional leave / forfeit) and keeps the match
     * consistent: their tokens leave the board, the turn pointer is
     * repaired and the win condition is re-evaluated.
     */
    function removePlayer(game, playerId) {
        var idx = -1;
        for (var i = 0; i < game.players.length; i++) {
            if (game.players[i].id === playerId) { idx = i; break; }
        }
        if (idx === -1) return { ok: false, code: "UNKNOWN_PLAYER" };

        var removed = game.players[idx];
        var wasTurn = idx === game.turnIndex;

        game.players.splice(idx, 1);
        game.tokens = game.tokens.filter(function (t) { return t.color !== removed.color; });

        if (game.players.length === 0) {
            game.state = "finished";
            touch(game);
            return { ok: true, gameOver: true, empty: true, ranks: game.ranks.slice() };
        }

        if (game.players.length === 1) {
            var last = game.players[0];
            if (!last.finished) {
                last.finished = true;
                if (game.ranks.indexOf(last.color) === -1) game.ranks.push(last.color);
            }
            game.state = "finished";
            game.winner = game.ranks[0] || last.color;
            touch(game);
            return { ok: true, gameOver: true, ranks: game.ranks.slice(), winner: game.winner };
        }

        if (wasTurn) {
            game.turnIndex = idx % game.players.length;
        } else if (game.turnIndex > idx) {
            game.turnIndex -= 1;
        }

        // Skip finished players at the new pointer.
        var guard = 0;
        while (game.players[game.turnIndex] && game.players[game.turnIndex].finished && guard < game.players.length) {
            game.turnIndex = (game.turnIndex + 1) % game.players.length;
            guard++;
        }

        if (wasTurn) {
            game.dice = 0;
            game.extraTurn = false;
            game.consecutiveSixes = 0;
            game.state = "awaiting-roll";
        }

        touch(game);
        return { ok: true, gameOver: false, ranks: game.ranks.slice() };
    }

    function publicGameState(game) {
        var current = game.players[game.turnIndex] || null;
        var legal = (game.state === "awaiting-move" && current)
            ? getValidTokenIds(game, game.turnIndex, game.dice)
            : [];

        return {
            revision: game.revision,
            state: game.state,
            turnIndex: game.turnIndex,
            turnColor: current ? current.color : null,
            turnPlayerId: current ? current.id : null,
            turnPlayerName: current ? current.name : null,
            dice: game.dice,
            extraTurn: game.extraTurn,
            consecutiveSixes: game.consecutiveSixes,
            legalTokenIds: legal,
            ranks: game.ranks.slice(),
            winner: game.winner,
            players: game.players.map(function (p) {
                return {
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    seat: p.seat,
                    finished: p.finished,
                    connected: p.connected
                };
            }),
            tokens: game.tokens.map(function (t) {
                return {
                    id: t.id,
                    color: t.color,
                    playerIndex: t.playerIndex,
                    state: t.state,
                    relPos: t.relPos
                };
            })
        };
    }

    return {
        COLORS: COLORS,
        HEX: HEX,
        START_OFFSETS: START_OFFSETS,
        MAIN_TRACK: MAIN_TRACK,
        HOME_TRACKS: HOME_TRACKS,
        BASE_COORDS: BASE_COORDS,
        SAFE_ZONES: SAFE_ZONES,
        TOKENS_PER_PLAYER: TOKENS_PER_PLAYER,
        TRACK_END: TRACK_END,
        HOME_END: HOME_END,
        createGame: createGame,
        rollDice: rollDice,
        endTurnAfterRoll: endTurnAfterRoll,
        moveToken: moveToken,
        removePlayer: removePlayer,
        getValidTokenIds: getValidTokenIds,
        isSafePosition: isSafePosition,
        coordsFor: coordsFor,
        publicGameState: publicGameState,
        touch: touch
    };
});
