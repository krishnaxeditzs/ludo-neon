# Ludo Neon — Single Player, Local & Online Multiplayer

An upgrade of the existing **Ludo Neon** browser game (HTML + CSS + vanilla JavaScript)
into a three-mode game:

| Mode | Players | Devices | Authority |
| --- | --- | --- | --- |
| **Single Player** | 2–4 (Human / AI mix) | one | existing browser engine (unchanged) |
| **Local Multiplayer** | 2–4 humans | one | existing browser engine (unchanged) |
| **Online Multiplayer** | 2–4 humans | separate devices | Node.js + Socket.IO server |

The original board, neon theme, animations, sounds, settings, pause screen, gamepad
support and single-player rules were kept. Nothing was rebuilt from a template.

---

## 1. Quick start (development)

Requirements: **Node.js 18+** and npm.

```bash
npm install
npm start
```

Open <http://localhost:3000>. The same Node process serves the frontend and the
Socket.IO backend, so online play works immediately with no extra configuration.

Other useful commands:

```bash
npm run dev          # backend with auto-restart (node --watch)
npm run serve        # optional static-only frontend server on :5173
npm test             # 19 automated rule / room / sync tests
```

### Test online play on one machine

1. Open <http://localhost:3000>.
2. Choose **ONLINE**, enter a name, click **CREATE ROOM**, copy the room code.
3. Open a second **incognito window** (or a different browser) and join with that code.
4. Host clicks **START MATCH**.

Each browser tab keeps its own reconnection session, so use separate browser
profiles/incognito windows for multiple players on one machine.

### Test on phones / other computers (same Wi-Fi)

1. Start the server (`npm start`).
2. Find the computer's LAN IP (e.g. `192.168.1.20`).
3. Open `http://192.168.1.20:3000` on the other devices.
4. Allow port 3000 through the firewall if prompted.

### Split frontend / backend development

```bash
# terminal 1 - backend
npm start                                  # http://localhost:3000

# terminal 2 - static frontend
PORT=5173 npm run serve                    # http://localhost:5173
```

Then open `http://localhost:5173/?server=http://localhost:3000`.
The `server` query parameter is remembered in `localStorage`.

---

## 2. Project structure

```
index.html                 existing screens + multiplayer panels/lobby
style.css                  existing theme + appended multiplayer styles
script.js                  existing single/local engine (only small guards added)
controller.js              existing gamepad support (+ online input guard)
config.js                  frontend runtime config (backend URL)
online.js                  online client: lobby, socket sync, animation, reconnect
vendor/socket.io.min.js    pinned Socket.IO browser client (4.7.5)
shared/ludo-core.js        rule engine shared by the server (CommonJS + browser)
server/
  server.js                Express + Socket.IO entry, health, static hosting, CORS
  game-engine.js           per-match authoritative wrapper + auto turn end
  room-manager.js          rooms, codes, hosts, reconnect tokens, cleanup
  socket-handler.js        event validation, rate limits, broadcasts, forfeits
  static-server.js         optional frontend-only dev server
tests/
  core.test.js             rule engine tests (captures, safe zones, home, win…)
  online.test.js           multi-client room/sync/reconnect/rematch/rate tests
```

### Technical analysis of the original project

* **Board** — 15×15 CSS grid, 52-cell `mainTrack`, per-color start offsets
  (`red 0`, `green 13`, `blue 26`, `yellow 39`), 6-cell home tracks, 8 safe cells,
  4 base slots per color.
* **State** — module-level globals in `script.js`: `players`, `tokens`,
  `turnIndex`, `ranks`, `state`, `currentDice`, `extraTurnGranted`,
  `consecutiveSixes`, plus `isPaused`/audio settings.
* **Tokens** — `{ id, color, playerIndex, state: base|track|home, relPos }`
  with DOM elements attached as `el`; `relPos 56` means finished.
* **Rules preserved** — leave base only on a 6; exact roll needed to reach 56;
  captures only outside safe cells; **6 or 1 grants an extra roll**;
  **three consecutive sixes lose the turn**; capture and reaching home grant an
  extra roll; finished players are skipped; last active player is ranked.
* **Turn flow** — `startTurn → handleDiceClick → rollDiceLogic → processMoves →
  executeMove/checkInteractions → endTurn`.
* **What was reused** — board generation, token DOM/skin, step animation, trails,
  particles, sounds, vibration, gamepad haptics, pause/settings, rankings.
