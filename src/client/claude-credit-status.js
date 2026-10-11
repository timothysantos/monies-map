// The Claude credit status (GET /api/ai-assist/provider-status,
// src/server/ai-provider-status-route.ts) on the client. Its one store is
// the query cache under queryKeys.claudeCreditStatus(): Ask and Settings
// read the same entry, and a top-up writes its answer there.
//
// - Read lazily: only once the screen showing it (Ask, Settings) is usable,
//   through fetchQueryWithLease, so a second screen joins the same request
//   or reuses the kept answer for five minutes. Never on the first screen,
//   never blocking: a failure leaves no status and nothing on screen.
// - POST /api/ai-assist/provider-status/topped-up { creditUsd } answers with
//   the fresh status, which replaces the kept one; a read still in flight is
//   cancelled first, so an older answer can never overwrite it.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { hashKey } from "@tanstack/react-query";

import { readClaudeCreditStatus, shouldFetchClaudeCreditStatus } from "./claude-credit-model.js";
import { claudeCreditCopy } from "./copy/claude-credit-copy.js";
import { fetchQueryWithLease } from "./query-leases.js";
import { queryKeys } from "./query-keys.js";

export const CLAUDE_CREDIT_ENDPOINTS = Object.freeze({
  status: "/api/ai-assist/provider-status",
  toppedUp: "/api/ai-assist/provider-status/topped-up"
});

// Throws on any failure, so a failed read is never cached as a status.
export async function requestClaudeCreditStatus({ signal = undefined, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(CLAUDE_CREDIT_ENDPOINTS.status, { cache: "no-store", signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Claude credit status request failed (${response.status}).`);
  }
  const status = readClaudeCreditStatus(await response.json().catch(() => null));
  if (!status) {
    throw new Error("Claude credit status was unreadable.");
  }
  return status;
}

export async function postClaudeToppedUp({ creditUsd, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(CLAUDE_CREDIT_ENDPOINTS.toppedUp, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditUsd })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: typeof body?.error === "string" && body.error ? body.error : claudeCreditCopy.form.failed };
    }
    const status = readClaudeCreditStatus(body);
    return status ? { ok: true, status } : { ok: false, error: claudeCreditCopy.form.failed };
  } catch {
    return { ok: false, error: claudeCreditCopy.form.failed };
  }
}

/**
 * The kept status and when it was read, read lazily once `enabled`.
 * @param {{ queryClient: any, enabled: boolean, fetchImpl?: typeof fetch }} options
 */
export function useClaudeCreditStatus({ queryClient, enabled, fetchImpl = undefined }) {
  const queryKey = useMemo(() => queryKeys.claudeCreditStatus(), []);
  const hash = hashKey(queryKey);
  const subscribe = useCallback((listener) => queryClient.getQueryCache().subscribe((event) => {
    if (event?.query?.queryHash === hash) {
      listener();
    }
  }), [hash, queryClient]);
  const readStatus = useCallback(() => queryClient.getQueryData(queryKey) ?? null, [queryClient, queryKey]);
  const readUpdatedAt = useCallback(() => queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0, [queryClient, queryKey]);
  const status = useSyncExternalStore(subscribe, readStatus, readStatus);
  const updatedAt = useSyncExternalStore(subscribe, readUpdatedAt, readUpdatedAt);

  useEffect(() => {
    if (!shouldFetchClaudeCreditStatus({ enabled, hasData: Boolean(status), updatedAt, now: Date.now() })) {
      return undefined;
    }
    const controller = new AbortController();
    fetchQueryWithLease(queryClient, {
      queryKey,
      bypassCache: Boolean(status),
      signal: controller.signal,
      abortMessage: "Claude credit status request aborted.",
      fetcher: ({ signal }) => requestClaudeCreditStatus({ signal, ...(fetchImpl ? { fetchImpl } : {}) })
    }).catch(() => {
      // Optional: no status means no notice, and the next visit tries again.
    });
    return () => controller.abort();
    // A failed read changes neither value, so it is not retried in a loop.
  }, [enabled, fetchImpl, queryClient, queryKey, status, updatedAt]);

  const markToppedUp = useCallback(async (creditUsd) => {
    const result = await postClaudeToppedUp({ creditUsd, ...(fetchImpl ? { fetchImpl } : {}) });
    if (result.ok) {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, result.status);
    }
    return result;
  }, [fetchImpl, queryClient, queryKey]);

  return { status, checkedAt: status ? updatedAt : 0, markToppedUp };
}
