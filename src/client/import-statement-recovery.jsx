import { useState } from "react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const { format: formatService } = moniesClient;

// Shown while a statement's rows do not add up to its printed totals (see
// import-statement-recovery-model.js). It offers only what the page shows: a
// read amount that exactly fills the difference, and rows whose amount the
// user types from the PDF. The commit stays blocked by the import blockers
// until the rows add up; nothing here unblocks it directly.
export function ImportStatementRecovery({ recovery, isSubmitting, onAddRow }) {
  const openTotals = recovery.totals.filter((item) => item.differenceMinor !== 0);
  return (
    <section
      className="import-warning import-warning-attention import-statement-recovery"
      data-import-target="statement-ocr-recovery"
      aria-labelledby="import-statement-recovery-title"
    >
      <strong id="import-statement-recovery-title">{messages.imports.statementRecoveryTitle}</strong>
      {openTotals.map((item) => (
        <dl key={item.isCredit ? "credits" : "purchases"} className="import-statement-recovery-totals">
          <div>
            <dt>{item.isCredit ? messages.imports.statementRecoveryCredits : messages.imports.statementRecoveryPurchases}</dt>
            <dd>{formatService.money(item.expectedMinor)}</dd>
          </div>
          <div>
            <dt>{messages.imports.statementRecoveryFound}</dt>
            <dd>{formatService.money(item.foundMinor)}</dd>
          </div>
          <div>
            <dt>{messages.imports.statementRecoveryDifference}</dt>
            <dd>{formatService.money(Math.abs(item.differenceMinor))}</dd>
          </div>
        </dl>
      ))}
      {recovery.offeredLeftovers.map((candidate) => (
        <div key={candidate.id} className="import-statement-recovery-row">
          <span className="import-statement-recovery-label">{messages.imports.statementRecoveryLeftover}</span>
          <span>{describeCandidate(candidate)} · {formatService.money(candidate.amountMinor)}</span>
          <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onAddRow(candidate, candidate.amountMinor)}>
            {messages.imports.statementRecoveryAddRow}
          </button>
        </div>
      ))}
      {recovery.unreadRows.map((candidate) => (
        <UnreadAmountRow key={candidate.id} candidate={candidate} isSubmitting={isSubmitting} onAddRow={onAddRow} />
      ))}
      <p className="lede compact">{messages.imports.statementRecoveryHelp}</p>
    </section>
  );
}

function UnreadAmountRow({ candidate, isSubmitting, onAddRow }) {
  const [draft, setDraft] = useState("");
  const amountMinor = formatService.parseMoneyInput(draft, 0);
  const canAdd = !isSubmitting && Number.isInteger(amountMinor) && amountMinor > 0;
  return (
    <form
      className="import-statement-recovery-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (canAdd) {
          void onAddRow(candidate, amountMinor);
        }
      }}
    >
      <span className="import-statement-recovery-label">{messages.imports.statementRecoveryUnread}</span>
      <span>{describeCandidate(candidate)}</span>
      <input
        className="table-edit-input import-statement-recovery-amount"
        inputMode="decimal"
        aria-label={messages.imports.statementRecoveryAmountLabel(candidate.row.description)}
        placeholder="0.00"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="subtle-action" disabled={!canAdd}>
        {messages.imports.statementRecoveryAddRow}
      </button>
    </form>
  );
}

function describeCandidate(candidate) {
  const date = candidate.row.date ? formatService.formatDateOnly(candidate.row.date) : "";
  return [date, candidate.row.description || messages.imports.statementRecoveryNoDescription].filter(Boolean).join(" · ");
}
