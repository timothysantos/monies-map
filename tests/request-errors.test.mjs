import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppShellErrorMessage,
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
