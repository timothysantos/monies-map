// A phone sheet's stylesheet that fails to download must not take the whole
// app down. Vite loads a lazy chunk's CSS with a <link> and rejects the import
// with "Unable to preload CSS for <url>" when the link errors; unhandled, that
// reaches the app's last-resort boundary ("The app hit a problem and could not
// be shown", seen on an iPhone opening View and scope on 2026-10-15).
import assert from "node:assert/strict";
import test from "node:test";

import { buildCrashReport, createCrashReporter } from "../src/client/client-crash-report.js";
import { installPreloadRecovery, isCodeLoadError, isStylesheetPreloadError } from "../src/client/preload-recovery.js";

function fakeWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    fire(type, payload) {
      const event = { type, payload, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      listeners.get(type)?.(event);
      return event;
    }
  };
}

test("only a stylesheet that failed to download counts as a preload error to ride out", () => {
  assert.equal(isStylesheetPreloadError(new Error("Unable to preload CSS for https://example.test/assets/sheet-swipe-B4grPoSJ.css")), true);
  assert.equal(isStylesheetPreloadError("Unable to preload CSS for /assets/a.css"), true);
  // A script that failed to load needs a fresh copy of the app: not ridden out.
  assert.equal(isStylesheetPreloadError(new TypeError("Importing a module script failed.")), false);
  assert.equal(isStylesheetPreloadError(new Error("Failed to fetch dynamically imported module: /assets/x.js")), false);
  assert.equal(isStylesheetPreloadError(null), false);
  assert.equal(isStylesheetPreloadError(undefined), false);
});

test("a failed stylesheet is reported and the import carries on instead of throwing", () => {
  const win = fakeWindow();
  const reports = [];
  const stop = installPreloadRecovery(win, (report) => reports.push(report));
  const event = win.fire("vite:preloadError", new Error("Unable to preload CSS for /assets/mobile-context-sheet-BIfo5-Ub.css"));
  assert.equal(event.defaultPrevented, true, "preventDefault lets Vite continue with the import");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].kind, "stylesheet-preload");
  assert.match(reports[0].error.message, /mobile-context-sheet/);
  stop();
  assert.equal(win.listeners.size, 0);
});

test("a failed script is left to the app boundary and is not reported as a ridden-out stylesheet", () => {
  const win = fakeWindow();
  const reports = [];
  installPreloadRecovery(win, (report) => reports.push(report));
  const event = win.fire("vite:preloadError", new TypeError("Importing a module script failed."));
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(reports, []);
});

test("a crash report keeps the message, a trimmed stack and only the path of the page", () => {
  const error = new Error("x".repeat(5000));
  error.stack = `Error: boom\n${"    at frame (file.js:1:1)\n".repeat(200)}`;
  const report = buildCrashReport({
    kind: "render",
    level: "app",
    error,
    componentStack: "\n    at Foo\n    at Bar",
    location: { pathname: "/summary", search: "?view=person-tim&month=2026-10" },
    userAgent: "Mozilla/5.0 (iPhone)"
  });
  assert.equal(report.source, "client_crash");
  assert.equal(report.action, "App crashed while rendering");
  assert.ok(report.errorMessage.length <= 1500);
  assert.equal(JSON.parse(report.requestContextJson).path, "/summary");
  assert.doesNotMatch(report.requestContextJson, /person-tim|month=/);
  assert.ok(JSON.parse(report.requestContextJson).stack.length <= 1500);
  assert.match(JSON.parse(report.requestContextJson).componentStack, /at Foo/);
  assert.equal(report.route, "/summary");
});

test("the reporter posts once per distinct crash and never throws when the post fails", async () => {
  const posted = [];
  const reporter = createCrashReporter({
    post: async (body) => { posted.push(body); },
    location: { pathname: "/summary", search: "" },
    userAgent: "ua"
  });
  const error = new Error("same failure");
  reporter({ kind: "render", level: "screen", error, componentStack: "" });
  reporter({ kind: "render", level: "screen", error, componentStack: "" });
  reporter({ kind: "render", level: "screen", error: new Error("another"), componentStack: "" });
  assert.equal(posted.length, 2);

  const failing = createCrashReporter({ post: async () => { throw new Error("offline"); }, location: { pathname: "/", search: "" }, userAgent: "" });
  assert.doesNotThrow(() => failing({ kind: "render", level: "app", error: new Error("e"), componentStack: "" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("every way a lazy chunk fails to arrive asks for a reload, a render bug does not", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: https://x.test/assets/a.js",
    "error loading dynamically imported module",
    "TypeError: Importing a module script failed.",
    "'text/html' is not a valid JavaScript MIME type.",
    "Unable to preload CSS for /assets/a.css",
    "Loading chunk 12 failed."
  ]) {
    assert.equal(isCodeLoadError(new Error(message)), true, message);
  }
  assert.equal(isCodeLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isCodeLoadError(undefined), false);
});
