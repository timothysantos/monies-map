import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { createRequiredLeases, fetchQueryWithLease, startSpeculativeQuery } from "../src/client/query-leases.js";
import { queryKeys } from "../src/client/query-keys.js";

// Real QueryClient, deferred transport, manual deadline clock.

function createTransport() {
  const calls = [];
  const fetcher = (name) => ({ signal }) => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const call = { name, signal, resolve, reject };
    calls.push(call);
    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    return promise;
  };
  return { calls, fetcher };
}

function createManualClock() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimeout(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fireAll() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    pending: () => timers.size
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const entriesKey = (view, month = "2026-05") => queryKeys.entriesPage(new URLSearchParams({ view, month }));
const DTO = { viewId: "person-tim", monthPage: { month: "2026-05", entries: [{ id: "e1", amountMinor: 1234 }] } };

function setup() {
  return { queryClient: new QueryClient(), leases: createRequiredLeases(), clock: createManualClock(), ...createTransport() };
}

test("W10: a required consumer joining a warming key promotes it: one request, not aborted, exact DTO", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  assert.equal(warm.started, true);
  await flush();
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  assert.equal(warm.isPromoted(), true);
  assert.equal(clock.pending(), 0, "promotion clears the speculative deadline");
  clock.fireAll();
  assert.equal(calls.length, 1, "the required read joined the in-flight request");
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve(DTO);
  assert.deepEqual(await required, DTO);
  assert.deepEqual(queryClient.getQueryData(key), DTO);
  assert.deepEqual(await warm.promise, { status: "fulfilled", promoted: true });
  assert.equal(leases.isRequired(key), false, "lease released after the read");
});

test("W11: an exclusively speculative request is aborted at its deadline without errors", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  clock.fireAll();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(await warm.promise, { status: "cancelled", promoted: false });
  assert.equal(queryClient.getQueryData(key), undefined);
  assert.equal(queryClient.getQueryState(key)?.status === "error", false, "no error state for the route to show");
});

test("W12: a deadline abort that lands just before the route needs the key still lets the route load", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  clock.fireAll();
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  assert.equal(calls.length, 2, "the required read starts its own request");
  calls[1].resolve(DTO);
  assert.deepEqual(await required, DTO);
});

test("a required read joined to a request that is cancelled underneath it recovers once", async () => {
  const { queryClient, leases, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  void queryClient.fetchQuery({ queryKey: key, queryFn: ({ signal }) => fetcher("other")({ signal }), retry: false }).catch(() => {});
  await flush();
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  // A cache clear (clear*Cache) cancels the shared request.
  await queryClient.cancelQueries({ queryKey: key, exact: true });
  await flush();
  assert.equal(calls.length, 2, "recovery fetch after the cancellation");
  calls[1].resolve(DTO);
  assert.deepEqual(await required, DTO);
});

test("a second cancellation during recovery propagates, and the lease is still released", async () => {
  const { queryClient, leases, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  void queryClient.fetchQuery({ queryKey: key, queryFn: ({ signal }) => fetcher("other")({ signal }), retry: false }).catch(() => {});
  await flush();
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  await queryClient.cancelQueries({ queryKey: key, exact: true });
  await flush();
  await queryClient.cancelQueries({ queryKey: key, exact: true });
  await assert.rejects(required, (error) => error?.constructor?.name === "CancelledError" || error?.revert !== undefined);
  assert.equal(leases.isRequired(key), false);
  assert.equal(calls.length, 2);
});

test("W13: a required read of another key starts immediately and cancelling the warm key cannot abort it", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const warmKey = entriesKey("person-tim");
  const requiredKey = entriesKey("person-tim", "2026-04");
  const warm = startSpeculativeQuery(queryClient, { queryKey: warmKey, fetcher: fetcher("warm"), leases, clock });
  const required = fetchQueryWithLease(queryClient, { queryKey: requiredKey, fetcher: fetcher("required"), leases });
  await flush();
  assert.deepEqual(calls.map((call) => call.name), ["warm", "required"]);
  assert.equal(warm.cancel(), true);
  await flush();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  calls[1].resolve(DTO);
  assert.deepEqual(await required, DTO);
});

test("W14: invalidated data is not fresh, so a speculative read really fetches", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  queryClient.setQueryData(key, { stale: true });
  await queryClient.invalidateQueries({ queryKey: key, refetchType: "none" });
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  assert.equal(warm.started, true);
  assert.equal(calls.length, 1);
  calls[0].resolve(DTO);
  assert.deepEqual(await warm.promise, { status: "fulfilled", promoted: false });
  assert.deepEqual(queryClient.getQueryData(key), DTO);
});

test("W18: warming Tim's key never fills or cancels another person's key", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const tim = entriesKey("person-tim");
  const joyce = entriesKey("person-joyce");
  startSpeculativeQuery(queryClient, { queryKey: tim, fetcher: fetcher("tim"), leases, clock });
  const joyceRead = fetchQueryWithLease(queryClient, { queryKey: joyce, fetcher: fetcher("joyce"), leases });
  await flush();
  clock.fireAll();
  await flush();
  assert.equal(calls[0].signal.aborted, true, "Tim's warmup expires");
  assert.equal(calls[1].signal.aborted, false);
  calls[1].resolve({ viewId: "person-joyce" });
  assert.deepEqual(await joyceRead, { viewId: "person-joyce" });
  assert.equal(queryClient.getQueryData(tim), undefined);
});

