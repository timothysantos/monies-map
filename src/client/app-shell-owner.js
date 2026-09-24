// Owner of the app shell payload and its error (H12d). The shell is written
// by the first load (with the Entries warm start), background refreshes, full
// refreshes and failure handling. Each writer takes a token from `begin()`
// and applies through it; only the latest token may change the state, so a
// slow older shell request can neither replace a newer shell nor put up the
// shell error screen after a newer request succeeded.

export function createAppShellOwner() {
  let state = { shell: null, error: "" };
  let generation = 0;
  const listeners = new Set();
  // Failures of requests that were no longer the latest when they failed.
  const superseded = new WeakSet();

  const setState = (next) => {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // Starts a shell request and returns its token.
    begin() {
      generation += 1;
      return generation;
    },

    isLatest: (token) => token === generation,

    // Applies a shell payload (a warm start may apply twice with one token).
    // Returns whether it was applied.
    apply(token, shell) {
      if (token !== generation) {
        return false;
      }
      setState({ shell, error: "" });
      return true;
    },

    // Shows the shell error screen for the latest request only.
    fail(token, error) {
      if (token !== generation) {
        return false;
      }
      setState({ shell: null, error });
      return true;
    },

    // For failures that travel through shared handlers without their token:
    // a request whose token is no longer the latest gets a wrapped failure
    // that the handler skips. The original is never marked, because callers
    // joined to one query share the same error object and the latest caller
    // must still see it.
    markIfSuperseded(token, failure) {
      if (token === generation) {
        return failure;
      }
      const marker = new Error(failure instanceof Error ? failure.message : String(failure), { cause: failure });
      superseded.add(marker);
      return marker;
    },
    isSuperseded: (failure) => Boolean(failure && typeof failure === "object" && superseded.has(failure)),

    // The shell error screen for a failure known to be the latest.
    failLatest(error) {
      setState({ shell: null, error });
    }
  };
}
