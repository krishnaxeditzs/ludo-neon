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
npm test             # 27 automated rule / engine / room / sync tests
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
controller.js              gamepad focus/navigation + online gameplay input
config.js                  frontend runtime config (backend URL)
online.js                  online client: lobby, socket sync, animation, reconnect
vendor/socket.io.min.js    pinned Socket.IO browser client (4.7.5)
shared/ludo-core.js        rule engine shared by the server (CommonJS + browser)
server/
  server.js                Express + Socket.IO entry, health, static hosting, CORS
  game-engine.js           per-match authoritative wrapper + auto turn end
  room-manager.js          rooms, codes, hosts, reconnect tokens, cleanup
  socket-handler.js        event validation, rate limits, broadcasts, forfeits
  static-server.js         optional frontend-only dev server  tests/
  core.test.js             rule engine tests (captures, safe zones, home, win…)
  game-engine.test.js      server auto-move, base entry, zero/multiple moves
  online.test.js           multi-client room/sync/auto-move/reconnect/rematch/rate tests
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
* A roll with exactly one legal token move is executed immediately by the
  authoritative engine; the dice event carries the move so every client can
  animate it. Base tokens are included in the legal-move count.
* If a roll has no legal move (or three sixes), the server auto-ends the turn
  after a short delay.
* Online dice reuse the original roll animation: an immediate visual preview,
  eight random faces at ~30 ms intervals, the authoritative value, then the
  original 220 ms hold. The rolling client starts the preview immediately, the
  server supplies the result, and all clients settle on the same value before
  state advances; reduced-motion users skip the spin. Dice and move broadcasts
  are deduplicated by revision so a repeated event cannot replay an animation.
* `revision` increases on every mutation, so stale/replayed actions and
  out-of-order snapshots are detected and ignored. The client also ignores
  lower-revision snapshots and queues newer ones while an animation is running.

### Gamepad controls

Mode tabs are reached with **B** from any setup screen (or **↑** from the first
Local/Online control). Standard mapping:

| Input | Action |
| --- | --- |
| D-pad / left stick | Move focus; ←/→ changes selects, counts and colors |
| A | Confirm mode/control; roll dice; confirm a legal token |
| B | Back to mode tabs; cancel text editing; leave lobby |
| X | Confirm the selected online token |
| LB / RB | Cycle legal tokens (←/→ also works) |
| START | Pause / resume |
| Y | Toggle Always Six in Single/Local only |

Text inputs take real keyboard focus; the physical keyboard remains usable, and
mouse/touch listeners are unchanged. Hidden controls and disabled start buttons
are excluded from the focus list.

**Always Six:** Y toggles the original offline cheat with an on-screen ON/OFF
notice. While ON, every **controller** dice roll in Single Player and Local
Multiplayer is forced to six through `window.debugForcedDice`; turning it off
clears the pending value. Online rolls never read that variable; the server
owns the dice, so Y is rejected with a clear “offline modes only” message during
an online match.

### Haptics and feedback

The original controller haptics are reused unchanged in Single, Local and
Online play: menu `0.12/0.05/18 ms`, toggle-on `0.30/0.18/40`, toggle-off
`0.18/0.10/28`, pause `0.55/0.30/90`, resume `0.30/0.15/45`, dice
`0.65/0.35/170`, step `0.28/0.20/45`, leave-base `0.45/0.25/80`, capture
`0.40/0.45/220`, home `0.55/0.40/120`, game-start `0.95/0.75/280`. The
three-stage victory pattern is `0.40/0.90/150` immediately, `0.60/0.40/150`
after 220 ms, and `1.00/1.00/280` after 470 ms. The actuator is feature-detected;
unsupported devices log one diagnostic instead of silently failing.

Mobile vibration keeps the original `navigator.vibrate` patterns: step
`[30,20,30]`, move `[80,40,80]`, dice `[100,50,100,50,120]`, capture
`[150,70,150]`, win `[200,100,200,100,300]`. Online dice, steps, base exits,
captures and home/win events trigger the same feedback for every client. Support
is feature-detected, rejected requests are logged once, and duplicate socket
events are ignored by revision.

Victory haptics are emitted by the home animation, not repeated by the result
screen or the `player-won` event.

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

Automated (`npm test`, 27 tests):

* Rules: base escape, 6/1 extra roll, no-move turn pass, capture, safe zones,
  exact home, win/ranks, three sixes, ownership/phase validation, forfeit.
* Server engine: automatic single legal move (including base tokens), zero and
  multiple legal moves, capture/extra-turn preservation, stale replay rejection.
  The online suite also verifies a socket-level base-token automatic move and
  its broadcast to the other client.
* Online: create/join, invalid code, duplicate name, full room, host-only start,
  deterministic dice + move sync, spoofed dice payload rejection, auto-move sync,
  replay rejection, host migration, reconnection token validation, mid-match
  forfeit, rematch authorization, rate limiting.

Manually verified in the browser (two sessions):

* Single-player rolls and turns still work (no regression).
* Local 4-player setup → 16 tokens, named turn banner, no AI.
* Online create/join, room code, lobby sync, host-only start, dice and token
  move synchronization, forced network drop → automatic reconnect/state restore.

Not visually verified: the online victory/Play-Again screen (server rematch is
tested), phones/tablets at narrow widths (responsive CSS added, not viewed),
and a 4-player online match (2-player tested; 5th-join rejection tested).
A physical controller and a real Android device were not available in this
development environment; controller/gamepad and vibration paths were exercised
with browser API stubs, not physical hardware. Real-device vibration and rumble
remain a manual acceptance check.

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
* Gamepad support is implemented and simulated in-browser; a physical controller
  and real mobile hardware were not available for this audit.
* No spectators, chat or server-side match history.
