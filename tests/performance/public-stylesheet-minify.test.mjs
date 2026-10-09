import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Features } from "lightningcss";

import viteConfig, { lightningcssTargets, minifyPublicStylesheet } from "../../vite.config.js";

// Vite 8's default build target (baseline-widely-available), as Vite passes
// it to the route CSS minifier.
const VITE_DEFAULT_CSS_TARGET = ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"];

test("Vite's default CSS target converts to lightningcss versions", () => {
  assert.deepEqual(lightningcssTargets(VITE_DEFAULT_CSS_TARGET), {
    chrome: 111 << 16,
    edge: 111 << 16,
    firefox: 114 << 16,
    safari: (16 << 16) | (4 << 8),
    ios_saf: (16 << 16) | (4 << 8)
  });
  assert.deepEqual(lightningcssTargets(["safari17", "safari16.4"]), { safari: (16 << 16) | (4 << 8) });
});

test("a CSS target lightningcss cannot take is refused instead of dropped", () => {
  assert.throws(() => lightningcssTargets(["es2020"]), /Unsupported CSS target "es2020"/);
  assert.throws(() => lightningcssTargets(["chrome111", "netscape4"]), /Unsupported CSS target "netscape4"/);
});

test("route CSS and styles.css minify without adding or removing vendor prefixes", () => {
  // Vite spreads css.lightningcss into its route CSS minify call.
  assert.equal(viteConfig.css.lightningcss.exclude & Features.VendorPrefixes, Features.VendorPrefixes);
});

test("the build minifies the copied styles.css in place for the build targets", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "monies-map-styles-"));
  try {
    await writeFile(path.join(outDir, "styles.css"), [
      "/* Kept out of the shipped file. */",
      ".panel {",
      "  color: #ff0000;",
      "  -webkit-appearance: none;",
      "  appearance: none;",
      "}",
      "",
      ".sheet-backdrop {",
      "  backdrop-filter: blur(4px);",
      "}",
      "",
      "@media (max-width: 760px) {",
      "  .panel {",
      "    padding: 0px 12px 0px 12px;",
      "  }",
      "}",
      ""
    ].join("\n"));
    const warnings = [];
    const plugin = minifyPublicStylesheet();
    assert.equal(plugin.apply, "build");
    plugin.configResolved({
      root: outDir,
      build: { outDir: ".", cssTarget: VITE_DEFAULT_CSS_TARGET },
      css: viteConfig.css,
      logger: { warn: (message) => warnings.push(message) }
    });
    await plugin.writeBundle();
    assert.equal(
      await readFile(path.join(outDir, "styles.css"), "utf8"),
      // Prefixes stay as written: no -webkit-backdrop-filter is added for
      // Safari 16.4, and -webkit-appearance is kept.
      ".panel{color:red;-webkit-appearance:none;appearance:none}.sheet-backdrop{backdrop-filter:blur(4px)}@media (width<=760px){.panel{padding:0 12px}}"
    );
    assert.deepEqual(warnings, []);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
