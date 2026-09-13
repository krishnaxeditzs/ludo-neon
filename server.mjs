import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";

const port = process.env.PORT || 3000;
const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".json": "application/json" };
const makeCode = () => {
  let code;
  do code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); while (rooms.has(code));
  return code;
};
const send = (socket, data) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(data));
const broadcast = (room, data, except) => room.clients.forEach((client) => client !== except && send(client, data));

const server = createServer(async (request, response) => {
  const path = normalize(request.url === "/" ? "index.html" : request.url.split("?")[0]).replace(/^([.][.][\\/])+/, "");
  const file = join(process.cwd(), path);
  try {
    if (!(await stat(file)).isFile()) throw new Error("not a file");
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end("Not found");
  }
});
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let message; try { message = JSON.parse(raw); } catch { return send(socket, { type: "error", message: "Invalid message." }); }
    if (message.type === "create") {
      const code = makeCode();
      rooms.set(code, { clients: [socket], state: null }); socket.roomCode = code; socket.color = "red";
      return send(socket, { type: "room-created", code });
    }
    if (message.type === "join") {
      const room = rooms.get(message.code);
      if (!room) return send(socket, { type: "error", message: "That room code does not exist." });
      if (room.clients.length >= 2) return send(socket, { type: "error", message: "That room is already full." });
      room.clients.push(socket); socket.roomCode = message.code; socket.color = "green";
      room.clients.forEach((client) => send(client, { type: "game-ready", code: message.code, color: client.color }));
      return;
    }
    if (message.type === "state") {
      const room = rooms.get(socket.roomCode);
      if (!room || room.clients.length !== 2) return;
      room.state = message.state; broadcast(room, { type: "state", state: message.state }, socket);
    }
  });
  socket.on("close", () => {
    const room = rooms.get(socket.roomCode); if (!room) return;
    room.clients = room.clients.filter((client) => client !== socket);
    broadcast(room, { type: "opponent-left" });
    if (!room.clients.length) rooms.delete(socket.roomCode);
  });
});
server.listen(port, () => console.log(`Ludo Neon online server listening on http://localhost:${port}`));
