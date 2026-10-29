// Owner of the "Check my books" report (AGENTS.md: one owner per kind of
// server data, no parallel useState copy). It holds the report on screen, the
// person's view it was run for and the one write the page makes ("This is
// fine" and its undo).
//
// - A check runs only when the person asks: the page opening, "Check again",
//   or opening the hidden list. Reads go through the shell's required read
//   (`fetchRequiredQuery`, passed in: query-leases.js imported by a route chunk
//   would split the entry chunk) and bypass the kept answer, because a check
//   is meant to be fresh.
// - Every read takes a generation: a read that finishes after a newer check
//   (another person's view, "Check again") never overwrites the newer report
//   and its failure is not reported.
// - A write shows at once (counts and rows move on the page), then asks the
//   server; if the server refuses, the page puts it back. A read that was
//   already running when a write landed is read again, so it can never bring
//   back what the person just hid.
import { applyHiddenChange, applyResolved, applyUnresolved } from "./check-model.js";
import { postHide, postLinkClearPairs, postShowAgain, requestCheckup, requestClearPairsPreview } from "./check-api.js";

// An aborted or cancelled read is superseded, not a failure. A cancellation is
// recognised by its message instead of importing TanStack's `isCancelledError`
// (or refresh-notice.js): a route chunk that imports the package splits the
// entry chunk, one more first-screen file. tests/check-data-owner.test.mjs
// proves this reads a real cancellation.
function isQuietFailure(error) {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.message === "CancelledError");
}

/**
 * @typedef {{ status: "idle" | "loading" | "ready", report: any, viewId: string, includeHidden: boolean, failed: boolean, lastHidden: { id: string, title: string } | null, writeError: string }} CheckState
 */

/** @type {CheckState} */
const INITIAL_STATE = Object.freeze({
  // "idle" before the first check, then "loading" while one runs.
  status: "idle",
  report: null,
  viewId: "",
  includeHidden: false,
  // The last check failed: with a report on screen it is the one from before.
  failed: false,
  // The last "This is fine" the person can still undo, { id, title }.
  lastHidden: null,
  // "hide" or "show" when the server refused the last write.
  writeError: ""
});

