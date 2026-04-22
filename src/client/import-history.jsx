import * as Popover from "@radix-ui/react-popover";
import { ChevronRight } from "lucide-react";
import { messages } from "./copy/en-SG";
import { formatDate, formatDateOnly } from "./formatters";
import { DeleteRowButton } from "./ui-components";

export const RECENT_IMPORTS_PAGE_SIZE = 25;

// Recent history is read-only except rollback; pagination only changes which batches are visible.
export function ImportRecentHistorySection({
  recentImports,
  recentImportAccountFilter,
  recentImportAccountOptions,
  recentImportGroups,
  recentImportsOpen,
  isRefreshing = false,
  recentImportPage,
  recentImportPageCount,
  recentImportStart,
  recentImportEnd,
  onToggleOpen,
  onAccountFilterChange,
  onPreviousPage,
  onNextPage,
  onRollback
}) {
  const shouldPaginate = recentImports.length > RECENT_IMPORTS_PAGE_SIZE;

  return (
    <section className={`panel-subsection import-history-section ${recentImportsOpen ? "is-open" : ""}`}>
      <button
        type="button"
        className="settings-section-toggle import-history-toggle"
        onClick={onToggleOpen}
        aria-expanded={recentImportsOpen}
      >
        <div className="settings-section-toggle-copy">
          <div className="section-head">
            <h3>{messages.imports.recentTitle}</h3>
            <span className="panel-context">{messages.imports.recentDetail}</span>
          </div>
        </div>
        <span className={`settings-section-toggle-icon ${recentImportsOpen ? "is-open" : ""}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {recentImportsOpen ? (
        <div className="import-history-groups">
          <label className="entries-filter import-history-filter">
            <span className="entries-filter-label">{messages.imports.recentAccountFilter}</span>
            <select value={recentImportAccountFilter} onChange={(event) => onAccountFilterChange(event.target.value)}>
              <option value="">{messages.imports.recentAllAccounts}</option>
              {recentImportAccountOptions.map((accountName) => (
                <option key={accountName} value={accountName}>{accountName}</option>
              ))}
            </select>
          </label>
          {shouldPaginate ? (
            <ImportRecentPagination
              recentImportPage={recentImportPage}
              recentImportPageCount={recentImportPageCount}
              recentImportStart={recentImportStart}
              recentImportEnd={recentImportEnd}
              recentImportTotal={recentImports.length}
              onPreviousPage={onPreviousPage}
              onNextPage={onNextPage}
            />
          ) : null}
          {isRefreshing ? (
            <div className="import-history-refreshing" role="status" aria-live="polite">
              <span className="app-spinner" aria-hidden="true" />
              <span>{messages.imports.recentRefreshing}</span>
            </div>
          ) : null}
          {recentImportGroups.map((group) => (
            <section key={group.date} className="import-history-group">
              <div className="import-history-date">{formatDateOnly(group.date)}</div>
              <div className="import-history-list">
                {group.items.map((item) => (
                  <div key={item.id} className="import-card import-card-compact">
                    <div className="import-history-main">
                      <strong>{item.sourceLabel}</strong>
                      <span className="import-history-inline">
                        {messages.common.triplet(
                          getImportBatchKindLabel(item),
                          formatDate(item.importedAt),
                          messages.imports.transactionCount(item.transactionCount)
                        )}
                      </span>
                      {item.startDate && item.endDate ? (
                        <span className="import-history-inline">{messages.imports.importCoverage(formatDateOnly(item.startDate), formatDateOnly(item.endDate))}</span>
                      ) : null}
                      {item.accountNames.length ? <span className="import-history-inline">{item.accountNames.join(", ")}</span> : null}
                      {item.statementCertificateCount ? (
                        <span className="import-history-inline">
                          {messages.imports.recentStatementCertificates(item.statementCertificateCount)}
                          {item.statementCertificateStatus === "exception" ? ` • ${messages.imports.recentStatementCertificateException}` : ""}
                        </span>
                      ) : null}
                      {item.note ? <span className="import-history-inline">{item.note}</span> : null}
                    </div>
                    <div className="import-meta import-meta-compact">
                      <span className={`import-status ${item.status === "rolled_back" ? "is-warning" : "is-complete"}`}>{item.status}</span>
                      {item.overlapImportCount ? (
                        <ImportOverlapPopover item={item} />
                      ) : null}
                      {canRollbackImport(item) ? (
                        <DeleteRowButton
                          label={item.sourceLabel}
                          destructive={false}
                          triggerLabel={messages.imports.rollback}
                          confirmLabel={messages.imports.rollbackConfirm}
                          prompt={<>{messages.imports.rollbackDetail(item.sourceLabel)}</>}
                          onConfirm={() => onRollback(item.id)}
                        />
                      ) : item.status === "completed" && isStatementCertifiedImport(item) ? (
                        <span className="pill neutral" title={messages.imports.statementRollbackLockedDetail}>
                          {messages.imports.statementRollbackLocked}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!recentImportGroups.length && !isRefreshing ? <p className="lede compact">{messages.imports.recentEmpty}</p> : null}
          {shouldPaginate ? (
            <ImportRecentPagination
              className="import-history-pagination-bottom"
              recentImportPage={recentImportPage}
              recentImportPageCount={recentImportPageCount}
              recentImportStart={recentImportStart}
              recentImportEnd={recentImportEnd}
              recentImportTotal={recentImports.length}
              onPreviousPage={onPreviousPage}
              onNextPage={onNextPage}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ImportRecentPagination({
  className = "",
  recentImportPage,
  recentImportPageCount,
  recentImportStart,
  recentImportEnd,
  recentImportTotal,
  onPreviousPage,
  onNextPage
}) {
  return (
    <div className={`import-history-pagination ${className}`}>
      <span>{messages.imports.recentPageSummary(recentImportStart, recentImportEnd, recentImportTotal)}</span>
      <div className="import-history-pagination-actions">
        <button
          type="button"
          className="subtle-action"
          disabled={recentImportPage <= 1}
          onClick={onPreviousPage}
        >
          {messages.imports.previousPage}
        </button>
        <span>{messages.imports.recentPageCount(recentImportPage, recentImportPageCount)}</span>
        <button
          type="button"
          className="subtle-action"
          disabled={recentImportPage >= recentImportPageCount}
          onClick={onNextPage}
        >
          {messages.imports.nextPage}
        </button>
      </div>
    </div>
  );
}

function ImportOverlapPopover({ item }) {
  const overlaps = item.overlapImports ?? [];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="pill warning pill-button">
          {messages.imports.importOverlap(item.overlapImportCount ?? overlaps.length)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="import-overlap-popover" sideOffset={8} align="end">
          <div className="category-popover-head">
            <strong>{messages.imports.overlapPopoverTitle}</strong>
            <span>{messages.imports.overlapPopoverDetail}</span>
          </div>
          {overlaps.length ? (
            <div className="import-overlap-list">
              {overlaps.map((overlap) => (
                <div key={overlap.id} className="import-overlap-row">
                  <strong>{overlap.sourceLabel}</strong>
                  <p>
                    {messages.common.triplet(
                      getImportBatchKindLabel(overlap),
                      formatDate(overlap.importedAt),
                      messages.imports.transactionCount(overlap.transactionCount)
                    )}
                  </p>
                  {overlap.startDate && overlap.endDate ? (
                    <p>{messages.imports.importCoverage(formatDateOnly(overlap.startDate), formatDateOnly(overlap.endDate))}</p>
                  ) : null}
                  {overlap.accountNames.length ? <p>{overlap.accountNames.join(", ")}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="lede compact">{messages.imports.overlapPopoverEmpty}</p>
          )}
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function canRollbackImport(item) {
  return item.status === "completed" && !item.rollbackProtected;
}

function isStatementCertifiedImport(item) {
  return item.rollbackProtected;
}

function getImportBatchKindLabel(item) {
  const parserKey = item.parserKey ?? "";
  if (item.sourceType === "pdf" || parserKey.endsWith("_pdf")) {
    return messages.imports.importKindPdfStatement;
  }
  if (parserKey.includes("activity") || parserKey.includes("current_transactions")) {
    return messages.imports.importKindMidcycle;
  }
  if (item.sourceType === "manual") {
    return messages.imports.importKindManual;
  }
  return messages.imports.importKindCsv;
}
