import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const root = process.argv[2];
const files = ["public/styles.css",
  ...readdirSync(path.join(root, "src/client")).filter((f) => f.endsWith(".css")).map((f) => "src/client/" + f),
  ...readdirSync(path.join(root, "src/client/ui")).filter((f) => f.endsWith(".css")).map((f) => "src/client/ui/" + f)];
const props = { "border-radius": new Map(), "box-shadow": new Map(), "font-size": new Map(), "font-weight": new Map(), "min-height": new Map() };
const hex = new Map();
const rgba = new Map();
for (const f of files) {
  const css = readFileSync(path.join(root, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const prop of Object.keys(props)) {
    const re = new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;}]+)`, "g");
    for (const m of css.matchAll(re)) {
      const v = m[1].trim();
      const e = props[prop].get(v) ?? { n: 0, files: new Set() };
      e.n++; e.files.add(path.basename(f)); props[prop].set(v, e);
    }
  }
  // raw colours outside :root
  const noRoot = css.replace(/:root\s*\{[\s\S]*?\}/, "");
  for (const m of noRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const v = m[0].toLowerCase();
    const e = hex.get(v) ?? { n: 0, files: new Set() }; e.n++; e.files.add(path.basename(f)); hex.set(v, e);
  }
  for (const m of noRoot.matchAll(/rgba?\([^)]*\)/g)) {
    const v = m[0].replace(/\s+/g, "");
    const e = rgba.get(v) ?? { n: 0, files: new Set() }; e.n++; e.files.add(path.basename(f)); rgba.set(v, e);
  }
}
const show = (name, map, limit = 60) => {
  console.log(`\n## ${name}: ${map.size} distinct`);
  [...map.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, limit).forEach(([v, e]) => console.log(`${String(e.n).padStart(4)}  ${v}   [${[...e.files].slice(0, 4).join(", ")}${e.files.size > 4 ? "…" : ""}]`));
};
console.log("files:", files.length);
for (const [k, m] of Object.entries(props)) show(k, m, k === "box-shadow" ? 40 : 50);
show("raw hex outside :root", hex, 80);
show("rgb/rgba outside :root", rgba, 40);
