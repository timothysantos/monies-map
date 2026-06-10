const requiredVersion = process.argv[2] ?? "22.12.0";
const currentVersion = process.versions.node ?? "";
const parseVersion = (version) =>
  version.split(".").map((part) => Number(part.replace(/\D.*$/, "") || "0"));
const requiredParts = parseVersion(requiredVersion);
const currentParts = parseVersion(currentVersion);
const comparison = requiredParts.reduce((result, requiredPart, index) => {
  if (result !== 0) {
    return result;
  }

  return Math.sign((currentParts[index] ?? 0) - requiredPart);
}, 0);
const meetsMinimum = comparison >= 0;

if (meetsMinimum) {
  process.exit(0);
}

console.error(
  [
    `Monie's Map requires Node ${requiredVersion} or newer for local scripts.`,
    `Current runtime: v${currentVersion}.`,
    "Run `nvm use` from the repo root, then rerun the command."
  ].join("\n")
);

process.exit(1);
