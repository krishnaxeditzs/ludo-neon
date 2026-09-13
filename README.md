# Ludo Neon Online

The original local game remains available through **Enter the Arena**. Select
**Play Online** to create a two-player private room. The creator is Red and the
joining player is Green; room codes are generated server-side.

## Run locally

Install a current Node.js LTS release, then run:

```powershell
npm install
npm start
```

Open `http://localhost:3000` in two browser windows. Create a room in one,
then use its six-character code in the other.

## Play with friends on the internet

Deploy this folder to a Node.js host that supports WebSockets (for example,
Render, Railway, Fly.io, or a VPS). Configure its start command as `npm start`.
The server uses the host-provided `PORT` variable and serves both the game and
the WebSocket connection from the same address, so no client configuration is
needed after deployment. Share the deployed HTTPS link with friends.

Rooms are held in memory. They disappear once both players leave or when the
server is restarted. This is a deliberate lightweight first version; adding a
database and server-side move validation would be the next step for persistent
or competitive rooms.
