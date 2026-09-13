# Ludo Neon Online

The original local game remains available through **Enter the Arena**. Select
**Play Online** to create a private room. Up to four players may join with the
room code, choose an available color, and then the room creator starts the match.

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
Render, Railway, Fly.io, or a VPS). The included `railway.toml` configures
Railway to run `npm start` and check `/health`. In Railway, create a project
from this GitHub repository and select the `online-multiplayer` branch. Enable
automatic deployments once; Railway will redeploy whenever a new commit is
pushed to that branch. The server uses the host-provided `PORT` variable and
serves both the game and the WebSocket connection from the same address, so no
client configuration is needed after deployment. Share the deployed HTTPS link
with friends.

Rooms are held in memory. They disappear once both players leave or when the
server is restarted. This is a deliberate lightweight first version; adding a
database and server-side move validation would be the next step for persistent
or competitive rooms.
