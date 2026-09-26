import assert from "node:assert/strict";
import test from "node:test";

import {
  createLinkedEntryRequest,
  getPendingLinkedEntryId,
  markLinkedEntryRequestHandled,
  syncLinkedEntryRequest
} from "../src/client/linked-entry-request.js";

test("a deep link is pending until the page opens that entry", () => {
  const request = createLinkedEntryRequest("entry-1");
  assert.deepEqual(request, { entryId: "entry-1", handled: false });
  assert.equal(getPendingLinkedEntryId(request), "entry-1");

  const handled = markLinkedEntryRequestHandled(request, "entry-1");
  assert.deepEqual(handled, { entryId: "entry-1", handled: true });
  assert.equal(getPendingLinkedEntryId(handled), "");
});

test("a handled deep link stays handled while the same param is still in the URL", () => {
  const handled = markLinkedEntryRequestHandled(createLinkedEntryRequest("entry-1"));
  // Saving closes the editor before the param clear lands; the rerender in
  // between must not turn the old link back into a request to reopen.
  const synced = syncLinkedEntryRequest(handled, "entry-1");
  assert.equal(synced, handled);
  assert.equal(getPendingLinkedEntryId(synced), "");
});

test("the same entry linked again after the param was cleared is a new request", () => {
  const handled = markLinkedEntryRequestHandled(createLinkedEntryRequest("entry-1"));
  const cleared = syncLinkedEntryRequest(handled, "");
  assert.deepEqual(cleared, { entryId: "", handled: false });
  assert.equal(getPendingLinkedEntryId(cleared), "");

  const relinked = syncLinkedEntryRequest(cleared, "entry-1");
  assert.deepEqual(relinked, { entryId: "entry-1", handled: false });
  assert.equal(getPendingLinkedEntryId(relinked), "entry-1");
});

test("a link to another entry replaces a handled one", () => {
  const handled = markLinkedEntryRequestHandled(createLinkedEntryRequest("entry-1"));
  const next = syncLinkedEntryRequest(handled, "entry-2");
  assert.deepEqual(next, { entryId: "entry-2", handled: false });
  assert.equal(getPendingLinkedEntryId(next), "entry-2");
});

test("marking an older link handled does not swallow a newer one", () => {
  const newer = createLinkedEntryRequest("entry-2");
  const result = markLinkedEntryRequestHandled(newer, "entry-1");
  assert.equal(result, newer);
  assert.equal(getPendingLinkedEntryId(result), "entry-2");
});

test("no param means nothing to open, and marking it handled changes nothing", () => {
  const empty = createLinkedEntryRequest();
  assert.equal(getPendingLinkedEntryId(empty), "");
  assert.equal(markLinkedEntryRequestHandled(empty), empty);
  const handled = markLinkedEntryRequestHandled(createLinkedEntryRequest("entry-1"));
  assert.equal(markLinkedEntryRequestHandled(handled), handled);
});
