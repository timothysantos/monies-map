// Share a fresh immutable seed within one run; every persistence test still
// copies its own real D1. No seed survives the run or crosses code revisions.
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

// A caller cannot accidentally pass a previous run's template to its children.
delete process.env.MONIES_TEST_D1_TEMPLATE;
let template;
let child;
let interrupted = false;
const stop = () => {
  interrupted = true;
  child?.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const supplied = process.argv.slice(2);
  const targets = supplied.length ? supplied : (await Promise.all(["tests", "tests/performance"].map(async (dir) =>
    (await readdir(dir)).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => `${dir}/${file}`)
  ))).flat();
  const files = targets.filter((target) => target.endsWith(".test.mjs"));
  // Pure focused files pay no D1 startup cost. Indirect/other CLI targets
  // safely fall back to the original per-file helper if sharing is unneeded.
  const needsSeed = files.length === 0 || (await Promise.all(files.map((file) => readFile(file, "utf8"))))
    .some((source) => source.includes("d1-workspace.mjs"));
  if (needsSeed && !interrupted) {
    const { createSeededTemplate } = await import("../tests/support/d1-workspace.mjs");
    template = await createSeededTemplate();
  }
  if (interrupted) process.exitCode = 130;
  else process.exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["--import", "tsx", "--test", ...targets], {
      stdio: "inherit",
      env: { ...process.env, ...(template ? { MONIES_TEST_D1_TEMPLATE: template.persistTo } : {}) }
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 130));
  });
} finally {
  await template?.dispose();
}
