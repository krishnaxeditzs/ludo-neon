import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";

const port = process.env.PORT || 3000;
const rooms = new Map(), colors = ["red", "green", "blue", "yellow"], alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".json": "application/json" };
const makeCode = () => { let code; do code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); while (rooms.has(code)); return code; };
const send = (socket, data) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(data));
const broadcast = (room, data, except) => room.clients.forEach((client) => client !== except && send(client, data));
const lobbyColors = (room) => room.clients.map((client) => client.color).filter(Boolean);
const broadcastLobby = (room) => room.clients.forEach((client) => send(client, { type: "room-lobby", code: room.code, colors: lobbyColors(room), yourColor: client.color, isHost: client === room.host }));

const server = createServer(async (request, response) => {
  if (request.url === "/health") return response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
  const path = normalize(request.url === "/" ? "index.html" : request.url.split("?")[0]).replace(/^([.][.][\\/])+/, "");
  const file = join(process.cwd(), path);
  try { if (!(await stat(file)).isFile()) throw new Error("not a file"); response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" }); response.end(await readFile(file)); }
  catch { response.writeHead(404).end("Not found"); }
});
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message; try { message = JSON.parse(raw); } catch { return send(socket, { type: "error", message: "Invalid message." }); }
    if (message.type === "create") {
      const code = makeCode(), room = { code, clients: [socket], host: socket, started: false, state: null };
      rooms.set(code, room); socket.roomCode = code; socket.color = null; send(socket, { type: "room-created", code }); return broadcastLobby(room);
    }
    if (message.type === "join") {
      const room = rooms.get(message.code);
      if (!room) return send(socket, { type: "error", message: "That room code does not exist." });
      if (room.started) return send(socket, { type: "error", message: "This match has already started." });
      if (room.clients.length >= 4) return send(socket, { type: "error", message: "That room is already full." });
      room.clients.push(socket); socket.roomCode = room.code; socket.color = null; return broadcastLobby(room);
    }
    const room = rooms.get(socket.roomCode);
    if (!room) return send(socket, { type: "error", message: "Join a room first." });
    if (message.type === "choose-color") {
      if (room.started) return send(socket, { type: "error", message: "This match has already started." });
      if (!colors.includes(message.color)) return send(socket, { type: "error", message: "Choose a valid color." });
      if (room.clients.some((client) => client !== socket && client.color === message.color)) return send(socket, { type: "error", message: "That color is already taken." });
      socket.color = message.color; return broadcastLobby(room);
    }
    if (message.type === "start-match") {
      const selectedColors = lobbyColors(room);
      if (socket !== room.host) return send(socket, { type: "error", message: "Only the room creator can start the match." });
      if (selectedColors.length < 2) return send(socket, { type: "error", message: "At least two players must choose a color." });
      if (selectedColors.length !== room.clients.length) return send(socket, { type: "error", message: "Every player in the room must choose a color." });
      room.started = true; return room.clients.forEach((client) => send(client, { type: "game-ready", code: room.code, color: client.color, colors: selectedColors, isHost: client === room.host }));
    }
    if (message.type === "state" && room.started) { room.state = message.state; broadcast(room, { type: "state", state: message.state }, socket); }
  });
  socket.on("close", () => {
    const room = rooms.get(socket.roomCode); if (!room) return;
    room.clients = room.clients.filter((client) => client !== socket); if (room.host === socket) room.host = room.clients[0];
    if (!room.clients.length) rooms.delete(socket.roomCode); else if (room.started) broadcast(room, { type: "opponent-left" }); else broadcastLobby(room);
  });
});
server.listen(port, () => console.log(`Ludo Neon online server listening on http://localhost:${port}`));
