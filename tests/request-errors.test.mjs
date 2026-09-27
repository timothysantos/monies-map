import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppShellErrorMessage,
  buildRequestFailureMessage,
  isAppShellResourceLimitError
} from "../src/client/request-errors.js";

test("app shell errors identify Cloudflare worker resource limits returned as HTML", () => {
  const message = buildAppShellErrorMessage(
    503,
    "<!doctype html><title>Worker exceeded CPU time limit</title><body>Worker exceeded CPU time limit.</body>"
  );

  assert.match(message, /Cloudflare stopped the Worker/);
  assert.equal(isAppShellResourceLimitError(message), true);
});

test("app shell errors still classify generic HTML failures", () => {
  const message = buildAppShellErrorMessage(
    503,
    "<html><body>Service unavailable</body></html>"
  );

  assert.match(message, /HTML error page instead of JSON/);
  assert.equal(isAppShellResourceLimitError(message), false);
});

// A page's own request failing must not be reported as the app shell.
test("page request errors name the page request, not the app shell", () => {
  assert.equal(
    buildRequestFailureMessage("Page request", 500, "Imports exploded"),
    "Page request failed with status 500. Imports exploded"
  );
  assert.equal(buildRequestFailureMessage("Page request", 502, ""), "Page request failed with status 502.");
  const limit = buildRequestFailureMessage("Page request", 503, "<!doctype html><title>Worker exceeded CPU time limit</title>");
  assert.match(limit, /^Page request failed with status 503\. Cloudflare stopped the Worker/);
  assert.doesNotMatch(limit, /App shell/);
  // The app shell keeps its own label.
  assert.equal(buildAppShellErrorMessage(500, "Shell exploded"), "App shell request failed with status 500. Shell exploded");
});
