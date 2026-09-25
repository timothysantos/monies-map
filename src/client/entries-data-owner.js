// Owner of the Entries page DTO. The "entries-page" query cache is
// authoritative; the owner keeps the page on screen, the request key of the
// active month and view, and whether the latest request is still loading.
// Every load and refresh takes a generation: a refresh started by an edit
// that finishes after the person moved to another month or view never
// overwrites the newer page, never ends its loading state, and its failure
// is not reported. A refresh for a request that is no longer active does not
// run at all.

export function createEntriesDataOwner({ initialPage, requestKeyOf = (params) => params.toString() }) {
  let state = { page: initialPage, isLoading: false };
  let activeKey = "";
  let generation = 0;
  const listeners = new Set();

  const setState = (next) => {
    if (next.page === state.page && next.isLoading === state.isLoading) {
      return;
    }
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

    // A warm start for the active month from the shell (or the route view).
    // It shows at once but does not supersede the load already running.
    seed(page) {
      setState({ page, isLoading: state.isLoading });
    },

    // Route load for the active month and view. Resolves true when applied,
    // false when aborted or superseded. `showLoading` is false when the
    // cache already has the page, so a revisit does not flash the overlay.
    async load({ params, fetchPage, signal, showLoading = true }) {
      const mine = ++generation;
      activeKey = requestKeyOf(params);
      setState({ page: state.page, isLoading: showLoading });
      try {
        const page = await fetchPage(params, { signal });
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        setState({ page, isLoading: false });
        return true;
      } catch {
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        // Still the latest load (a failure, or a cancel by a cache clear):
        // end its loading state and keep the last page, as before.
        setState({ page: state.page, isLoading: false });
        return false;
      }
    },

    // Whether a request is the active month and view. Callers check it
    // before clearing caches for a refresh that would not run anyway.
    isActive: (params) => requestKeyOf(params) === activeKey,

    // Refetch after a mutation, keeping the current page on screen. Returns
    // the fresh page, or null when the request is no longer the active one
    // or a newer load or refresh superseded it. A failure of the latest
    // refresh is rethrown and leaves the page as it is.
    async refresh({ params, fetchPage, bypassCache = true }) {
      if (requestKeyOf(params) !== activeKey) {
        return null;
      }
      const mine = ++generation;
      setState({ page: state.page, isLoading: true });
      try {
        const page = await fetchPage(params, { bypassCache });
        if (mine !== generation) {
          return null;
        }
        setState({ page, isLoading: false });
        return page;
      } catch (error) {
        if (mine !== generation) {
          return null;
        }
        setState({ page: state.page, isLoading: false });
        throw error;
      }
    }
  };
}