export function createCheckOwner({ fetchRequiredQuery, fetchImpl = fetch }) {
  /** @type {CheckState} */
  let state = INITIAL_STATE;
  let generation = 0;
  let writeEpoch = 0;
  // The row just hidden and where it stood, so the page can keep an inline
  // "Hidden. Undo" in its place across the refresh that follows the write.
  let hiddenRow = null;
  const listeners = new Set();

  /** @param {Partial<CheckState>} patch */
  const setState = (patch) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) {
      listener();
    }
  };

  // A fresh report does not list what was just hidden (unless the hidden list
  // is open); put that one back, flagged, where it stood.
  function keepJustHidden(report) {
    if (!hiddenRow || !state.lastHidden || report.findings.some((item) => item.id === hiddenRow.finding.id)) {
      return report;
    }
    const findings = [...report.findings];
    findings.splice(Math.min(hiddenRow.index, findings.length), 0, { ...hiddenRow.finding, dismissed: true });
    return { ...report, findings };
  }

  // Reads once for these parameters; reads again when a write landed meanwhile.
  async function read({ viewId, includeHidden, signal }) {
    for (;;) {
      const epoch = writeEpoch;
      const report = await fetchRequiredQuery({
        queryKey: ["ledger-checkup", viewId, includeHidden ? "hidden" : "visible"],
        fetcher: ({ signal: querySignal }) => requestCheckup({ viewId, includeHidden, signal: querySignal, fetchImpl }),
        bypassCache: true,
        signal,
        abortMessage: "The check was cancelled."
      });
      if (epoch === writeEpoch) {
        return keepJustHidden(report);
      }
    }
  }

  const owner = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,

    // An explicit check. A different person's view clears the report (it must
    // never show another view's problems); "Check again" keeps the report on
    // screen, marked as busy. Resolves true when applied.
    async run({ viewId, includeHidden = state.includeHidden, signal = undefined }) {
      const mine = ++generation;
      hiddenRow = null;
      setState({
        status: "loading",
        viewId,
        includeHidden,
        failed: false,
        lastHidden: null,
        writeError: "",
        report: state.viewId === viewId ? state.report : null
      });
      try {
        const report = await read({ viewId, includeHidden, signal });
        if (mine !== generation || signal?.aborted) {
          return false;
        }
        setState({ status: "ready", report });
        return true;
      } catch (error) {
        if (mine !== generation || signal?.aborted || isQuietFailure(error)) {
          return false;
        }
        setState({ status: "ready", failed: true });
        return false;
      }
    },

    // The quiet re-read after a write, for `runBackgroundRefresh`: it keeps
    // the page as it is while it runs, applies only while it is the newest
    // read, and throws on failure so the retryable notice shows.
    async refresh({ signal = undefined } = {}) {
      if (!state.viewId) {
        return false;
      }
      const mine = ++generation;
      const { viewId, includeHidden } = state;
      const report = await read({ viewId, includeHidden, signal });
      if (mine !== generation || signal?.aborted) {
        return false;
      }
      setState({ status: "ready", report, failed: false });
      return true;
    },

    // "This is fine". Returns true when the server kept it.
    async hide(finding) {
      if (!state.report) {
        return false;
      }
      writeEpoch += 1;
      hiddenRow = { finding, index: state.report.findings.findIndex((item) => item.id === finding.id) };
      setState({ report: applyHiddenChange(state.report, finding, true), lastHidden: { id: finding.id, title: finding.title }, writeError: "" });
      const { ok } = await postHide({ id: finding.id, evidenceKey: finding.evidenceKey }, fetchImpl);
      if (!ok) {
        writeEpoch += 1;
        hiddenRow = null;
        setState({ report: applyHiddenChange(state.report, finding, false), lastHidden: null, writeError: "hide" });
      }
      return ok;
    },

    // A problem put right on the page itself (a link, a correction). The row
    // leaves the list and the counts move at once; `write` is the existing
    // command's request (it resolves true when the server kept it, and may
    // already have run, as with the correction dialog). If it is refused or
    // throws, the row is put back where it stood. A check that was already
    // running when this landed is read again, so it can never bring the row
    // back. Resolves true when the change was kept.
    async resolveInPlace(finding, write) {
      if (!state.report) {
        return false;
      }
      writeEpoch += 1;
      const index = state.report.findings.findIndex((item) => item.id === finding.id);
      setState({ report: applyResolved(state.report, finding), writeError: "" });
      let ok = false;
      try {
        ok = (await write()) === true;
      } catch {
        ok = false;
      }
      writeEpoch += 1;
      if (!ok && state.report) {
        setState({ report: applyUnresolved(state.report, finding, index), writeError: "fix" });
      }
      return ok;
    },

    // "Undo" and "Show again".
    async show(finding) {
      if (!state.report) {
        return false;
      }
      writeEpoch += 1;
      hiddenRow = null;
      setState({ report: applyHiddenChange(state.report, finding, false), lastHidden: null, writeError: "" });
      const { ok } = await postShowAgain({ id: finding.id }, fetchImpl);
      if (!ok) {
        writeEpoch += 1;
        setState({ report: applyHiddenChange(state.report, finding, true), writeError: "show" });
      }
      return ok;
    },

    // "Link these N clear pairs": the preview the dialog shows (read fresh, never
    // kept) and the one write behind its button. Both throw on failure. A check
    // that was already running when the link landed is read again, so it can
    // never bring back a pair that is linked now.
    loadClearPairs({ viewId, signal = undefined }) {
      return requestClearPairsPreview({ viewId, signal, fetchImpl });
    },

    async linkClearPairs(pairs) {
      writeEpoch += 1;
      try {
        return await postLinkClearPairs(pairs, fetchImpl);
      } finally {
        writeEpoch += 1;
      }
    },

    clearWriteError() {
      if (state.writeError) {
        setState({ writeError: "" });
      }
    }
  };
  return owner;
}
