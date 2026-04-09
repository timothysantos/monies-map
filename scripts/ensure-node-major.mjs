const requiredMajor = Number(process.argv[2] ?? "22");
const currentVersion = process.versions.node ?? "";
const currentMajor = Number(currentVersion.split(".")[0] ?? "0");

if (currentMajor === requiredMajor) {
  process.exit(0);
}

console.error(
  [
    `Monie's Map requires Node ${requiredMajor} for local scripts.`,
    `Current runtime: v${currentVersion}.`,
    "Run `nvm use` from the repo root, then rerun the command."
  ].join("\n")
);

process.exit(1);
