// The "Check my books" data owner (src/client/check-data-owner.js) and its
// reader (check-api.js): a check runs only when asked, a superseded read never
// overwrites a newer report, "This is fine" moves the page at once and is put
// back when the server refuses, and a read that was running when a write landed
// cannot bring back what was just hidden.
import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, isCancelledError } from "@tanstack/react-query";

import { buildCheckupPath, readCheckupReport } from "../src/client/check-api.js";
import { createCheckOwner } from "../src/client/check-data-owner.js";

function body(overrides = {}) {
  return {
    ok: true,
    generatedAt: "2026-10-27T07:42:00.000Z",
    tierCounts: { high: 1, check: 0, note: 0 },
    kindCounts: { odd_entry: { high: 1, check: 0, note: 0 } },
    dismissedCount: 0,
    findings: [{
      id: "odd_entry:a", kind: "odd_entry", tier: "high", title: "An entry has no amount", summary: "It is $0.00.", evidence: [{ role: "entry", label: "Test" }],
      amountMinor: null, currency: "SGD", occurredOn: "2026-10-01", personIds: [], fix: { label: "Open the entry", path: "/entries?x=1" }, fixNote: null, evidenceKey: "abc", dismissed: false
    }],
    moreByKind: {},
    incompleteKinds: [],
    unavailableKinds: [],
    ...overrides
  };
}

// A required read that just calls the fetcher, like fetchQueryWithLease with no cache.
const fetchRequiredQuery = async ({ fetcher, signal }) => fetcher({ signal });

function ownerWith(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    const answer = await handler(url, init, calls);
    return { ok: answer.ok ?? true, status: answer.status ?? 200, json: async () => answer.body ?? {} };
  };
  return { owner: createCheckOwner({ fetchRequiredQuery, fetchImpl }), calls };
}

test("the page's address carries the person's view and the hidden list only when asked", () => {
  assert.equal(buildCheckupPath({ viewId: "household", includeHidden: false }), "/api/ledger-checkup");
  assert.equal(buildCheckupPath({ viewId: "person-tim", includeHidden: false }), "/api/ledger-checkup?view=person-tim");
  assert.equal(buildCheckupPath({ viewId: "person-tim", includeHidden: true }), "/api/ledger-checkup?view=person-tim&dismissed=1");
});

test("the reader keeps a good report and drops what it cannot read", () => {
  const report = readCheckupReport(body({ findings: [body().findings[0], { id: 5 }, { ...body().findings[0], id: "odd_entry:b", tier: "urgent" }, { ...body().findings[0], id: "odd_entry:c", fix: { label: "Open", path: "https://elsewhere.example" } }] }));
  assert.deepEqual(report.findings.map((finding) => finding.id), ["odd_entry:a", "odd_entry:c"]);
  assert.equal(report.findings[0].fix.path, "/entries?x=1");
  // A fix that is not an app path is never offered.
  assert.equal(report.findings[1].fix, null);
  assert.deepEqual(report.tierCounts, { high: 1, check: 0, note: 0 });
});

test("an answer that is not a report reads as null", () => {
  assert.equal(readCheckupReport(null), null);
  assert.equal(readCheckupReport({ ok: false }), null);
  assert.equal(readCheckupReport({ ok: true, findings: "no", tierCounts: {} }), null);
});

test("opening runs one check for the person's view and keeps its report", async () => {
  const { owner, calls } = ownerWith(() => ({ body: body() }));
  assert.equal(owner.getSnapshot().status, "idle");
  assert.equal(await owner.run({ viewId: "person-tim" }), true);
  const state = owner.getSnapshot();
  assert.equal(state.status, "ready");
  assert.equal(state.viewId, "person-tim");
  assert.equal(state.report.findings.length, 1);
  assert.deepEqual(calls.map((call) => call.url), ["/api/ledger-checkup?view=person-tim"]);
});

test("nothing runs until a check is asked for", () => {
  const { calls } = ownerWith(() => ({ body: body() }));
  assert.deepEqual(calls, []);
});

test("another person's view clears the report while it loads; 'Check again' keeps it", async () => {
  let release;
  const { owner } = ownerWith(async (url, init, calls) => {
    if (calls.length > 1) await new Promise((resolve) => { release = resolve; });
    return { body: body() };
  });
  await owner.run({ viewId: "person-tim" });
  const again = owner.run({ viewId: "person-tim" });
  assert.equal(owner.getSnapshot().status, "loading");
  assert.ok(owner.getSnapshot().report, "Check again keeps the report on screen");
  release();
  await again;

  const other = owner.run({ viewId: "person-joyce" });
  assert.equal(owner.getSnapshot().report, null, "another view never shows this view's problems");
  release();
  await other;
  assert.equal(owner.getSnapshot().viewId, "person-joyce");
});

