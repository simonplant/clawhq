/**
 * Web dashboard module — Hono + htmx + Pico CSS.
 *
 * Exposes full operational control via browser.
 * `clawhq dashboard` starts the server.
 */

export { createApp } from "./server.js";
export type { DashboardOptions } from "./server.js";
export { startDashboard } from "./start.js";
