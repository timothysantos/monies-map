// Owner of the trip page's server data (AGENTS.md: one owner per kind of
// server data, no parallel useState copy): the page for one trip or event
// and the days the person opened on it (DOMAIN.md "Trip page").
//
// - Reads go through the shell's required read (`fetchRequiredQuery`, passed
//   in, so this route chunk imports no query module of its own; see
//   check-data-owner.js) and bypass the kept answer: the page is read fresh
//   each time it opens, because entries change on other pages.
// - Every read takes a generation: a read that finishes after a newer one
//   (another trip opened, "Try again") never overwrites it and its failure
//   is not reported.
// - A day's entries are read once, when the person opens that day, and kept
//   for the visit; a failed day can be opened again.
import { requestTripDay, requestTripPage } from "./trip-page-api.js";

// An aborted or cancelled read is superseded, not a failure (the same test
// as check-data-owner.js, without importing TanStack into the route chunk).
function isQuietFailure(error) {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.message === "CancelledError");
}

/**
 * @typedef {{ status: "loading" | "ready" | "failed", entries: any[] }} TripDayState
 * @typedef {{ status: "idle" | "loading" | "ready", tripId: string, page: any, failed: boolean, days: Record<string, TripDayState> }} TripPageState
 */

/** @type {TripPageState} */
const INITIAL_STATE = Object.freeze({ status: "idle", tripId: "", page: null, failed: false, days: {} });

export function createTripPageOwner({ fetchRequiredQuery, fetchImpl = fetch }) {
  /** @type {TripPageState} */
  let state = INITIAL_STATE;
  let generation = 0;
  const listeners = new Set();

  /** @param {Partial<TripPageState>} patch */
  const setState = (patch) => {
    state = { ...state, ...patch };
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

    // Opens a trip: another trip clears the page (it must never show the
    // other trip's money); the same trip keeps it on screen while it reads.
    // Resolves true when applied.
    async load({ tripId, signal = undefined }) {
      const mine = ++generation;
      const same = state.tripId === tripId;
      setState({ status: "loading", tripId, failed: false, page: same ? state.page : null, days: same ? state.days : {} });
      try {
        const page = await fetchRequiredQuery({
          queryKey: ["trip-page", tripId],
          fetcher: ({ signal: querySignal }) => requestTripPage({ tripId, signal: querySignal, fetchImpl }),
          bypassCache: true,
          signal,
          abortMessage: "The trip page request was cancelled."
        });
        if (mine !== generation || signal?.aborted) return false;
        setState({ status: "ready", page });
        return true;
      } catch (error) {
        if (mine !== generation || signal?.aborted || isQuietFailure(error)) return false;
        setState({ status: "ready", failed: true });
        return false;
      }
    },

    // One day's entries, when the person opens it. Read once per visit.
    async loadDay(day) {
      const { tripId } = state;
      const current = state.days[day];
      if (!tripId || current?.status === "ready" || current?.status === "loading") return;
      const mine = generation;
      setState({ days: { ...state.days, [day]: { status: "loading", entries: [] } } });
      try {
        const answer = await fetchRequiredQuery({
          queryKey: ["trip-page-day", tripId, day],
          fetcher: ({ signal: querySignal }) => requestTripDay({ tripId, day, signal: querySignal, fetchImpl }),
          bypassCache: true,
          abortMessage: "The trip day request was cancelled."
        });
        if (mine !== generation || state.tripId !== tripId) return;
        setState({ days: { ...state.days, [day]: { status: "ready", entries: answer?.entries ?? [] } } });
      } catch {
        if (mine !== generation || state.tripId !== tripId) return;
        setState({ days: { ...state.days, [day]: { status: "failed", entries: [] } } });
      }
    }
  };
}
