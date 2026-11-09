/*
 * Runtime configuration for the frontend.
 *
 * Resolution order for the backend URL (see online.js):
 *   1. `?server=https://my-backend.example.com` query parameter (also saved)
 *   2. this value, if set
 *   3. the origin that served the page (single-origin deployment)
 *   4. http://localhost:3000 when opened from file://
 *
 * For GitHub Pages, set serverUrl to your deployed Node backend, e.g.
 *   window.LUDO_CONFIG = { serverUrl: "https://ludo-neon.onrender.com" };
 * or leave it empty and share links like ?server=https://...
 */
window.LUDO_CONFIG = {
    serverUrl: ""
};
