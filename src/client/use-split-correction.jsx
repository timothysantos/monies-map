import { useCallback, useRef, useState } from "react";

import { splitsMessages } from "./copy/en-SG-splits";
import { SplitCorrectionDialog } from "./split-correction-dialog";
import { fetchSplitCorrectionPreview, undoSplitCorrection } from "./splits-api";

const copy = splitsMessages.correction;
export const CORRECT_SETTLED_PARAM = "correct_settled";

// Everything the Splits page does for settled-period corrections (DOMAIN.md
// "Split Correction"), kept out of the panel:
// - the dialog, opened by the Ledger check-up's link (`?correct_settled=<id>`)
//   or by the link on a settled card;
// - which settled cards the check-up flags (asked once per card, when it opens),
//   so the link shows only where a correction can be made;
// - Undo correction from a row in the open period.
// `afterChange` refreshes the page, `announce` and `announceError` show a line.
export function useSplitCorrection({ searchParams, setSearchParams, afterChange, announce, announceError }) {
  const target = searchParams.get(CORRECT_SETTLED_PARAM);
  const [correctable, setCorrectable] = useState({});
  const [undoingId, setUndoingId] = useState("");
  const asked = useRef(new Set());

  const setTarget = useCallback((id) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) {
        next.set(CORRECT_SETTLED_PARAM, id);
      } else {
        next.delete(CORRECT_SETTLED_PARAM);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const forgetEligibility = useCallback(() => {
    asked.current.clear();
    setCorrectable({});
  }, []);

  // One request per settled card that opens.
  const watchCard = useCallback((recordId) => {
    if (!recordId || asked.current.has(recordId)) {
      return;
    }
    asked.current.add(recordId);
    fetchSplitCorrectionPreview(recordId)
      .then((data) => setCorrectable((current) => ({ ...current, [recordId]: Boolean(data.eligible) })))
      .catch(() => asked.current.delete(recordId));
  }, []);

  // The card's lock, with the correction link when the check-up flags it.
  const decorateLock = useCallback((lock, recordId) => (
    lock && correctable[recordId] ? { ...lock, onCorrect: () => setTarget(recordId) } : lock
  ), [correctable, setTarget]);

  async function undoCorrection(item) {
    if (undoingId) {
      return;
    }
    setUndoingId(item.id);
    try {
      await undoSplitCorrection(item.id);
      forgetEligibility();
      announce(copy.undone);
      afterChange();
    } catch (error) {
      announceError(error instanceof Error ? error.message : copy.failed);
    } finally {
      setUndoingId("");
    }
  }

  const dialog = target ? (
    <SplitCorrectionDialog
      key={target}
      sourceRecordId={target}
      onClose={() => setTarget("")}
      onAdded={() => {
        setTarget("");
        forgetEligibility();
        announce(copy.added);
        afterChange();
      }}
    />
  ) : null;

  return { dialog, watchCard, decorateLock, undoCorrection, undoingCorrectionId: undoingId };
}
