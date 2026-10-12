// Run with cwd = the worktree. Keeps an isolated showcase stack alive.
import { prepareStack, startStack } from "/Users/tim/22m/ai-projects/monies_map/.claude/worktrees/agent-a5fed01af598d5cb6/scripts/e2e-stack.mjs";
const STACK = {
  index: "mock2", uiPort: 5471, apiPort: 8871, inspectorPort: 9471,
  baseURL: "http://127.0.0.1:5471", apiOrigin: "http://127.0.0.1:8871",
  persistTo: ".wrangler/state-mock2", viteCacheDir: "node_modules/.vite-mock2",
  serverLog: "test-results/mock2/servers.log",
  vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: "2026-09", AI_ALERT_EMAILS: "*" }
};
await prepareStack(STACK);
const { stop } = await startStack(STACK);
console.log("READY", STACK.baseURL);
for (let i = 0; i < 10; i += 1) {
  const res = await fetch(STACK.baseURL + "/api/demo/reseed", { method: "POST" }).catch(() => null);
  if (res?.ok) { console.log("reseeded"); break; }
  await new Promise((r) => setTimeout(r, 750));
}
const quit = async () => { await stop(); process.exit(0); };
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
setInterval(() => {}, 1 << 30);