* **What was modified** — `startGame()` now delegates to `startGameWithConfig()`
  so local mode can pass names/colors; a name-aware turn banner/rankings;
  three online guards (dice click, token click, exit to menu); gamepad guard so
  new panels cannot accidentally start the single-player setup.

---

## 3. Multiplayer architecture

### Local multiplayer

All players are human on one device. The existing engine still owns the game;
the new local panel only collects 2–4 names/unique colors and calls
`startGameWithConfig(config)`. AI is still available in Single Player only.

### Online multiplayer

```
browser A ─┐                       ┌─ room manager (in memory)
           ├── Socket.IO ── Node ───┤   GameEngine (authoritative)
browser B ─┘                       └─ validation + rate limits
```

* The server generates dice values. Clients **never** send a dice number or a
  resulting position; they only send intents (`roll-dice`, `move-token`).
* Every action is validated server-side: room membership, current turn, token
  ownership, phase, legal move list, captures, home, rankings and win state.
* After each change the server broadcasts a full snapshot
  (`revision`, `turnIndex`, `dice`, `state`, `legalTokenIds`, `players`, `tokens`,
  `ranks`, `winner`). Clients animate the move and then apply the snapshot.
* If a roll has no legal move (or three sixes), the server auto-ends the turn
  after a short delay.
* `revision` increases on every mutation, so stale/replayed actions and
  out-of-order snapshots can be detected and ignored.

### Disconnection & reconnection

* Each player gets a random **reconnection token** (only its SHA-256 hash is
  stored on the server) and stable player id.
* Lobby seats are reserved for 10 minutes (default); a live match seat is
  reserved for 5 minutes, after which the server **forfeits** the player so the
  remaining match can continue.
* Host disconnects → host role moves immediately to the next connected player.
  Reconnecting does not automatically take host back.
* The browser stores `{code, playerId, token}` in `localStorage`. On a socket
  reconnect it automatically calls `reconnect-player`; the full game state is
  restored. A “Resume room” button is available on the online panel, and
  `?resume=1` resumes on page load.

> **In-memory storage:** rooms and matches live in a JavaScript `Map`.
> A backend restart/crash deletes every room, active match and reconnection
> session. `RoomManager` is intentionally storage-agnostic (`createRoom`,
> `joinRoom`, `reconnect`, `removePlayer`, …) so Redis/Postgres persistence can
> be added behind the same interface later.

### Socket events

Client → server: `create-room`, `join-room`, `leave-room`, `start-game`,
`rematch`, `roll-dice`, `move-token`, `request-game-state`, `reconnect-player`.

Server → client: `room-created`, `room-joined`, `lobby-updated`, `game-started`,
`dice-rolled`, `token-moved`, `game-state-updated`, `player-disconnected`,
`player-reconnected`, `player-won`, `game-over`, `action-rejected`,
`room-closed`.

Request/response events also accept an acknowledgement callback; failures use
`{ ok: false, code, error }` codes such as `NOT_HOST`, `NOT_YOUR_TURN`,
`ILLEGAL_MOVE`, `ROOM_FULL`, `ROOM_NOT_FOUND`, `NAME_TAKEN`, `RATE_LIMITED`,
`INVALID_SESSION`, `SESSION_EXPIRED`.

### Security & reliability

* Server-authoritative dice / moves / turn order.
* Membership check on every room action (socket → room → player identity).
* Reconnection tokens hashed with SHA-256, expiring seats.
* Input validation: name 1–16 chars (control characters stripped, HTML-escaped
  on render), room code `^[A-Z0-9]{4,6}$`, known colors, 64 KB socket payload cap.
* Rate limits per socket: room create 5/10 s, join 6/10 s, start/rematch 3/10 s,
  reconnect 10/10 s, roll 8/3 s, move 12/3 s.
* CORS allow-list via `CORS_ORIGIN`.
* Static hosting refuses `/server`, `/tests`, `/shared`, `node_modules`,
  `package.json`, `.env*`, logs and `.md` files.
* No server secrets are used by the browser; only the public backend URL.

---

## 4. Configuration

