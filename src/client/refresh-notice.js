// Owner of the background refresh notice. A save is authoritative once the
// server accepts it; the refresh that follows only brings the rest of the
// screen up to date. When that refresh fails, the screen keeps what it has
// and a non-blocking notice offers a retry instead of an error screen.
//
// A refresh belongs to the route that started it. Failures that were aborted,
// cancelled by a cache clear, or finished after the person moved to another
// route are superseded and stay silent; moving route also clears the notice,
// because the new route loads its own data.

import { isCancelledError } from "@tanstack/react-query";

export function isQuietRefreshFailure(error) {
  return (error instanceof DOMException && error.name === "AbortError") || isCancelledError(error);
}

export function createRefreshNoticeOwner() {
  let state = { notice: null };
  let routeKey = "";
  let nextId = 0;
  const listeners = new Set();

  const setState = (next) => {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const clear = () => {
    if (state.notice) {
      setState({ notice: null });
    }
  };

  const owner = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // The active route; a change clears the notice of the previous route.
    setRouteKey(nextRouteKey) {
      if (nextRouteKey === routeKey) {
        return;
      }
      routeKey = nextRouteKey;
      clear();
    },

    // Runs a background refresh and resolves to its result, or to null when
    // it failed. A failure of a refresh that still belongs to the active
    // route raises the notice; `retry` runs when the person asks for it.
    settle(task, { retry } = {}) {
      const startedFor = routeKey;
      return Promise.resolve()
        .then(task)
        .catch((error) => {
          if (!isQuietRefreshFailure(error) && startedFor === routeKey) {
            // Nested refreshes (a page and its shell) can both fail; the
            // notice keeps every distinct retry so one click reruns them all.
            const current = state.notice;
            const retries = current ? [...current.retries] : [];
            if (retry && !retries.includes(retry)) {
              retries.push(retry);
            }
            if (!current) {
              nextId += 1;
            }
            setState({ notice: { id: current ? current.id : nextId, retries } });
          }
          return null;
        });
    },

    // Hides the notice and runs every failed refresh again.
    retry() {
      const retries = state.notice?.retries ?? [];
      clear();
      for (const retry of retries) {
        void owner.settle(retry, { retry });
      }
    },

    dismiss: clear
  };
  return owner;
}
