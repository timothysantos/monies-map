import { getAccountSelectOptions } from "./account-display";
import { getCategoriesForSelect } from "./category-utils";
import { messages } from "./copy/en-SG";
import { getAmountToneClass } from "./entry-helpers";
import { formatMinorInput, parseMoneyInput } from "./formatters";

// Preview rows are edited here, while ImportsPanel owns the canonical payload and commit callback.
export function ImportPreviewRowsTable({
  previewRows,
  accounts,
  categories,
  people,
  knownAccountNames,
  isCommitDisabled,
  isSubmitting,
  onCommit,
  onUpdatePreviewRow,
  onRemovePreviewRow,
  getPreviewAccountOwnerPatch
}) {
  const accountOptions = getAccountSelectOptions(accounts, { valueKey: "id" });
  const categorySelectOptions = getCategoriesForSelect(categories);

  return (
    <>
      <ImportCommitButton disabled={isCommitDisabled} isSubmitting={isSubmitting} onCommit={onCommit} />
      <div className="table-wrap import-table-wrap">
        <table className="summary-table import-preview-table">
          <thead>
            <tr>
              <th>{messages.imports.table.row}</th>
              <th>{messages.imports.table.actions}</th>
              <th>{messages.imports.table.date}</th>
              <th>{messages.imports.table.description}</th>
              <th>{messages.imports.table.amount}</th>
              <th>{messages.imports.table.type}</th>
              <th>{messages.imports.table.account}</th>
              <th>{messages.imports.table.category}</th>
              <th>{messages.imports.table.owner}</th>
              <th>{messages.imports.table.split}</th>
              <th>{messages.imports.table.note}</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => {
              const duplicateMatch = row.duplicateMatches?.[0];
              return (
                <tr key={row.rowId} className={duplicateMatch ? "import-preview-row-duplicate" : ""}>
                  <td>
                    <span>{row.rowIndex}</span>
                    {duplicateMatch ? (
                      <span className={`pill duplicate-row-pill ${duplicateMatch.matchKind === "exact" ? "warning" : ""}`}>
                        {duplicateMatch.matchKind === "exact" ? messages.imports.duplicateMatchKindExact : messages.imports.duplicateMatchKindNear}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <button type="button" className="subtle-action" onClick={() => onRemovePreviewRow(row.rowId)}>
                      {messages.imports.removePreviewRow}
                    </button>
                  </td>
                  <td>
                    <input className="table-edit-input" type="date" value={row.date} onChange={(event) => onUpdatePreviewRow(row.rowId, { date: event.target.value })} />
                  </td>
                  <td>
                    <input className="table-edit-input" value={row.description} onChange={(event) => onUpdatePreviewRow(row.rowId, { description: event.target.value })} />
                    {duplicateMatch ? (
                      <small className="duplicate-row-detail">
                        {messages.imports.duplicateRowDetail(formatDuplicateMatch(duplicateMatch))}
                      </small>
                    ) : null}
                  </td>
                  <td className={getAmountToneClass(row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor)}>
                    <input
                      className="table-edit-input import-amount-input"
                      value={formatMinorInput(row.amountMinor)}
                      onChange={(event) => onUpdatePreviewRow(row.rowId, { amountMinor: parseMoneyInput(event.target.value, row.amountMinor) })}
                    />
                  </td>
                  <td>
                    <select className="table-edit-input" value={row.entryType} onChange={(event) => onUpdatePreviewRow(row.rowId, { entryType: event.target.value })}>
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="table-edit-input"
                      value={row.accountId ?? row.accountName ?? ""}
                      onChange={(event) => {
                        const nextAccountId = event.target.value || undefined;
                        const nextAccount = accounts.find((account) => account.id === nextAccountId);
                        const nextAccountName = nextAccount?.name ?? (!nextAccountId ? undefined : row.accountName);
                        onUpdatePreviewRow(row.rowId, {
                          accountId: nextAccount?.id,
                          accountName: nextAccountName,
                          ...getPreviewAccountOwnerPatch(nextAccountName, row, nextAccount?.id)
                        });
                      }}
                    >
                      <option value="">{messages.entries.allWallets}</option>
                      {row.accountName && !row.accountId && !knownAccountNames.has(row.accountName) ? (
                        <option value={row.accountName}>{row.accountName}</option>
                      ) : null}
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.value}>{account.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="table-edit-input" value={row.categoryName ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { categoryName: event.target.value || undefined })}>
                      <option value="">{messages.entries.allCategories}</option>
                      {categorySelectOptions.map((category) => (
                        <option key={category.id} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="table-edit-input"
                      value={row.ownershipType === "shared" ? "Shared" : (row.ownerName ?? "")}
                      onChange={(event) => {
                        const nextOwner = event.target.value;
                        if (nextOwner === "Shared") {
                          onUpdatePreviewRow(row.rowId, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5000 });
                          return;
                        }
                        onUpdatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: nextOwner, splitBasisPoints: 10000 });
                      }}
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.name}>{person.name}</option>
                      ))}
                      <option value="Shared">{messages.entries.shared}</option>
                    </select>
                  </td>
                  <td>
                    {row.ownershipType === "shared" ? (
                      <input
                        className="table-edit-input import-split-input"
                        type="number"
                        min="0"
                        max="100"
                        value={Math.round((row.splitBasisPoints ?? 5000) / 100)}
                        onChange={(event) => onUpdatePreviewRow(row.rowId, { splitBasisPoints: Math.round(Number(event.target.value || "50") * 100) })}
                      />
                    ) : (
                      messages.common.emptyValue
                    )}
                  </td>
                  <td>
                    <input className="table-edit-input" value={row.note ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { note: event.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ImportCommitButton disabled={isCommitDisabled} isSubmitting={isSubmitting} onCommit={onCommit} isBottom />
    </>
  );
}

function formatDuplicateMatch(match) {
  return messages.common.triplet(match.date, match.accountName ?? messages.common.emptyValue, formatMinorInput(match.amountMinor));
}

function ImportCommitButton({ disabled, isSubmitting, onCommit, isBottom = false }) {
  return (
    <div className={`import-actions import-actions-end ${isBottom ? "import-actions-bottom" : ""}`}>
      <button
        type="button"
        className="import-commit-button"
        disabled={disabled}
        onClick={onCommit}
      >
        {isSubmitting ? messages.common.working : messages.imports.commit}
      </button>
    </div>
  );
}
