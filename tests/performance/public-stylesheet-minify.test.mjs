import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

// Runs the plugin on a small stylesheet in a temporary output directory,
// with the CSS options Vite would pass to its own route CSS minifier.
async function minifyWithPlugin(css) {
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
      css,
      logger: { warn: (message) => warnings.push(message) }
    });
    await plugin.writeBundle();
    assert.deepEqual(warnings, []);
    return await readFile(path.join(outDir, "styles.css"), "utf8");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test("the build minifies the copied styles.css in place with the prefixes the targets need", async () => {
  // With the app's own CSS options (shared with route CSS). Safari 16.4
  // needs -webkit-backdrop-filter; no target needs
  // -webkit-appearance (Safari takes appearance from 15.4).
  assert.equal(
    await minifyWithPlugin(viteConfig.css ?? {}),
    ".panel{color:red;appearance:none}.sheet-backdrop{-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}@media (width<=760px){.panel{padding:0 12px}}"
  );
});

test("styles.css takes the lightningcss options route CSS gets", async () => {
  // Vite spreads css.lightningcss into its route CSS minify call; the
  // plugin does the same, so an option set there reaches both.
  assert.equal(
    await minifyWithPlugin({ lightningcss: { exclude: Features.VendorPrefixes } }),
    ".panel{color:red;-webkit-appearance:none;appearance:none}.sheet-backdrop{backdrop-filter:blur(4px)}@media (width<=760px){.panel{padding:0 12px}}"
  );
});

test("the colour preset sheets are minified in place as well", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "monies-map-palettes-"));
  try {
    await writeFile(path.join(outDir, "styles.css"), ".panel {\n  color: red;\n}\n");
    await mkdir(path.join(outDir, "palettes"));
    await writeFile(path.join(outDir, "palettes", "modern.css"), [
      "/* A preset. */",
      ':root[data-palette="modern"] {',
      "  --accent: #3730a3;",
      "  --paper-rgb: 255 255 255;",
      "}",
      ""
    ].join("\n"));
    const plugin = minifyPublicStylesheet();
    plugin.configResolved({
      root: outDir,
      build: { outDir: ".", cssTarget: VITE_DEFAULT_CSS_TARGET },
      css: viteConfig.css ?? {},
      logger: { warn: (message) => assert.fail(message) }
    });
    await plugin.writeBundle();
    assert.equal(await readFile(path.join(outDir, "palettes", "modern.css"), "utf8"), ":root[data-palette=modern]{--accent:#3730a3;--paper-rgb:255 255 255}");
    assert.equal(await readFile(path.join(outDir, "styles.css"), "utf8"), ".panel{color:red}");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
