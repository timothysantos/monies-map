import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { transform } from "lightningcss";

const apiOrigin = process.env.VITE_API_ORIGIN ?? "http://127.0.0.1:8787";

// Vite's esbuild-style CSS targets ("chrome111", "safari16.4") as
// lightningcss version numbers, as Vite converts them for route CSS.
const LIGHTNINGCSS_BROWSERS = { chrome: "chrome", edge: "edge", firefox: "firefox", safari: "safari", ios: "ios_saf", opera: "opera" };
export function lightningcssTargets(cssTarget) {
  const targets = {};
  for (const entry of [cssTarget].flat()) {
    const match = /^([a-z]+)(\d+)(?:\.(\d+))?$/.exec(entry);
    const browser = match && LIGHTNINGCSS_BROWSERS[match[1]];
    if (!browser) throw new Error(`Unsupported CSS target "${entry}"`);
    const version = (Number(match[2]) << 16) | (Number(match[3] ?? 0) << 8);
    if (!targets[browser] || version < targets[browser]) targets[browser] = version;
  }
  return targets;
}

// public/ is copied into the build as-is, so the first-screen stylesheet
// would ship unminified. Minify the copy with the minifier, options and
// browser targets Vite uses for route CSS; it keeps its /styles.css URL.
// For those targets lightningcss adds the prefixes Safari 16.4 needs
// (-webkit-backdrop-filter, unprefixed only from Safari 18) and drops ones
// no target needs, exactly as it does for route CSS.
export function minifyPublicStylesheet() {
  let config;
  return {
    name: "monies-map:minify-public-stylesheet",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async writeBundle() {
      const file = path.resolve(config.root, config.build.outDir, "styles.css");
      const { code, warnings } = transform({
        ...config.css.lightningcss,
        filename: "styles.css",
        code: await readFile(file),
        minify: true,
        targets: lightningcssTargets(config.build.cssTarget)
      });
      for (const warning of warnings) config.logger.warn(`[styles.css minify] ${warning.message}`);
      await writeFile(file, code);
    }
  };
}

export default defineConfig({
  plugins: [react(), minifyPublicStylesheet()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": apiOrigin
    }
  },
  build: {
    outDir: "dist",
    manifest: true
  }
});
