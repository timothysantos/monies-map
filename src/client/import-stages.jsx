import { messages } from "./copy/en-SG";
import { money } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { DeleteRowButton } from "./ui-components";
import "./import-review.css";

// The three steps of an import: bring files, review one, see what changed.
// A finished step shrinks to one line; "Change" reopens Bring files while a
// file is in review.
export function ImportStepper({ stage, bringSummary, isBringOpen, canCollapseBring, onToggleBring }) {
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
        return (
          <li key={step.key} className={`import-stepper-step ${state}`} aria-current={index === currentIndex ? "step" : undefined}>
            <span className="import-stepper-label">
              {messages.imports.stageNumbered(index + 1, step.label)}{index < currentIndex ? ` · ${messages.imports.stageDoneMark}` : ""}
            </span>
            <span className="import-stepper-summary">
              {step.summary}
              {step.key === "bring" && canCollapseBring ? (
                <>
                  {" "}
                  <button type="button" className="subtle-action import-stepper-change" aria-expanded={isBringOpen} onClick={onToggleBring}>
                    {isBringOpen ? messages.imports.stageHideFiles : messages.imports.stageChangeFiles}
                  </button>
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
// file in the queue.
export function ImportDoneCard({ summary, nextItem, onReviewNext, onRollback, onClose }) {
  // Re-render when money is revealed or hidden.
  useMoneyPrivacy();
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
        {onRollback ? (
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
        ) : <span />}
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
