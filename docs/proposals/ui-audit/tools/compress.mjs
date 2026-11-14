#!/usr/bin/env node
// Compress the chosen raw shots to WebP under docs/proposals/ui-audit/shots/<device>/.
// Usage: node compress.mjs <path to sharp's index.cjs>   (run from the repo root; sharp is not a repo dependency)
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const sharp = createRequire(import.meta.url)(path.resolve(process.argv[2]));
const RAW = "test-results/ui-audit/raw";
const OUT = "docs/proposals/ui-audit/shots";
const list = JSON.parse(await readFile("docs/proposals/ui-audit/tools/shots-list.json", "utf8"));
const widths = { phone: 585, d1280: 1024, d1024: 1024 };
for (const [device, names] of Object.entries(list)) {
  await mkdir(path.join(OUT, device), { recursive: true });
  for (const name of names) {
    try {
      await sharp(path.join(RAW, device, `${name}.png`)).resize(widths[device]).webp({ quality: 60 }).toFile(path.join(OUT, device, `${name}.webp`));
    } catch (error) {
      console.log("skip", device, name, error.message);
    }
  }
}
