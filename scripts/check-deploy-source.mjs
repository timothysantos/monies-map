// Refuses a production deploy that could roll back someone else's work.
// Production must run exactly what origin/master holds: several sessions work
// in parallel worktrees, and a deploy from a branch (or from a stale master)
// silently replaces what the last deploy shipped. On 2026-10-09 two deploys
// from a master that lacked a branch-deployed CSS change rolled it back.
//
// Passes only when the working tree has no uncommitted changes to tracked
// files and HEAD is exactly origin/master after a fresh fetch. Set
// ALLOW_DEPLOY_FROM_BRANCH=1 to override in an emergency, and say why.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (process.env.ALLOW_DEPLOY_FROM_BRANCH === "1") {
  console.warn("Deploy source check skipped (ALLOW_DEPLOY_FROM_BRANCH=1). Production may lose work that is not in this commit.");
  process.exit(0);
}

git("fetch", "--quiet", "origin", "master");
const head = git("rev-parse", "HEAD");
const master = git("rev-parse", "origin/master");
const dirty = git("status", "--porcelain", "--untracked-files=no");
const problems = [];

if (dirty) {
  problems.push("The working tree has uncommitted changes to tracked files; a deploy would ship code that is not on master.");
}
if (head !== master) {
  const behind = git("rev-list", "--count", `HEAD..${master}`);
  const ahead = git("rev-list", "--count", `${master}..HEAD`);
  problems.push(`HEAD ${head.slice(0, 8)} is not origin/master ${master.slice(0, 8)} (${ahead} commit(s) not on master, ${behind} commit(s) of master missing).`);
}

if (problems.length) {
  console.error("Deploy refused: production must run exactly origin/master.");
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  console.error("Merge your work into master, push it, check out origin/master with a clean tree, then deploy.");
  process.exit(1);
}
console.log(`Deploy source OK: origin/master ${master.slice(0, 8)}, clean tree.`);
