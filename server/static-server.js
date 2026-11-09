"use strict";

/*
 * Optional frontend-only dev server.
 * Useful when the backend runs separately on another port:
 *
 *   terminal 1: npm start                 (backend + API on :3000)
 *   terminal 2: PORT=5173 npm run serve   (static frontend on :5173)
 *
 * Open http://localhost:5173 and point it at the backend with
 *   http://localhost:5173/?server=http://localhost:3000
 */

const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.join(__dirname, "..");

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

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Static frontend: http://localhost:${PORT}`);
    console.log(`Backend expected at: ${process.env.LUDO_SERVER || "http://localhost:3000"}`);
});
