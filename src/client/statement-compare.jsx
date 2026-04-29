import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const {
  accounts: accountService,
  categories: categoryService,
  entries: entryService,
  format: formatService
} = moniesClient;

export function StatementCompareResultView({ result, deltaMinor, accounts, categories, people, onEntryAdded, onRowsMatched }) {
  const directionMismatches = result.possibleMatches.filter((candidate) => candidate.amountDirectionMismatch);
  const duplicateStatementGroups = result.duplicateStatementGroups ?? [];
  const duplicateLedgerGroups = result.duplicateLedgerGroups ?? [];
  const categorySelectOptions = categoryService.listForSelect(categories);
  return (
    <section className="settings-statement-compare">
      <strong>{messages.settings.statementCompareSummary(result)}</strong>
      {deltaMinor != null ? (
        <p className="settings-account-health is-mismatch">{messages.settings.statementCompareDelta(formatService.money(Math.abs(deltaMinor)))}</p>
      ) : null}
      <div className="settings-statement-compare-periods">
        <p>{messages.settings.statementCompareCheckpointPeriod(
          result.statementStartDate ? formatService.formatDateOnly(result.statementStartDate) : messages.common.emptyValue,
          formatService.formatDateOnly(result.statementEndDate)
        )}</p>
        <p>{messages.settings.statementCompareUploadedPeriod(
          result.uploadedStatementStartDate ? formatService.formatDateOnly(result.uploadedStatementStartDate) : messages.common.emptyValue,
          result.uploadedStatementEndDate ? formatService.formatDateOnly(result.uploadedStatementEndDate) : messages.common.emptyValue
        )}</p>
      </div>
      {result.possibleMatches.length ? (
        <div className="settings-statement-compare-block">
          <h3>{messages.settings.statementComparePossibleTitle}</h3>
          {result.possibleMatches.slice(0, 5).map((candidate) => (
            <p key={`${candidate.statementRow.id}-${candidate.ledgerRow.id}`}>
              {messages.settings.statementComparePossibleRow(candidate)}
            </p>
          ))}
        </div>
      ) : null}
      {directionMismatches.length ? (
        <div className="settings-statement-compare-block is-warning">
          <h3>{messages.settings.statementCompareDirectionTitle}</h3>
          <p className="settings-statement-compare-explainer">{messages.settings.statementCompareDirectionDetail}</p>
          {directionMismatches.slice(0, 5).map((candidate) => (
            <StatementCompareDirectionMismatch
              key={`${candidate.statementRow.id}-${candidate.ledgerRow.id}`}
              candidate={candidate}
              categories={categories}
              categorySelectOptions={categorySelectOptions}
              onRowsMatched={onRowsMatched}
            />
          ))}
        </div>
      ) : null}
      <div className="settings-statement-compare-block">
        <h3>{messages.settings.statementCompareDuplicateTitle}</h3>
        {duplicateStatementGroups.length || duplicateLedgerGroups.length ? (
          <>
            <p>{messages.settings.statementCompareDuplicateSummary(duplicateStatementGroups.length, duplicateLedgerGroups.length)}</p>
            <StatementCompareDuplicateGroups title={messages.settings.statementCompareDuplicateStatement} groups={duplicateStatementGroups} />
            <StatementCompareDuplicateGroups title={messages.settings.statementCompareDuplicateLedger} groups={duplicateLedgerGroups} />
          </>
        ) : (
          <p>{messages.settings.statementCompareDuplicateNone}</p>
        )}
      </div>
      <div className="settings-statement-compare-grid">
        <div>
          <h3>{messages.settings.statementCompareMissingTitle}</h3>
          {result.unmatchedStatementRows.length ? result.unmatchedStatementRows.slice(0, 12).map((row) => (
            <StatementCompareMissingRow
              key={row.id}
              row={row}
              result={result}
              accounts={accounts}
              categories={categories}
              categorySelectOptions={categorySelectOptions}
              people={people}
              onEntryAdded={onEntryAdded}
            />
          )) : <p>{messages.settings.statementCompareNone}</p>}
        </div>
        <div>
          <h3>{messages.settings.statementCompareExtraTitle}</h3>
          {result.unmatchedLedgerRows.length ? result.unmatchedLedgerRows.slice(0, 12).map((row) => (
            <StatementCompareDisplayRow key={row.id} row={row} />
          )) : <p>{messages.settings.statementCompareNone}</p>}
        </div>
      </div>
    </section>
  );
}

function StatementCompareDuplicateGroups({ title, groups }) {
  if (!groups.length) {
    return null;
  }

  return (
    <div className="settings-statement-duplicate-groups">
      <strong>{title}</strong>
      {groups.slice(0, 5).map((group, index) => (
        <div className="settings-statement-duplicate-group" key={`${title}-${index}`}>
          {group.rows.map((row) => <StatementCompareDisplayRow key={row.id} row={row} />)}
        </div>
      ))}
    </div>
  );
}

