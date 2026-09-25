// Owner of the Entries page DTO. The "entries-page" query cache is
// authoritative; the owner keeps the page on screen, the request key of the
// active month and view, and whether the latest request is still loading.
// Every load and refresh takes a generation: a refresh started by an edit
// that finishes after the person moved to another month or view never
// overwrites the newer page, never ends its loading state, and its failure
// is not reported. A refresh for a request that is no longer active does not
// run at all.
//
// The owner also knows which request the page on screen belongs to. When the
// latest load or refresh fails while that page is still another month's or
// view's, the failure is this page's load error (`loadError`): the old page
// stays in memory for open drafts but must not be shown as the requested
// month. A failure while the page already belongs to the active request is a
// background failure and is rethrown for the refresh notice. Aborts and
// cancels by a cache clear are never errors.

import { isQuietRefreshFailure } from "./refresh-notice.js";

export function createEntriesDataOwner({
  initialPage,
  initialParams = null,
  requestKeyOf = (params) => params.toString()
}) {
  let state = { page: initialPage, isLoading: false, loadError: null };
  let activeKey = "";
  let pageKey = initialParams ? requestKeyOf(initialParams) : "";
  let generation = 0;
  const listeners = new Set();

  const setState = (next) => {
    if (next.page === state.page && next.isLoading === state.isLoading && next.loadError === state.loadError) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const applyPage = (page) => {
    pageKey = activeKey;
    setState({ page, isLoading: false, loadError: null });
  };

  // The latest request failed. Returns true when the caller should rethrow
  // (a background failure over this request's own page).
  const settleFailure = (error) => {
    if (isQuietRefreshFailure(error)) {
      setState({ ...state, isLoading: false });
      return false;
    }
    if (pageKey === activeKey) {
      setState({ ...state, isLoading: false });
      return true;
    }
    setState({
      page: state.page,
      isLoading: false,
      loadError: { message: error instanceof Error && error.message ? error.message : String(error) }
    });
    return false;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // A warm start for the active month from the shell (or the route view),
    // built for `params`. It shows at once but does not supersede the load
    // already running, and it clears a load error for the same request.
    seed(page, params = null) {
      if (params) {
        pageKey = requestKeyOf(params);
      }
      setState({ page, isLoading: state.isLoading, loadError: pageKey === activeKey ? null : state.loadError });
    },

    // Route load for the active month and view. Resolves true when applied,
    // false when aborted, superseded or failed with no page for this request
    // on screen (see `loadError`). A failure over this request's own page is
    // rethrown. `showLoading` is false when the cache already has the page,
    // so a revisit does not flash the overlay.
    async load({ params, fetchPage, signal, showLoading = true }) {
      const mine = ++generation;
      activeKey = requestKeyOf(params);
      setState({ page: state.page, isLoading: showLoading, loadError: null });
      try {
        const page = await fetchPage(params, { signal });
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        applyPage(page);
        return true;
      } catch (error) {
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        if (settleFailure(error)) {
          throw error;
        }
        return false;
      }
    },

    // Whether a request is the active month and view. Callers check it
    // before clearing caches for a refresh that would not run anyway.
    isActive: (params) => requestKeyOf(params) === activeKey,

    // Refetch after a mutation, keeping the current page on screen. Returns
    // the fresh page, or null when the request is no longer the active one,
    // a newer load or refresh superseded it, or it failed before this
    // request's page was ever shown (a load error). Any other failure of the
    // latest refresh is rethrown and leaves the page as it is.
    async refresh({ params, fetchPage, bypassCache = true }) {
      if (requestKeyOf(params) !== activeKey) {
        return null;
      }
      const mine = ++generation;
      setState({ ...state, isLoading: true });
      try {
        const page = await fetchPage(params, { bypassCache });
        if (mine !== generation) {
          return null;
        }
        applyPage(page);
        return page;
      } catch (error) {
        if (mine !== generation) {
          return null;
        }
        // Cancels are rethrown as before; the refresh notice ignores them.
        if (settleFailure(error) || isQuietRefreshFailure(error)) {
          throw error;
        }
        return null;
      }
    }
  };
}
