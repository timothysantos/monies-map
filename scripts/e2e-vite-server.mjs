// Vite dev server for one isolated browser test stack. The Vite CLI has no
// cache-dir flag, and stacks that share node_modules/.vite race each other's
// dependency optimisation, so each stack gets its own cacheDir here.
// VITE_API_ORIGIN (read by vite.config.js) points /api at the stack's Worker.
import path from "node:path";
import process from "node:process";

import { createServer } from "vite";

const port = Number(process.env.E2E_UI_PORT);
const cacheDir = process.env.E2E_VITE_CACHE_DIR;
if (!Number.isInteger(port) || !cacheDir || !process.env.VITE_API_ORIGIN) {
  throw new Error("E2E_UI_PORT, E2E_VITE_CACHE_DIR and VITE_API_ORIGIN are required.");
}

const server = await createServer({
  configFile: path.resolve("vite.config.js"),
  cacheDir: path.resolve(cacheDir),
  clearScreen: false,
  server: { host: "127.0.0.1", port, strictPort: true }
});
await server.listen();
server.printUrls();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
