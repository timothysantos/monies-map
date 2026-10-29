import { useCallback, useEffect, useMemo, useState } from "react";

import { requestTransferMatches } from "./check-api";
import { checkCopy } from "./copy/check-copy";
import { EntryTransferTools } from "./entry-editor";
import { SheetDialog } from "./sheet-dialog";

const copy = checkCopy.inPlace.transfer;

// The Transfer details dialog, opened over the "Check my books" page for one
// transfer (docs/flows/check-flow.md, "Fixing and coming back"). It is the
// same component Entries and Settings use (`EntryTransferTools`), fed the same
// way the Settings review feeds it: the entry and its candidates from
// `/api/transfers/candidates`, "Use match" through `/api/transfers/link`,
// "Convert entry" and "Break connection" through `/api/transfers/settle`.
// `onLink` and `onSettle` are the page's: each resolves true when the server
// kept the change, after which the page closes this dialog. It loads in its
// own lazy chunk, only when the person opens it.
export function CheckTransferDialog({ entryId, categories, onClose, onLink, onSettle }) {
  const [entry, setEntry] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState("");
  const [refreshingId, setRefreshingId] = useState(null);
  const [linkingId, setLinkingId] = useState(null);
  const [settlingId, setSettlingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const categoryOptions = useMemo(() => categories.map((category) => category.name), [categories]);

  const load = useCallback(async (signal) => {
    setRefreshingId(entryId);
    setError("");
    try {
      const data = await requestTransferMatches(entryId, { signal });
      if (signal?.aborted) return;
      setEntry(data.entry);
      setCandidates(data.candidates);
    } catch (failure) {
      if (!signal?.aborted) {
        setError(failure instanceof Error && failure.message ? failure.message : copy.loadFailed);
      }
    } finally {
      if (!signal?.aborted) {
        setRefreshingId((current) => (current === entryId ? null : current));
      }
    }
  }, [entryId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function ensureDraft(target) {
    setDrafts((current) => (current[target.id] ? current : { ...current, [target.id]: { currentCategoryName: "Other", counterpartCategoryName: "Other" } }));
  }

  function updateDraft(id, patch) {
    setDrafts((current) => ({
      ...current,
      [id]: { currentCategoryName: "Other", counterpartCategoryName: "Other", ...current[id], ...patch }
    }));
  }

  async function link(target, candidate) {
    // Stored from → to, whichever side the dialog was opened from.
    const fromEntryId = target.transferDirection === "in" ? candidate.id : target.id;
    const toEntryId = target.transferDirection === "in" ? target.id : candidate.id;
    setLinkingId(target.id);
    setError("");
    try {
      if (!(await onLink({ fromEntryId, toEntryId }))) {
        setError(checkCopy.inPlace.fixFailed);
      }
    } finally {
      setLinkingId(null);
    }
  }

  async function settle(target) {
    const draft = drafts[target.id] ?? { currentCategoryName: "Other", counterpartCategoryName: "Other" };
    setSettlingId(target.id);
    setError("");
    try {
      const saved = await onSettle({
        entryId: target.id,
        counterpartEntryId: target.linkedTransfer?.transactionId,
        currentCategoryName: draft.currentCategoryName,
        counterpartCategoryName: draft.counterpartCategoryName
      });
      if (!saved) {
        setError(checkCopy.inPlace.fixFailed);
      }
    } finally {
      setSettlingId(null);
    }
  }

  if (!entry || entry.entryType !== "transfer") {
    // Reading, or nothing to show: a small dialog that says which.
    return (
      <SheetDialog
        className="check-transfer-loading"
        title={copy.title}
        description={copy.title}
        descriptionHidden
        errorMessage={error || (entry ? copy.notATransfer : "")}
        hideSubmit
        quietLabel={checkCopy.inPlace.pair.close}
        onSubmit={onClose}
        onClose={onClose}
      >
        {!error && !entry ? <p className="lsd-note" role="status">{copy.loading}</p> : null}
      </SheetDialog>
    );
  }

  return (
    <EntryTransferTools
      entry={entry}
      categoryOptions={categoryOptions}
      transferCandidates={candidates}
      transferDialogEntryId={entry.id}
      transferSettlementDrafts={drafts}
      linkingTransferEntryId={linkingId}
      settlingTransferEntryId={settlingId}
      refreshingTransferCandidatesEntryId={refreshingId}
      transferCandidatesError={error}
      onEnsureSettlementDraft={ensureDraft}
      onTransferDialogEntryChange={(next) => {
        const value = typeof next === "function" ? next(entry.id) : next;
        if (!value) {
          onClose();
        }
      }}
      onSettlementDraftChange={updateDraft}
      onRefreshCandidates={() => load(undefined)}
      onLinkCandidate={link}
      onSettleTransfer={settle}
      showLabel={false}
      trigger={<button type="button" hidden aria-hidden="true" tabIndex={-1}>{copy.title}</button>}
    />
  );
}
