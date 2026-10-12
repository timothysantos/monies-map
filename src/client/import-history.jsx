import * as Popover from "@radix-ui/react-popover";
import { ChevronRight } from "lucide-react";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { EmptyState } from "./ui-states";
import { RECENT_IMPORTS_PAGE_SIZE } from "./recent-imports-page-size";
import { moniesClient } from "./monies-client-service";
import { DeleteRowButton } from "./ui-components";
const { format: formatService } = moniesClient;

// Recent history is read-only except rollback; pagination only changes which batches are visible.
export function ImportRecentHistorySection({
  recentImports,
  recentImportAccountFilter,
  recentImportAccountOptions,
  recentImportGroups,
  recentImportsOpen,
  isRefreshing = false,
  recentImportStatus = null,
  hasOptimisticRecentImport = false,
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
  const showGenericRefreshStatus = isRefreshing && !recentImportStatus && !hasOptimisticRecentImport;

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
            <h3>{importMessages.recentTitle}</h3>
            <span className="panel-context">{importMessages.recentDetail}</span>
          </div>
        </div>
        <span className={`settings-section-toggle-icon ${recentImportsOpen ? "is-open" : ""}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {/* Commit and refresh status shows whether or not the list is open. */}
      {showGenericRefreshStatus ? (
        <div className="import-history-refreshing" role="status" aria-live="polite">
          <span className="app-spinner" aria-hidden="true" />
          <span>{importMessages.recentRefreshing}</span>
        </div>
      ) : null}
      {recentImportStatus ? (
        <div className={`import-history-refreshing is-${recentImportStatus.tone}`} role="status" aria-live="polite">
          {recentImportStatus.tone === "active" ? <span className="app-spinner" aria-hidden="true" /> : null}
          <span>{recentImportStatus.message}</span>
          {recentImportStatus.diagnosticHref ? (
            <a href={recentImportStatus.diagnosticHref} className="inline-link">
              {importMessages.openErrorDiagnostics}
            </a>
          ) : null}
        </div>
      ) : null}
      {recentImportStatus?.earlierImports?.length ? (
        <div className="import-history-earlier">
          <span>{importMessages.recentEarlierTitle}</span>
          <ul>
            {recentImportStatus.earlierImports.map((line) => <li key={line.id}>{line.text}</li>)}
          </ul>
        </div>
      ) : null}
      {recentImportsOpen ? (
        <div className="import-history-groups">
          <label className="entries-filter import-history-filter">
            <span className="entries-filter-label">{importMessages.recentAccountFilter}</span>
            <select value={recentImportAccountFilter} onChange={(event) => onAccountFilterChange(event.target.value)}>
              <option value="">{importMessages.recentAllAccounts}</option>
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
          {recentImportGroups.map((group) => (
            <section key={group.date} className="import-history-group">
              <div className="import-history-date">{formatService.formatDateOnly(group.date)}</div>
              <div className="import-history-list">
                {group.items.map((item) => (
                  <div key={item.id} className="import-card import-card-compact">
                    <div className="import-history-main">
                      <strong>{item.sourceLabel}</strong>
                      <span className="import-history-inline">
                        {messages.common.triplet(
                          getImportBatchKindLabel(item),
                          formatService.formatDate(item.importedAt),
                          importMessages.transactionCount(item.transactionCount)
                        )}
                      </span>
                      {item.startDate && item.endDate ? (
                        <span className="import-history-inline">{importMessages.importCoverage(
                          formatService.formatDateOnly(item.startDate),
                          formatService.formatDateOnly(item.endDate)
                        )}</span>
                      ) : null}
                      {item.accountNames.length ? <span className="import-history-inline">{item.accountNames.join(", ")}</span> : null}
                      {item.statementCertificateCount ? (
                        <span className="import-history-inline">
                          {importMessages.recentStatementCertificates(item.statementCertificateCount)}
                          {item.statementCertificateStatus === "exception" ? ` • ${importMessages.recentStatementCertificateException}` : ""}
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
                          triggerLabel={importMessages.rollback}
                          confirmLabel={importMessages.rollbackConfirm}
                          prompt={<>{importMessages.rollbackDetail(item.sourceLabel)}</>}
                          onConfirm={() => onRollback(item.id)}
                        />
                      ) : item.status === "completed" && isStatementCertifiedImport(item) ? (
                        <span className="pill neutral" title={importMessages.statementRollbackLockedDetail}>
                          {importMessages.statementRollbackLocked}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!recentImportGroups.length && !isRefreshing ? <EmptyState>{importMessages.recentEmpty}</EmptyState> : null}
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
      <span>{importMessages.recentPageSummary(recentImportStart, recentImportEnd, recentImportTotal)}</span>
      <div className="import-history-pagination-actions">
        <button
          type="button"
          className="subtle-action"
          disabled={recentImportPage <= 1}
          onClick={onPreviousPage}
        >
          {importMessages.previousPage}
        </button>
        <span>{importMessages.recentPageCount(recentImportPage, recentImportPageCount)}</span>
        <button
          type="button"
          className="subtle-action"
          disabled={recentImportPage >= recentImportPageCount}
          onClick={onNextPage}
        >
          {importMessages.nextPage}
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
          {importMessages.importOverlap(item.overlapImportCount ?? overlaps.length)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="import-overlap-popover" sideOffset={8} align="end">
          <div className="category-popover-head">
            <strong>{importMessages.overlapPopoverTitle}</strong>
            <span>{importMessages.overlapPopoverDetail}</span>
          </div>
          {overlaps.length ? (
            <div className="import-overlap-list">
              {overlaps.map((overlap) => (
                <div key={overlap.id} className="import-overlap-row">
                  <strong>{overlap.sourceLabel}</strong>
                  <p>
                    {messages.common.triplet(
                      getImportBatchKindLabel(overlap),
                      formatService.formatDate(overlap.importedAt),
                      importMessages.transactionCount(overlap.transactionCount)
                    )}
                  </p>
                  {overlap.startDate && overlap.endDate ? (
                    <p>{importMessages.importCoverage(
                      formatService.formatDateOnly(overlap.startDate),
                      formatService.formatDateOnly(overlap.endDate)
                    )}</p>
                  ) : null}
                  {overlap.accountNames.length ? <p>{overlap.accountNames.join(", ")}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>{importMessages.overlapPopoverEmpty}</EmptyState>
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
    return importMessages.importKindPdfStatement;
  }
  if (parserKey.includes("activity") || parserKey.includes("current_transactions")) {
    return importMessages.importKindMidcycle;
  }
  if (item.sourceType === "manual") {
    return importMessages.importKindManual;
  }
  return importMessages.importKindCsv;
}
