import { prepareStack, startStack } from "../../scripts/e2e-stack.mjs";
const STACK = {
  index: "audit", uiPort: 5677, apiPort: 8977, inspectorPort: 9577,
  baseURL: "http://127.0.0.1:5677", apiOrigin: "http://127.0.0.1:8977",
  persistTo: ".wrangler/state-ui-audit", viteCacheDir: "node_modules/.vite-ui-audit",
  serverLog: "test-results/ui-audit/servers.log",
  vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-10", AI_ALERT_EMAILS: "*" }
};
await prepareStack(STACK);
const { stop } = await startStack(STACK);
console.log("STACK UP", STACK.baseURL);
const res = await fetch(STACK.baseURL + "/api/demo/reseed", { method: "POST" });
console.log("reseed", res.status);
process.on("SIGTERM", async () => { await stop(); process.exit(0); });
process.on("SIGINT", async () => { await stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