test("a read that finishes after a newer check never overwrites it", async () => {
  const releases = [];
  const { owner } = ownerWith((url, init, calls) => new Promise((resolve) => {
    const index = calls.length;
    releases.push(() => resolve({ body: body({ generatedAt: `2026-10-27T0${index}:00:00.000Z` }) }));
  }));
  const first = owner.run({ viewId: "household" });
  const second = owner.run({ viewId: "household" });
  releases[1]();
  assert.equal(await second, true);
  releases[0]();
  assert.equal(await first, false);
  assert.equal(owner.getSnapshot().report.generatedAt, "2026-10-27T02:00:00.000Z");
});

test("a failed first check leaves no report and says it failed; a failed 'Check again' keeps the old one", async () => {
  let fail = true;
  const { owner } = ownerWith(() => (fail ? { ok: false, status: 500 } : { body: body() }));
  assert.equal(await owner.run({ viewId: "household" }), false);
  assert.equal(owner.getSnapshot().failed, true);
  assert.equal(owner.getSnapshot().report, null);
  fail = false;
  await owner.run({ viewId: "household" });
  assert.equal(owner.getSnapshot().failed, false);
  fail = true;
  await owner.run({ viewId: "household" });
  assert.equal(owner.getSnapshot().failed, true);
  assert.equal(owner.getSnapshot().report.findings.length, 1);
});

test("an answer the page cannot read is a failed check, not an empty one", async () => {
  const { owner } = ownerWith(() => ({ body: { ok: true, nothing: "here" } }));
  assert.equal(await owner.run({ viewId: "household" }), false);
  assert.equal(owner.getSnapshot().failed, true);
});

test("'This is fine' moves the counts at once, posts the report's own key and can be undone", async () => {
  const handler = (url) => (url.includes("/dismiss") || url.includes("undo-dismiss") ? { body: { ok: true } } : { body: body() });
  const { owner, calls } = ownerWith(handler);
  await owner.run({ viewId: "household" });
  const finding = owner.getSnapshot().report.findings[0];
  const hidden = owner.hide(finding);
  // Before the server answers the page already shows it hidden.
  assert.deepEqual(owner.getSnapshot().report.tierCounts, { high: 0, check: 0, note: 0 });
  assert.equal(owner.getSnapshot().report.dismissedCount, 1);
  assert.deepEqual(owner.getSnapshot().lastHidden, { id: "odd_entry:a", title: "An entry has no amount" });
  assert.equal(await hidden, true);
  assert.deepEqual(calls.at(-1), { url: "/api/ledger-checkup/dismiss", method: "POST", body: { id: "odd_entry:a", evidenceKey: "abc" } });

  assert.equal(await owner.show(finding), true);
  assert.deepEqual(owner.getSnapshot().report.tierCounts, { high: 1, check: 0, note: 0 });
  assert.equal(owner.getSnapshot().lastHidden, null);
  assert.deepEqual(calls.at(-1), { url: "/api/ledger-checkup/undo-dismiss", method: "POST", body: { id: "odd_entry:a" } });
});

test("when the server refuses to hide, the page puts it back and says so", async () => {
  const { owner } = ownerWith((url) => (url.includes("/dismiss") ? { ok: false, status: 500 } : { body: body() }));
  await owner.run({ viewId: "household" });
  const finding = owner.getSnapshot().report.findings[0];
  assert.equal(await owner.hide(finding), false);
  const state = owner.getSnapshot();
  assert.deepEqual(state.report.tierCounts, { high: 1, check: 0, note: 0 });
  assert.equal(state.report.dismissedCount, 0);
  assert.equal(state.report.findings[0].dismissed, false);
  assert.equal(state.writeError, "hide");
  assert.equal(state.lastHidden, null);
  owner.clearWriteError();
  assert.equal(owner.getSnapshot().writeError, "");
});

test("when the server refuses to show it again, it stays hidden and says so", async () => {
  const { owner } = ownerWith((url) => (url.includes("undo-dismiss") ? { ok: false, status: 500 } : url.includes("/dismiss") ? { body: { ok: true } } : { body: body() }));
  await owner.run({ viewId: "household" });
  const finding = owner.getSnapshot().report.findings[0];
  await owner.hide(finding);
  assert.equal(await owner.show(finding), false);
  assert.equal(owner.getSnapshot().report.dismissedCount, 1);
  assert.equal(owner.getSnapshot().writeError, "show");
});

