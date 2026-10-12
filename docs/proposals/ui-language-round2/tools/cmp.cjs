// node cmp.cjs <outName> <width> <png name>... : side-by-side contact sheet for review (out/cmp/<outName>.png)
const path = require("node:path");
const sharp = require(path.resolve(__dirname, "../../../../node_modules/sharp"));
(async () => {
  const [name, w, ...files] = process.argv.slice(2);
  const W = Number(w);
  const imgs = await Promise.all(files.map((f) => sharp(path.resolve(__dirname, "out", `${f}.png`)).resize({ width: W }).toBuffer()));
  const metas = await Promise.all(imgs.map((b) => sharp(b).metadata()));
  const H = Math.max(...metas.map((m) => m.height));
  await sharp({ create: { width: (W + 10) * imgs.length, height: H, channels: 3, background: "#888" } })
    .composite(imgs.map((b, i) => ({ input: b, left: i * (W + 10), top: 0 }))).png().toFile(path.resolve(__dirname, "out/cmp", `${name}.png`));
})();
