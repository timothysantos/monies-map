import { ArrowRightLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { todayInAppTimeZone } from "./app-dates";
import { formatDayMonthYear } from "./copy/ask-copy";
import { splitsMessages } from "./copy/en-SG-splits";
import { moniesClient } from "./monies-client-service";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { addSplitCorrection, fetchSplitCorrectionPreview } from "./splits-api";

const { format: formatService } = moniesClient;
const copy = splitsMessages.correction;
const REASON_MAX_LENGTH = 120;

// "27 Aug", and the year when it is not this year's.
function dayMonth(isoDate, today) {
  const text = formatDayMonthYear(isoDate);
  return String(isoDate).slice(0, 4) === today.slice(0, 4) ? text.replace(/ \d{4}$/, "") : text;
}

// Correct a settled mistake (DOMAIN.md "Split Correction"): says in plain
// words what Add correction does, with the amount the server worked out. The
// person never types an amount: they may give a reason and, when the extra
// copy is still in the list, ask for it to be removed in the same step. The
// settle-up itself is never changed.
export function SplitCorrectionDialog({ sourceRecordId, onClose, onAdded }) {
  /** @type {[{ status: string, plan?: any, reason?: string, message?: string }, Function]} */
  const [state, setState] = useState({ status: "loading" });
  const [reason, setReason] = useState("");
  const [removeDuplicate, setRemoveDuplicate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const today = todayInAppTimeZone();

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchSplitCorrectionPreview(sourceRecordId, { signal: controller.signal })
      .then((data) => setState(data.eligible ? { status: "ready", plan: data.plan } : { status: "unavailable", reason: data.reason }))
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: failure instanceof Error ? failure.message : copy.failed });
        }
      });
    return () => controller.abort();
  }, [sourceRecordId]);

  async function add() {
    if (state.status !== "ready" || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const result = await addSplitCorrection({
        sourceRecordId,
        alsoRemoveDuplicate: removeDuplicate && state.plan.sourceStillLive,
        reason: reason.trim()
      });
      onAdded(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.failed);
      setIsSubmitting(false);
    }
  }

  const plan = state.status === "ready" ? state.plan : null;
  const amount = plan ? formatService.moneyWithCurrency(plan.amountMinor, plan.currency) : "";
  const sourceLine = plan ? [dayMonth(plan.sourceDate, today), plan.groupName].filter(Boolean).join(" · ") : "";

  return (
    <SheetDialog
      className="split-correction-dialog"
      title={copy.title}
      description={plan ? copy.effect(amount, plan.overchargedPersonName, dayMonth(plan.settledOn, today)) : copy.title}
      descriptionHidden
      lead={plan ? (
        <ConfirmLead neutral icon={ArrowRightLeft} title={plan.sourceDescription || copy.title} subtitle={sourceLine} amount={amount}>
          <p className="lsd-note">{copy.effect(amount, plan.overchargedPersonName, dayMonth(plan.settledOn, today))}</p>
        </ConfirmLead>
      ) : null}
      errorMessage={state.status === "error" ? state.message : error}
      primaryLabel={plan ? (isSubmitting ? copy.adding : copy.add) : null}
      primaryDisabled={!plan || isSubmitting}
      hideSubmit={!plan}
      isSubmitting={isSubmitting}
      quietLabel={plan ? copy.cancel : copy.close}
      onSubmit={add}
      onClose={onClose}
    >
      {state.status === "loading" ? <p className="lsd-note" role="status">{copy.loading}</p> : null}
      {state.status === "unavailable" ? <p className="lsd-note" role="status">{state.reason}</p> : null}
      {plan ? (
        <div className="split-correction-fields">
          <label className="split-correction-field">
            <span>{copy.reasonLabel}</span>
            <input
              type="text"
              className="lsd-row-input"
              maxLength={REASON_MAX_LENGTH}
              autoComplete="off"
              placeholder={plan.label.replace(/^Correction: /, "")}
              value={reason}
              disabled={isSubmitting}
              onChange={(event) => setReason(event.target.value)}
            />
            <small className="lsd-note">{copy.reasonHint}</small>
          </label>
          {plan.sourceStillLive ? (
            <label className="split-correction-check">
              <input
                type="checkbox"
                checked={removeDuplicate}
                disabled={isSubmitting}
                onChange={(event) => setRemoveDuplicate(event.target.checked)}
              />
              <span>
                {copy.removeDuplicate}
                <small className="lsd-note">{copy.removeDuplicateHint}</small>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </SheetDialog>
  );
}
