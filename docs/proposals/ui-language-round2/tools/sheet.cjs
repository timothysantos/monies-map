// node sheet.cjs out width name...
const sharp = require("/Users/tim/22m/ai-projects/monies_map/.claude/worktrees/agent-a5fed01af598d5cb6/node_modules/sharp");
(async () => {
  const [out, w, ...names] = process.argv.slice(2);
  const W = Number(w);
  const imgs = [];
  for (const n of names) imgs.push(await sharp(n.includes("/") ? n : `explore/${n}.png`).resize({ width: W }).toBuffer());
  const metas = await Promise.all(imgs.map((b) => sharp(b).metadata()));
  const H = Math.max(...metas.map((m) => m.height));
  await sharp({ create: { width: (W + 10) * imgs.length, height: H, channels: 3, background: "#888" } })
    .composite(imgs.map((b, i) => ({ input: b, left: i * (W + 10), top: 0 }))).png().toFile(`explore/${out}.png`);
})();
