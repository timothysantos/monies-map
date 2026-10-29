import { useEffect, useMemo, useState } from "react";

import { requestTransferMatches } from "./check-api";
import { formatShortDay } from "./check-model";
import { checkCopy } from "./copy/check-copy";
import { SheetDialog } from "./sheet-dialog";

const copy = checkCopy.inPlace.pair;

// Reads both sides fresh and works out which way the money went: the side
// that is a transfer is the subject (the Entries transfer dialog's own
// candidates read), the other must be among its candidates and the right way
// round. Anything else means the records changed since the list was made.
async function readPair(entryIds, signal) {
  for (const [index, subjectId] of entryIds.entries()) {
    const otherId = entryIds[1 - index];
    let matches;
    try {
      matches = await requestTransferMatches(subjectId, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      continue;
    }
    const { entry, candidates } = matches;
    const other = candidates.find((candidate) => candidate.id === otherId);
    if (entry.entryType !== "transfer" || !entry.transferDirection || !other) {
      continue;
    }
    if (other.entryType === "transfer" && other.transferDirection === entry.transferDirection) {
      continue;
    }
    const subjectIsOut = entry.transferDirection === "out";
    return {
      out: subjectIsOut ? entry : other,
      in: subjectIsOut ? other : entry
    };
  }
  throw new Error("changed");
}

function sideFor(entry, { areTotalsVisible, formatMoney, thisYear }) {
  const wallet = entry.accountOwnerLabel ? `${entry.accountName} · ${entry.accountOwnerLabel}` : entry.accountName;
  return {
    id: entry.id,
    label: entry.description,
    detail: [
      formatShortDay(entry.date, thisYear),
      wallet,
      areTotalsVisible && Number.isFinite(entry.amountMinor) ? formatMoney(Math.abs(entry.amountMinor), entry.currency ?? "SGD") : ""
    ].filter(Boolean).join(" · ")
  };
}

// "Link these two" on a problem of two unlinked sides of one transfer
// (docs/flows/check-flow.md, "Fixing and coming back"): the app's small
// confirmation. It states the two entries (amounts, dates, accounts) read
// fresh, and links nothing until the confirming button; `onConfirm` is the
// existing single link command (`/api/transfers/link`, the Transfer details
// dialog's own) and resolves true when it was saved. With money hidden the
// two rows carry no amount.
export function CheckLinkTwoDialog({ entryIds, areTotalsVisible, formatMoney, onClose, onConfirm }) {
  /** @type {[{ status: "loading" | "ready" | "linking" | "failed" | "changed", pair?: any }, Function]} */
  const [state, setState] = useState({ status: "loading" });
  const [error, setError] = useState("");

  // The key, not the array: the panel builds a new array on every render.
  const idsKey = entryIds.join("+");
  useEffect(() => {
    const controller = new AbortController();
    readPair(idsKey.split("+"), controller.signal)
      .then((pair) => setState({ status: "ready", pair }))
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setState({ status: failure instanceof Error && failure.message === "changed" ? "changed" : "failed" });
        }
      });
    return () => controller.abort();
  }, [idsKey]);

  const sides = useMemo(() => {
    if (!state.pair) return null;
    const context = { areTotalsVisible, formatMoney, thisYear: new Date().getFullYear() };
    return { out: sideFor(state.pair.out, context), in: sideFor(state.pair.in, context) };
  }, [areTotalsVisible, formatMoney, state.pair]);

  async function confirm() {
    if (state.status !== "ready" || !state.pair) return;
    const { pair } = state;
    setState({ status: "linking", pair });
    setError("");
    const saved = await onConfirm({ fromEntryId: pair.out.id, toEntryId: pair.in.id });
    if (saved) {
      onClose();
      return;
    }
    setState({ status: "ready", pair });
    setError(copy.linkFailed);
  }

  const canConfirm = state.status === "ready" || state.status === "linking";
  const isLinking = state.status === "linking";
  const failure = state.status === "failed" ? copy.loadFailed : state.status === "changed" ? copy.changed : error;

  return (
    <SheetDialog
      className="check-link-two"
      title={copy.title}
      description={copy.effect}
      descriptionHidden
      errorMessage={failure}
      primaryLabel={canConfirm ? (isLinking ? copy.working : copy.confirm) : null}
      primaryDisabled={!canConfirm || isLinking}
      hideSubmit={!canConfirm}
      isSubmitting={isLinking}
      quietLabel={canConfirm ? copy.cancel : copy.close}
      onSubmit={confirm}
      onClose={onClose}
    >
      {state.status === "loading" ? <p className="lsd-note" role="status">{copy.loading}</p> : null}
      {canConfirm && sides ? (
        <>
          <ul className="check-two-list">
            <li>
              <span className="check-two-role">{copy.out}</span>
              <span className="check-two-label">{sides.out.label}</span>
              <span className="check-two-detail">{sides.out.detail}</span>
            </li>
            <li>
              <span className="check-two-role">{copy.in}</span>
              <span className="check-two-label">{sides.in.label}</span>
              <span className="check-two-detail">{sides.in.detail}</span>
            </li>
          </ul>
          <p className="lsd-note">{copy.effect}</p>
        </>
      ) : null}
    </SheetDialog>
  );
}
