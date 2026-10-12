// node encode.mjs : out/*.png -> ../*.webp (phone 780 px wide q70, desktop 1280 px q72).
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)(`${ROOT}/node_modules/sharp`);
const OUT = path.join(HERE, "out");
const DEST = path.resolve(HERE, "..");
await mkdir(DEST, { recursive: true });
const files = (await readdir(OUT)).filter((f) => f.endsWith(".png") && !/^(explore|x-)/.test(f) && !/FAILED/.test(f));
for (const f of files) {
  const phone = /-phone/.test(f);
  const target = path.join(DEST, f.replace(/\.png$/, ".webp"));
  await sharp(path.join(OUT, f)).resize({ width: phone ? 780 : 1280, withoutEnlargement: true }).webp({ quality: phone ? 70 : 72, effort: 5 }).toFile(target);
}
console.log(`${files.length} images`);