test("a read already running when a write lands is read again, so it cannot bring back what was hidden", async () => {
  let reads = 0;
  let releaseFirst;
  const { owner } = ownerWith((url) => {
    if (url.includes("/dismiss")) return { body: { ok: true } };
    reads += 1;
    if (reads === 1) return { body: body() };
    if (reads === 2) {
      // The slow read: it started before the write and carries the old answer.
      return new Promise((resolve) => { releaseFirst = () => resolve({ body: body() }); });
    }
    return { body: body({ tierCounts: { high: 0, check: 0, note: 0 }, dismissedCount: 1, findings: [{ ...body().findings[0], dismissed: true }] }) };
  });
  await owner.run({ viewId: "household" });
  const finding = owner.getSnapshot().report.findings[0];
  const refresh = owner.refresh();
  await owner.hide(finding);
  releaseFirst();
  await refresh;
  assert.equal(reads, 3, "the stale read was read again");
  assert.deepEqual(owner.getSnapshot().report.tierCounts, { high: 0, check: 0, note: 0 });
  assert.equal(owner.getSnapshot().report.dismissedCount, 1);
});

test("the refresh after 'This is fine' keeps the row just hidden in its place, so its Undo stays", async () => {
  const two = body({
    tierCounts: { high: 2, check: 0, note: 0 },
    kindCounts: { odd_entry: { high: 2, check: 0, note: 0 } },
    findings: [body().findings[0], { ...body().findings[0], id: "odd_entry:b", evidenceKey: "def" }]
  });
  const afterHide = body({
    tierCounts: { high: 1, check: 0, note: 0 },
    kindCounts: { odd_entry: { high: 1, check: 0, note: 0 } },
    dismissedCount: 1,
    findings: [{ ...body().findings[0], id: "odd_entry:b", evidenceKey: "def" }]
  });
  let hiddenYet = false;
  const { owner } = ownerWith((url) => {
    if (url.includes("/dismiss")) {
      hiddenYet = true;
      return { body: { ok: true } };
    }
    return { body: hiddenYet ? afterHide : two };
  });
  await owner.run({ viewId: "household" });
  await owner.hide(owner.getSnapshot().report.findings[0]);
  await owner.refresh();
  const { report, lastHidden } = owner.getSnapshot();
  assert.deepEqual(report.findings.map((item) => [item.id, item.dismissed]), [["odd_entry:a", true], ["odd_entry:b", false]]);
  assert.deepEqual(report.tierCounts, { high: 1, check: 0, note: 0 });
  assert.equal(lastHidden.id, "odd_entry:a");
  // Undo works on the kept row.
  assert.equal(await owner.show(report.findings[0]), true);
  assert.deepEqual(owner.getSnapshot().report.tierCounts, { high: 2, check: 0, note: 0 });
});

test("a read the query cache cancelled is superseded, not a failed check", async () => {
  // A real cancellation from TanStack Query, so the owner's own test of it cannot drift.
  const queryClient = new QueryClient();
  const pending = queryClient.fetchQuery({ queryKey: ["x"], queryFn: () => new Promise(() => {}) });
  await queryClient.cancelQueries({ queryKey: ["x"] });
  const cancelled = await pending.catch((error) => error);
  assert.ok(isCancelledError(cancelled));
  const owner = createCheckOwner({ fetchRequiredQuery: async () => { throw cancelled; } });
  assert.equal(await owner.run({ viewId: "household" }), false);
  assert.equal(owner.getSnapshot().failed, false);
  const aborted = createCheckOwner({ fetchRequiredQuery: async () => { throw new DOMException("stop", "AbortError"); } });
  assert.equal(await aborted.run({ viewId: "household" }), false);
  assert.equal(aborted.getSnapshot().failed, false);
});

test("a quiet refresh throws when it fails so the retryable notice can show, and does nothing before a first check", async () => {
  let fail = false;
  const { owner } = ownerWith(() => (fail ? { ok: false, status: 500 } : { body: body() }));
  assert.equal(await owner.refresh(), false);
  await owner.run({ viewId: "household" });
  fail = true;
  await assert.rejects(owner.refresh(), /failed \(500\)/);
  // The page keeps what it has.
  assert.equal(owner.getSnapshot().report.findings.length, 1);
  assert.equal(owner.getSnapshot().failed, false);
});

test("opening the hidden list asks for it and keeps asking for it", async () => {
  const { owner, calls } = ownerWith(() => ({ body: body() }));
  await owner.run({ viewId: "household" });
  await owner.run({ viewId: "household", includeHidden: true });
  await owner.refresh();
  assert.deepEqual(calls.map((call) => call.url), ["/api/ledger-checkup", "/api/ledger-checkup?dismissed=1", "/api/ledger-checkup?dismissed=1"]);
});