Copy `.env.example` to `.env` or set these in your host dashboard
(no `dotenv` dependency; the server reads `process.env`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/Socket.IO port |
| `HOST` | `0.0.0.0` | Bind interface |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins (use your real origins in production) |
| `SERVE_STATIC` | `true` | Serve the frontend from the Node server |
| `MAX_ROOMS` | `500` | Maximum concurrent rooms |
| `RECONNECT_TTL_MS` | `600000` | Lobby seat reservation window |
| `EMPTY_ROOM_TTL_MS` | `300000` | Delete empty rooms after this long |
| `IDLE_ROOM_TTL_MS` | `7200000` | Delete inactive rooms |
| `FORFEIT_AFTER_MS` | `300000` | Auto-forfeit a disconnected player in a live match |

Frontend (`config.js`):

```js
window.LUDO_CONFIG = {
    serverUrl: "" // "" = same origin; or "https://your-backend.example.com"
};
```

Resolution order: `?server=URL` (remembered) → `config.js` → page origin →
`http://localhost:3000` for `file://`.

---

## 5. Deployment

### A. One service (simplest)

Deploy the whole repository to any Node host (Render, Railway, Fly.io,
DigitalOcean, a VPS). Example (Render):

* Build command: `npm install`
* Start command: `npm start`
* Environment:
  * `CORS_ORIGIN=https://your-frontend.example.com` (or your custom domain)
  * `SERVE_STATIC=true`
  * leave `PORT` unset — the platform provides it

Open the service URL. Health check: `GET /health`.

### B. Static frontend (GitHub Pages) + Node backend

GitHub Pages **cannot** run the Socket.IO server. Use it only for static files.

1. Deploy the backend to a Node host (as above) and note its HTTPS URL.
2. Publish the frontend:
   * Either publish the repository root with GitHub Pages (it contains
     `index.html`, `style.css`, scripts and `vendor/socket.io.min.js`), or copy
     those files into your Pages branch.
   * Set `config.js`:
     ```js
     window.LUDO_CONFIG = { serverUrl: "https://ludo-neon.onrender.com" };
     ```
     or share `https://<user>.github.io/<repo>/?server=https://ludo-neon.onrender.com`.
3. On the backend set:
   * `CORS_ORIGIN=https://<user>.github.io`
   * `SERVE_STATIC=false`
4. Use HTTPS for both origins (the page must not mix HTTPS with `http://` sockets).

> **Scaling note:** rooms are in memory and a single instance is assumed. For
> multiple instances you need sticky sessions, `@socket.io/redis-adapter`, and a
> shared room/game store instead of `RoomManager`'s `Map`.

---

## 6. Testing

Automated (`npm test`, 19 tests):

* Rules: base escape, 6/1 extra roll, no-move turn pass, capture, safe zones,
  exact home, win/ranks, three sixes, ownership/phase validation, forfeit.
* Online: create/join, invalid code, duplicate name, full room, host-only start,
  deterministic dice + move sync, replay rejection, host migration,
  reconnection token validation, mid-match forfeit, rematch authorization,
  rate limiting.

Manually verified in the browser (two sessions):

* Single-player rolls and turns still work (no regression).
* Local 4-player setup → 16 tokens, named turn banner, no AI.
* Online create/join, room code, lobby sync, host-only start, dice and token
  move synchronization, forced network drop → automatic reconnect/state restore.

Not visually verified: the online victory/Play-Again screen (server rematch is
tested), phones/tablets at narrow widths (responsive CSS added, not viewed),
and a 4-player online match (2-player tested; 5th-join rejection tested).

### Manual 2–4 player checklist

Use normal + incognito windows or separate devices:

1. Create/join rooms, try a wrong code, try a 5th player.
2. Host start; verify only the host can start.
3. Roll from each client; both must show the same die and turn.
4. Move a token; verify all clients animate and agree.
5. Try moving another color; the server must reject it.
6. Leave/refresh one client; verify reconnect and host migration.
7. Finish a match; host “Play Again”; check the result screen.

---

## 7. Known limitations

* Rooms are in memory — server restart loses all games (by design for v1).
* No turn timer; a disconnected player pauses the match until they return or
  are forfeited after `FORFEIT_AFTER_MS`.
* Leaving a live match forfeits; if one player remains, the match ends.
* Rematch uses currently connected players only.
* Local mode is all-human; AI remains a single-player feature.
* New menu/lobby panels are mouse/touch-first; gamepad navigation was only
  extended with safety guards, not full lobby navigation.
* No spectators, chat or server-side match history.