test("speculative reads never start on a key that is already fetching or required", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  assert.deepEqual([warm.started, warm.reason], [false, "required"]);
  const release = leases.acquire(entriesKey("person-joyce"));
  const other = startSpeculativeQuery(queryClient, { queryKey: entriesKey("person-joyce"), fetcher: fetcher("warm"), leases, clock });
  assert.equal(other.reason, "required");
  release();
  calls[0].resolve(DTO);
  await required;
  // Already fetching without a lease (for example an unmigrated reader).
  const busyKey = entriesKey("person-tim", "2026-01");
  void queryClient.fetchQuery({ queryKey: busyKey, queryFn: fetcher("plain"), retry: false });
  await flush();
  assert.equal(startSpeculativeQuery(queryClient, { queryKey: busyKey, fetcher: fetcher("warm"), leases, clock }).reason, "already-fetching");
});

test("an observed speculative query is not cancelled", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  const { QueryObserver } = await import("@tanstack/react-query");
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: fetcher("observer"), enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  assert.equal(warm.cancel(), false);
  assert.equal(calls[0].signal.aborted, false);
  // TanStack itself cancels a signal-consuming fetch when its last observer
  // leaves; required readers rely on fetchQueryWithLease's recovery for that.
  unsubscribe();
  await flush();
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(await warm.promise, { status: "cancelled", promoted: false });
  assert.equal(warm.cancel(), false);
});

test("a required read survives TanStack cancelling a shared fetch when its last observer leaves", async () => {
  const { queryClient, leases, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const { QueryObserver } = await import("@tanstack/react-query");
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: ({ signal }) => fetcher("observer")({ signal }), retry: false });
  const unsubscribe = observer.subscribe(() => {});
  await flush();
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  unsubscribe();
  await flush();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls.length, 2, "recovered with its own request");
  calls[1].resolve(DTO);
  assert.deepEqual(await required, DTO);
});

test("cancel after the attempt settled does nothing", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  calls[0].resolve(DTO);
  await warm.promise;
  assert.equal(warm.cancel(), false);
  assert.equal(clock.pending(), 0);
  assert.deepEqual(queryClient.getQueryData(key), DTO);
});

test("a failed speculative read resolves as failed without throwing or retrying", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  calls[0].reject(new Error("500"));
  assert.deepEqual(await warm.promise, { status: "failed", promoted: false });
  assert.equal(calls.length, 1);
});

test("leases are released when a required read fails", async () => {
  const { queryClient, leases, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  assert.equal(leases.isRequired(key), true);
  calls[0].reject(new Error("Entries page failed."));
  await assert.rejects(required, /Entries page failed/);
  assert.equal(leases.isRequired(key), false);
});

test("a caller abort suppresses only that caller; the shared request keeps running for the other", async () => {
  const { queryClient, leases, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const controller = new AbortController();
  const first = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("first"), leases, signal: controller.signal, abortMessage: "Entries page request aborted." });
  const second = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("second"), leases });
  await flush();
  controller.abort();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false, "caller abort never reaches the network");
  calls[0].resolve(DTO);
  await assert.rejects(first, (error) => error.name === "AbortError" && error.message === "Entries page request aborted.");
  assert.deepEqual(await second, DTO);
  assert.equal(leases.isRequired(key), false);
});

test("cached data is returned without a request; bypassCache always fetches", async () => {
  const { queryClient, leases, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  queryClient.setQueryData(key, DTO);
  assert.deepEqual(await fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("cached"), leases }), DTO);
  assert.equal(calls.length, 0);
  const refreshed = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("refresh"), leases, bypassCache: true });
  await flush();
  calls[0].resolve({ ...DTO, refreshed: true });
  assert.equal((await refreshed).refreshed, true);
});

test("lease release is idempotent and counts every consumer", () => {
  const leases = createRequiredLeases();
  const key = entriesKey("person-tim");
  const a = leases.acquire(key);
  const b = leases.acquire(key);
  a();
  a();
  assert.equal(leases.isRequired(key), true, "a double release must not drop the other lease");
  b();
  assert.equal(leases.isRequired(key), false);
});

test("an explicit cancel after promotion (hide, busy or a new generation) leaves the shared request running", async () => {
  const { queryClient, leases, clock, calls, fetcher } = setup();
  const key = entriesKey("person-tim");
  const warm = startSpeculativeQuery(queryClient, { queryKey: key, fetcher: fetcher("warm"), leases, clock });
  await flush();
  const required = fetchQueryWithLease(queryClient, { queryKey: key, fetcher: fetcher("required"), leases });
  await flush();
  assert.equal(warm.cancel(), false);
  await flush();
  assert.equal(calls[0].signal.aborted, false);
  calls[0].resolve(DTO);
  assert.deepEqual(await required, DTO);
  assert.equal(calls.length, 1);
});
