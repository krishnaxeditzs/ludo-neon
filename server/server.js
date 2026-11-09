"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { RoomManager } = require("./room-manager");
const { attachSocketHandlers } = require("./socket-handler");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.join(__dirname, "..");

function parseOrigins(value) {
    if (!value || value.trim() === "*") return "*";
    return value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function createServer(options = {}) {
    const app = express();
    const manager = new RoomManager(options.roomManager || {});

    const allowedOrigins = parseOrigins(options.corsOrigin || process.env.CORS_ORIGIN);

    app.disable("x-powered-by");
    app.use(
        cors({
            origin: allowedOrigins === "*" ? true : allowedOrigins,
            methods: ["GET", "POST"]
        })
    );
    app.use(express.json({ limit: "16kb" }));

    app.get("/health", (req, res) => {
        res.json({
            ok: true,
            service: "ludo-neon-server",
            uptime: Math.round(process.uptime()),
            ...manager.stats()
        });
    });

    // Never serve backend sources, tests or local secrets from the static host.
    const PRIVATE_PATH_RE = /^\/(?:server|tests|shared|node_modules|\.git)(?:\/|$)/;
    const PRIVATE_FILE_RE = /^\/(?:package\.json|package-lock\.json|README\.md|\.gitignore|\.env(?:\.example)?|server\.log|server\.pid)$/;
    app.use((req, res, next) => {
        if (PRIVATE_PATH_RE.test(req.path) || PRIVATE_FILE_RE.test(req.path)) {
            return res.status(404).send("Not found");
        }
        next();
    });

    // The same Node service can host the static frontend (single-origin deploy).
    if (process.env.SERVE_STATIC !== "false") {
        app.use(
            express.static(ROOT, {
                index: "index.html",
                extensions: ["html"],
                setHeaders(res, filePath) {
                    if (/\.(?:js|css)$/.test(filePath)) {
                        res.setHeader("Cache-Control", "no-cache");
                    }
                }
            })
        );
    }

    app.use((req, res, next) => {
        if (req.method !== "GET") return next();
        if (req.path.startsWith("/socket.io")) return next();
        res.status(404).send("Not found");
    });

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins === "*" ? true : allowedOrigins,
            methods: ["GET", "POST"]
        },
        maxHttpBufferSize: 64 * 1024,
        pingInterval: 20000,
        pingTimeout: 25000
    });

    attachSocketHandlers(io, manager);

    return { app, httpServer, io, manager };
}

if (require.main === module) {
    const { httpServer, manager, io } = createServer();

    httpServer.listen(PORT, HOST, () => {
        console.log(`🎲 Ludo Neon server listening on http://${HOST}:${PORT}`);
        console.log(`   Health: http://localhost:${PORT}/health`);
        console.log(
            `   CORS: ${process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN : "* (development default)"}`
        );
        console.log("   Rooms are stored in memory and reset when the server restarts.");
    });

    const shutdown = (signal) => {
        console.log(`\n${signal} received — closing server...`);
        io.close();
        httpServer.close(() => {
            manager.shutdown();
            process.exit(0);
        });
        setTimeout(() => process.exit(0), 3000).unref();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

module.exports = { createServer };
