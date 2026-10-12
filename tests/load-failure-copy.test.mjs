// U9 (UI audit): a failed page load says, in plain words, what happened to the
// person's data. The technical line ("Page load failed: Page request failed
// with status 503") stays out of sight; it is kept on the panel for
// inspection only.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const { describeLoadFailure } = await import("../src/client/request-errors.js");
const { ErrorPanel } = await import("../src/client/ui-states.jsx");
const { ShellErrorScreen } = await import("../src/client/app-shell-status.jsx");
const h = React.createElement;

const UNREACHABLE = "We couldn't reach your data just now.";

test("a server or network failure becomes one plain line with no status code", () => {
  const technical = [
    "Page load failed: Page request failed with status 503",
    "Page request failed with status 500. Month exploded",
    "App shell request failed with status 502.",
    "Page request failed with status 503. Cloudflare stopped the Worker because it exceeded CPU or resource limits before returning app JSON.",
    "Page request failed with status 503. The server returned an HTML error page instead of JSON.",
    "Page load failed: Failed to fetch",
    "Page load failed: Load failed",
    "Reference data retry failed: NetworkError when attempting to fetch resource."
  ];
  for (const line of technical) {
    const plain = describeLoadFailure(line);
    assert.equal(plain, UNREACHABLE, line);
    assert.doesNotMatch(plain, /\d{3}|status|request|Cloudflare|Worker|fetch/i, line);
  }
});

test("a failure that is not about reaching the server, or no failure at all, adds no line", () => {
  assert.equal(describeLoadFailure(""), "");
  assert.equal(describeLoadFailure(null), "");
  assert.equal(describeLoadFailure(undefined), "");
  assert.equal(describeLoadFailure("Unexpected token < in JSON at position 0"), "");
  assert.equal(describeLoadFailure("Page request failed with status 404. Month not found"), "");
});

test("the error panel shows the plain line and keeps the technical reason off the screen", () => {
  const technical = "Page load failed: Page request failed with status 503";
  const html = renderToStaticMarkup(h(ErrorPanel, {
    title: "The Month page could not load.",
    detail: "Your saved data is not affected. Try again in a moment.",
    technical,
    actions: [{ label: "Try loading again", onClick() {}, primary: true }]
  }));
  assert.match(html, /<p class="app-loading-issue-inline">We couldn&#x27;t reach your data just now\.<\/p>/);
  const visible = html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'");
  assert.doesNotMatch(visible, /status 503|Page request|Page load failed/);
  assert.match(html, /data-technical-detail="Page load failed: Page request failed with status 503"/);
});

test("the error panel adds no line when there is nothing to say in plain words", () => {
  const html = renderToStaticMarkup(h(ErrorPanel, {
    title: "The Month page could not load.",
    detail: "Your saved data is not affected. Try again in a moment.",
    technical: "Unexpected token < in JSON at position 0",
    actions: []
  }));
  assert.doesNotMatch(html, /app-loading-issue-inline/);
});

test("the whole-shell error screen words a 503 the same way", () => {
  const html = renderToStaticMarkup(h(ShellErrorScreen, {
    environment: "production",
    title: "The Month page could not load.",
    message: "Page request failed with status 503",
    issue: "Page load failed: Page request failed with status 503",
    retryLabel: "Try loading again",
    onRetry() {}
  }));
  const visible = html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'");
  assert.match(visible, /We couldn't reach your data just now\./);
  assert.match(visible, /Your saved data is not affected\. Try again in a moment\./);
  assert.doesNotMatch(visible, /status 503|Page request failed|Page load failed/);
});
