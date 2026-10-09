import { Check } from "lucide-react";

import { messages } from "./copy/en-SG";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { DeleteRowButton } from "./ui-components";
import "./import-review.css";

// The three steps of an import: bring files, review one, see what changed.
// A finished step shrinks to one line; "Change" reopens Bring files while a
// file is in review.
// `isBringAlert`: the Bring files line carries an error (a failed upload or
// check refresh); the stuck import bar keeps that line instead of folding it.
export function ImportStepper({ stage, bringSummary, isBringAlert = false, isBringOpen, canCollapseBring, onToggleBring }) {
  const steps = [
    { key: "bring", label: messages.imports.stageBring, summary: bringSummary },
    { key: "review", label: messages.imports.stageReview, summary: messages.imports.stageReviewSummary },
    { key: "done", label: messages.imports.stageDone, summary: messages.imports.stageDoneSummary }
  ];
  const currentIndex = steps.findIndex((step) => step.key === stage);
  return (
    <ol className="import-stepper" aria-label={messages.imports.stageStepsLabel}>
      {steps.map((step, index) => {
        const state = index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : "is-next";
        const changeButton = (className) => (
          <button type="button" className={`subtle-action import-stepper-change ${className}`} aria-expanded={isBringOpen} onClick={onToggleBring}>
            {isBringOpen ? messages.imports.stageHideFiles : messages.imports.stageChangeFiles}
          </button>
        );
        const canChange = step.key === "bring" && canCollapseBring;
        return (
          <li key={step.key} className={`import-stepper-step ${state}${step.key === "bring" && isBringAlert ? " is-alert" : ""}`} aria-current={index === currentIndex ? "step" : undefined}>
            <span className="import-stepper-head">
              <span className="import-stepper-label">
                {state === "is-done" ? <Check size={14} aria-hidden="true" /> : null}
                {messages.imports.stageNumbered(index + 1, step.label)}{index < currentIndex ? ` · ${messages.imports.stageDoneMark}` : ""}
              </span>
              {/* The stuck import bar hides the summary; Change stays here. */}
              {canChange ? changeButton("is-stuck-only") : null}
            </span>
            <span className="import-stepper-summary">
              {step.summary}
              {canChange ? (
                <>
                  {" "}
                  {changeButton("is-in-summary")}
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// What the last commit did, card by card, with its rollback and the next
// file in the queue. `compact` is the short form kept above the next
// file's review while a batch goes on: the title, how the cards closed, the
// rows in total and the rollback.
export function ImportDoneCard({ summary, nextItem = undefined, onReviewNext = undefined, onRollback, onClose = undefined, compact = false }) {
  // Re-render when money is revealed or hidden.
  useMoneyPrivacy();
  const rollback = onRollback ? (
    <DeleteRowButton
      label={summary.sourceLabel}
      destructive={false}
      buttonClassName="subtle-action import-done-rollback"
      triggerLabel={messages.imports.doneRollback}
      confirmLabel={messages.imports.rollbackConfirm}
      prompt={<>{messages.imports.rollbackDetail(summary.sourceLabel)}</>}
      onConfirm={onRollback}
    >
      {messages.imports.doneRollback}
    </DeleteRowButton>
  ) : null;
  if (compact) {
    return (
      <section className="import-done-card is-compact" aria-label={summary.title}>
        <div className="import-done-head">
          <h3>{summary.title}</h3>
          {summary.statusLabel ? <span className={`pill ${summary.statusTone}`}>{summary.statusLabel}</span> : null}
          <span className="import-done-compact-detail">{messages.imports.doneRowsDetail(totalDoneCounts(summary))}</span>
          {rollback}
        </div>
      </section>
    );
  }
  return (
    <section className="import-done-card" aria-label={summary.title}>
      <div className="import-done-head">
        <h3>{summary.title}</h3>
        {summary.statusLabel ? <span className={`pill ${summary.statusTone}`}>{summary.statusLabel}</span> : null}
      </div>
      {summary.cards.length ? (
        <div className="import-done-cards">
          {summary.cards.map((card) => (
            <article key={card.name} className="import-card import-done-account">
              <strong>{card.name}</strong>
              <span>{messages.imports.doneCardBalance(formatStatementBalance(card.reconciliation), card.balanced)}</span>
              <span className="import-history-inline">{messages.imports.doneCardDetail(card.counts)}</span>
            </article>
          ))}
        </div>
      ) : (
        <p className="lede compact">{messages.imports.doneRowsDetail(summary.counts)}</p>
      )}
      <div className="import-done-actions">
        {rollback ?? <span />}
        <div className="import-done-next">
          <button type="button" className="subtle-action" onClick={onClose}>{messages.imports.doneClose}</button>
          {nextItem ? (
            <button type="button" className="import-commit-button" onClick={onReviewNext}>
              {messages.imports.doneReviewNext(nextItem.fileName)}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// Rows added and entries confirmed across every card of a statement, or of
// an activity file.
function totalDoneCounts(summary) {
  if (!summary.cards.length) {
    return summary.counts;
  }
  return summary.cards.reduce((total, card) => ({
    added: total.added + card.counts.added,
    confirmed: total.confirmed + card.counts.confirmed
  }), { added: 0, confirmed: 0 });
}

// The statement's own balance in bank terms: what a card owes, or a credit.
function formatStatementBalance(reconciliation) {
  const balanceMinor = Number(reconciliation.statementBalanceMinor ?? 0);
  if (reconciliation.accountKind !== "credit_card") {
    return messages.imports.doneBalance(money(balanceMinor));
  }
  return balanceMinor < 0
    ? messages.imports.doneOwed(money(Math.abs(balanceMinor)))
    : messages.imports.doneCredit(money(balanceMinor));
}
