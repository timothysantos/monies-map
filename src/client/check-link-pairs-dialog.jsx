import { useEffect, useMemo, useState } from "react";

import { buildClearPairsView, describeClearPairsResult } from "./check-model";
import { checkCopy } from "./copy/check-copy";
import { SheetDialog } from "./sheet-dialog";

// "Link these N clear pairs" (docs/flows/check-flow.md, "Link clear pairs").
// One preview, one confirmation: it lists how many pairs and over which months,
// the first ten by name, says in plain words what linking does, and links
// nothing until the confirming button. Cancel changes nothing. The pairs it
// links are exactly the ones it lists (the server judges each again and skips
// any that changed); the result line says how many were linked and skipped.
// With money hidden a row shows no amount.
export function CheckLinkPairsDialog({ owner, viewId, pairCount, areTotalsVisible, formatMoney, onClose, onLinked }) {
  /** @type {[{ status: "loading" | "ready" | "linking" | "done" | "failed", preview?: any, result?: string }, Function]} */
  const [state, setState] = useState({ status: "loading" });
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    owner.loadClearPairs({ viewId, signal: controller.signal })
      .then((preview) => setState({ status: "ready", preview }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "failed" });
        }
      });
    return () => controller.abort();
  }, [owner, viewId]);

  const view = useMemo(() => (state.preview
    ? buildClearPairsView({ preview: state.preview, areTotalsVisible, formatMoney, thisYear: new Date().getFullYear() })
    : null), [areTotalsVisible, formatMoney, state.preview]);

  async function confirm() {
    if (state.status !== "ready" || !state.preview || view?.isEmpty) {
      return;
    }
    const { preview } = state;
    setState({ status: "linking", preview });
    setError("");
    try {
      const result = await owner.linkClearPairs(preview.pairs);
      setState({ status: "done", result: describeClearPairsResult(result) });
      onLinked();
    } catch {
      // Nothing was linked: the same pairs can be tried again.
      setState({ status: "ready", preview });
      setError(checkCopy.clear.linkFailed);
    }
  }

  const isReady = state.status === "ready" && view && !view.isEmpty;
  const isLinking = state.status === "linking";
  const title = view ? view.title : checkCopy.clear.title(pairCount);
  const canConfirm = isReady || isLinking;

  return (
    <SheetDialog
      className="check-link-pairs"
      title={title}
      description={checkCopy.clear.effect}
      descriptionHidden
      errorMessage={state.status === "failed" ? checkCopy.clear.loadFailed : error}
      primaryLabel={canConfirm && view ? (isLinking ? checkCopy.clear.working : view.confirmLabel) : null}
      primaryDisabled={!canConfirm || isLinking}
      hideSubmit={!canConfirm}
      isSubmitting={isLinking}
      quietLabel={state.status === "done" || state.status === "failed" || view?.isEmpty ? checkCopy.clear.close : checkCopy.clear.cancel}
      onSubmit={confirm}
      onClose={onClose}
    >
      {state.status === "loading" ? <p className="lsd-note" role="status">{checkCopy.clear.loading}</p> : null}
      {state.status === "done" ? <p className="check-pairs-result" role="status">{state.result}</p> : null}
      {view?.isEmpty && state.status === "ready" ? <p className="lsd-note" role="status">{checkCopy.clear.none}</p> : null}
      {canConfirm && view && !view.isEmpty ? (
        <>
          <p className="check-pairs-summary">{view.summary}</p>
          <ul className="check-pairs-list">
            {view.rows.map((row) => (
              <li key={row.key}>
                <span className="check-pairs-date">{row.date}</span>
                {row.amount ? <span className="check-pairs-amount">{row.amount}</span> : null}
                <span className="check-pairs-accounts">{row.accounts}</span>
              </li>
            ))}
          </ul>
          {view.moreText ? <p className="lsd-note">{view.moreText}</p> : null}
          <p className="lsd-note">{checkCopy.clear.effect}</p>
          <p className="lsd-note">{checkCopy.clear.noUndoAll}</p>
          {view.capNote ? <p className="lsd-note">{view.capNote}</p> : null}
        </>
      ) : null}
    </SheetDialog>
  );
}