function StatementCompareDirectionMismatch({ candidate, categories, categorySelectOptions, onRowsMatched }) {
  const defaultCategoryName = candidate.statementRow.entryType === "transfer"
    ? "Transfer"
    : candidate.statementRow.categoryName && categories.some((category) => category.name === candidate.statementRow.categoryName)
      ? candidate.statementRow.categoryName
      : categories.find((category) => category.name === "Other - Income")?.name
        ?? categories.find((category) => category.name === "Other")?.name
        ?? categories[0]?.name
        ?? "";
  const [draft, setDraft] = useState(() => ({
    entryType: candidate.statementRow.entryType,
    transferDirection: candidate.statementRow.transferDirection ?? (candidate.statementRow.entryType === "transfer" ? candidate.statementRow.signedAmountMinor > 0 ? "in" : "out" : undefined),
    categoryName: defaultCategoryName
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  function updateDraft(patch) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.entryType === "transfer") {
        next.categoryName = "Transfer";
        next.transferDirection = next.transferDirection ?? "out";
      } else {
        next.transferDirection = undefined;
        if (next.categoryName === "Transfer") {
          next.categoryName = defaultCategoryName === "Transfer"
            ? categories.find((category) => category.name === "Other")?.name ?? categories[0]?.name ?? ""
            : defaultCategoryName;
        }
      }
      return next;
    });
  }

  async function saveDraft() {
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/entries/update-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: candidate.ledgerRow.id,
          entryType: draft.entryType,
          transferDirection: draft.transferDirection,
          categoryName: draft.categoryName
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update ledger row.");
      }
      setOpen(false);
      onRowsMatched?.(candidate.statementRow, candidate.ledgerRow);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Failed to update ledger row.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-statement-direction-row">
      <StatementCompareDisplayRow row={candidate.statementRow} label={messages.settings.statementCompareMissingTitle} />
      <div>
        <StatementCompareDisplayRow row={candidate.ledgerRow} label={messages.settings.statementCompareExtraTitle} />
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="settings-text-link">{messages.settings.statementCompareFixDirection}</button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="settings-statement-entry-popover" sideOffset={8} align="end">
              <strong>{messages.settings.statementCompareFixDirectionTitle}</strong>
              <div className="settings-statement-entry-form">
                <label className="table-edit-field">
                  <span>{messages.imports.table.type}</span>
                  <select className="table-edit-input" value={draft.entryType} onChange={(event) => updateDraft({ entryType: event.target.value })}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </label>
                {draft.entryType === "transfer" ? (
                  <label className="table-edit-field">
                    <span>Direction</span>
                    <select className="table-edit-input" value={draft.transferDirection ?? "out"} onChange={(event) => updateDraft({ transferDirection: event.target.value })}>
                      <option value="out">Out</option>
                      <option value="in">In</option>
                    </select>
                  </label>
                ) : (
                  <label className="table-edit-field">
                    <span>{messages.imports.table.category}</span>
                    <select className="table-edit-input" value={draft.categoryName} onChange={(event) => updateDraft({ categoryName: event.target.value })}>
                      {categorySelectOptions.map((category) => (
                        <option key={category.id} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {error ? <p className="form-error">{error}</p> : null}
              <div className="dialog-actions">
                <button type="button" className="subtle-cancel" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="dialog-primary" disabled={isSaving || !draft.entryType || !draft.categoryName} onClick={() => void saveDraft()}>
                  {messages.settings.statementCompareFixDirectionSave}
                </button>
              </div>
              <Popover.Arrow className="category-popover-arrow" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

function StatementCompareDisplayRow({ row, label }) {
  return (
    <div className="settings-statement-row">
      {label ? <span className="settings-statement-row-label">{label}</span> : null}
      <span>{formatService.formatDateOnly(row.date)}</span>
      <strong className={entryService.getAmountToneClass(row.signedAmountMinor)}>{formatService.money(row.signedAmountMinor)}</strong>
      <p>{row.description}</p>
    </div>
  );
}

function StatementCompareMissingRow({ row, result, accounts, categories, categorySelectOptions, people, onEntryAdded }) {
  const account = accounts.find((item) => item.name === result.accountName);
  const accountOptions = accountService.getSelectOptions(accounts);
  const preferredOwnerName = people.find((person) => person.name === account?.ownerLabel)?.name ?? people[0]?.name ?? "";
  const defaultCategoryName = row.entryType === "transfer"
    ? "Transfer"
    : row.categoryName && categories.some((category) => category.name === row.categoryName)
      ? row.categoryName
      : categories.find((category) => category.name === "Other")?.name ?? categories[0]?.name ?? "";
  const [draft, setDraft] = useState(() => ({
    date: row.date,
    description: row.description,
    accountName: result.accountName,
    categoryName: defaultCategoryName,
    amountMinor: row.amountMinor,
    entryType: row.entryType,
    transferDirection: row.transferDirection ?? (row.entryType === "transfer" ? row.signedAmountMinor > 0 ? "in" : "out" : undefined),
    ownershipType: "direct",
    ownerName: preferredOwnerName,
    note: row.note ?? ""
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  function updateDraft(patch) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (next.entryType === "transfer") {
        next.categoryName = "Transfer";
        next.transferDirection = next.transferDirection ?? "out";
      } else if (next.categoryName === "Transfer") {
        next.categoryName = defaultCategoryName === "Transfer" ? "Other" : defaultCategoryName;
        next.transferDirection = undefined;
      } else {
        next.transferDirection = undefined;
      }
      if (next.ownershipType !== "direct") {
        next.ownerName = undefined;
      } else {
        next.ownerName = next.ownerName || preferredOwnerName;
      }
      return next;
    });
  }

  async function saveDraft() {
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/entries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to add ledger entry.");
      }
      setOpen(false);
      onEntryAdded?.(row.id);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : "Failed to add ledger entry.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-statement-row settings-statement-row-action">
      <span>{formatService.formatDateOnly(row.date)}</span>
      <strong className={entryService.getAmountToneClass(row.signedAmountMinor)}>{formatService.money(row.signedAmountMinor)}</strong>
      <p>{row.description}</p>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" className="settings-text-link">{messages.settings.statementCompareAddEntry}</button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="settings-statement-entry-popover" sideOffset={8} align="end">
            <strong>{messages.settings.statementCompareAddEntryTitle}</strong>
            <div className="settings-statement-entry-form">
              <label className="table-edit-field">
                <span>{messages.imports.table.date}</span>
                <input className="table-edit-input" type="date" value={draft.date} onChange={(event) => updateDraft({ date: event.target.value })} />
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.account}</span>
                <select className="table-edit-input" value={draft.accountName} onChange={(event) => updateDraft({ accountName: event.target.value })}>
                  {accountOptions.map((accountOption) => (
                    <option key={accountOption.id} value={accountOption.value}>{accountOption.label}</option>
                  ))}
                </select>
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.description}</span>
                <input className="table-edit-input" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.amount}</span>
                <input
                  className="table-edit-input"
                  value={formatService.formatMinorInput(draft.amountMinor)}
                  onChange={(event) => updateDraft({
                    amountMinor: formatService.parseMoneyInput(event.target.value, draft.amountMinor)
                  })}
                />
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.type}</span>
                <select className="table-edit-input" value={draft.entryType} onChange={(event) => updateDraft({ entryType: event.target.value })}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
              {draft.entryType === "transfer" ? (
                <label className="table-edit-field">
                  <span>Direction</span>
                  <select className="table-edit-input" value={draft.transferDirection ?? "out"} onChange={(event) => updateDraft({ transferDirection: event.target.value })}>
                    <option value="out">Out</option>
                    <option value="in">In</option>
                  </select>
                </label>
              ) : (
                <label className="table-edit-field">
                  <span>{messages.imports.table.category}</span>
                  <select className="table-edit-input" value={draft.categoryName} onChange={(event) => updateDraft({ categoryName: event.target.value })}>
                    {categorySelectOptions.map((category) => (
                      <option key={category.id} value={category.name}>{category.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="table-edit-field">
                <span>{messages.imports.table.owner}</span>
                <select className="table-edit-input" value={draft.ownershipType === "shared" ? "shared" : draft.ownerName} onChange={(event) => {
                  if (event.target.value === "shared") {
                    updateDraft({ ownershipType: "shared", ownerName: undefined });
                  } else {
                    updateDraft({ ownershipType: "direct", ownerName: event.target.value });
                  }
                }}>
                  {people.map((person) => (
                    <option key={person.id} value={person.name}>{person.name}</option>
                  ))}
                  <option value="shared">{messages.entries.shared}</option>
                </select>
              </label>
              <label className="table-edit-field">
                <span>{messages.imports.table.note}</span>
                <input className="table-edit-input" value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} />
              </label>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="subtle-cancel" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="dialog-primary" disabled={isSaving || !draft.date || !draft.description || !draft.accountName || !draft.categoryName || !draft.amountMinor} onClick={() => void saveDraft()}>
                {messages.settings.statementCompareAddEntrySave}
              </button>
            </div>
            <Popover.Arrow className="category-popover-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
