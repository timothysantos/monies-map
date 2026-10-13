import "./splits-checkpoint-panel.css";
import { ArrowRightLeft } from "lucide-react";

import { messages } from "./copy/en-SG";
import { BottomActions, DetailRow, DetailRows, LeadCard } from "./ui/lead-support-detail";

// Splits terracotta, from the category palette (the split cards' colour).
const GROUP_BUBBLE_COLOUR = "#BF7D51";

// The open simplified settlement (design.md, "Lead · Support · Detail"):
// - Lead: who pays whom and how much, the state under it ("JPY · 10 included
//   split records · open").
// - Detail: View included activity, the transfers already matched and the
//   transfer to match (the page passes those two as ready nodes).
// - Bottom: Mark paid, the one primary, and Undo simplification.
// SplitsPanel keeps every handler and the money formatting.
export function SplitsCheckpointPanel({
  checkpoint,
  hasOverpayment = false,
  formattedAmount,
  matchedLabel = null,
  transfers = null,
  matchControls = null,
  isBusy = false,
  onViewActivity,
  onMarkPaid,
  onReopen
}) {
  const isOffset = checkpoint.status === "internally_offset";
  const hasAmount = checkpoint.amountMinor !== 0 && !hasOverpayment;
  // Without a figure to pay the lead says why in words, as before.
  const sentence = hasOverpayment
    ? "Matched transfers exceed the checkpoint. Review the difference before considering this settled."
    : checkpoint.amountMinor === 0
      ? "The included groups now net to zero. No bank transfer is needed."
      : null;

  return (
    <section className={`split-checkpoint-panel is-${checkpoint.status}`} aria-live="polite">
      <div className="split-checkpoint-summary">
        <LeadCard
          className="split-checkpoint-lead"
          category={{ colorHex: GROUP_BUBBLE_COLOUR, icon: ArrowRightLeft }}
          title={isOffset ? "Groups internally offset" : "Simplified settlement"}
          tag={<span className="split-checkpoint-kicker">Settlement status</span>}
          subtitle={hasAmount ? `${checkpoint.fromPersonName} pays ${checkpoint.toPersonName}` : null}
          tone="neutral"
          amount={hasAmount ? formattedAmount : null}
        >
          {sentence ? <p className="lsd-note">{sentence}</p> : null}
          <small>
            {checkpoint.currency ?? "SGD"} · {messages.splits.includedSplitRecords(checkpoint.includedRecordCount)} · {matchedLabel}{checkpoint.status.replaceAll("_", " ")}
          </small>
        </LeadCard>
      </div>
      <DetailRows label="Settlement details" className="split-checkpoint-rows">
        <DetailRow label="View included activity" state="action" value={<></>} onClick={onViewActivity} />
        {transfers}
        {checkpoint.amountMinor !== 0 ? matchControls : null}
      </DetailRows>
      <span className="split-checkpoint-navigation-hint">Included rows are marked in the timeline below.</span>
      <div className="split-checkpoint-completion-actions">
        <BottomActions
          className="split-checkpoint-actions-bar"
          primary={(
            <button type="button" className="lsd-primary" onClick={onMarkPaid} disabled={isBusy}>Mark paid</button>
          )}
          destructive={(
            <button type="button" className="lsd-quiet split-checkpoint-reopen" onClick={onReopen} disabled={isBusy}>Undo simplification</button>
          )}
        />
        <small>Moves this repayment out of the active view. It remains awaiting a bank transfer match.</small>
      </div>
    </section>
  );
}
