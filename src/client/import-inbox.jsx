import { useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, FileText, Landmark, ListChecks } from "lucide-react";

import { describeIntakeCoverage, describeIntakeSource, orderIntakeQueue } from "./import-intake-model";
import { buildInboxChecklistProgress } from "./import-inbox-model";
import { useFollowingFold } from "./use-following-fold";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { addDaysToIsoDate, todayInAppTimeZone } from "./app-dates";
import "./import-bring-files.css";

const { format: formatService } = moniesClient;

// The inbox folds to one line ("Still missing: N of M") once files are
// queued or one is in review; expanded, each bank opens on its own. Lines a
// queued file matches are ticked off.
export function ImportInboxSection({
  inbox,
  intakeQueue = [],
  defaultOpen,
  onSelectExpectedFile
}) {
  const [snoozedFiles, setSnoozedFiles] = useState(() => readSnoozedImportFiles());
  const snoozedFileIds = useMemo(() => new Set(Object.keys(snoozedFiles)), [snoozedFiles]);
  const progress = useMemo(() => buildInboxChecklistProgress(inbox, intakeQueue), [inbox, intakeQueue]);
  const [isOpen, setIsOpen] = useFollowingFold(defaultOpen);
  const bodyId = useId();
  const requiredSessions = inbox?.sessions.filter((session) => session.status !== "current") ?? [];
  const currentSessions = inbox?.sessions.filter((session) => session.status === "current") ?? [];
  const hasRequiredFiles = Number(inbox?.summary.requiredFileCount ?? 0) > 0;

  useEffect(() => {
    writeSnoozedImportFiles(snoozedFiles);
  }, [snoozedFiles]);

  function handleSnoozeFile(fileId) {
    setSnoozedFiles((current) => ({
      ...current,
      [fileId]: getSnoozeUntilDate()
    }));
  }

  if (!inbox) {
    return null;
  }

  return (
    <section className={`panel-subsection import-inbox-section ${hasRequiredFiles ? "has-work" : "is-current"} ${isOpen ? "is-open" : "is-folded"}`}>
      <div className="import-inbox-header">
        <div className="section-head">
          <h3>{messages.imports.inboxTitle}</h3>
          <span className="panel-context import-inbox-fold-summary">{describeInboxProgress(inbox, progress)}</span>
        </div>
        <button
          type="button"
          className="subtle-action import-inbox-fold-toggle"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? messages.imports.inboxHide : messages.imports.inboxShow}
        </button>
      </div>

      {isOpen ? (
        <div id={bodyId} className="import-inbox-body">
          <p className="lede compact">{messages.imports.inboxDetail}</p>
          <div className="import-inbox-summary" aria-label={messages.imports.inboxSummaryLabel}>
            <ImportInboxMetric
              icon={<Landmark size={18} />}
              label={messages.imports.inboxMetricBankSessions}
              value={messages.imports.inboxMetricBankSessionsValue(inbox.summary.institutionCount)}
            />
            <ImportInboxMetric
              icon={<FileText size={18} />}
              label={messages.imports.inboxMetricRequiredFiles}
              value={messages.imports.inboxMetricRequiredFilesValue(inbox.summary.requiredFileCount)}
            />
            <ImportInboxMetric
              icon={<ListChecks size={18} />}
              label={messages.imports.inboxMetricAccounts}
              value={messages.imports.inboxMetricAccountsValue(inbox.summary.currentAccountCount, inbox.summary.activeAccountCount)}
            />
            <ImportInboxMetric
              icon={<Clock3 size={18} />}
              label={messages.imports.inboxMetricCleanup}
              value={messages.imports.inboxMetricCleanupValue(inbox.cleanup.pendingSplitMatchCount)}
            />
          </div>

          {hasRequiredFiles ? (
            <div className="import-inbox-guidance">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{messages.imports.inboxGuidance(inbox.summary.requiredFileCount, inbox.summary.institutionCount)}</span>
            </div>
          ) : (
            <div className="import-inbox-guidance is-current">
              <CheckCircle2 size={18} aria-hidden="true" />
              <span>{messages.imports.inboxCurrentGuidance}</span>
            </div>
          )}

          {requiredSessions.length ? (
            <div className="import-inbox-sessions">
              {requiredSessions.map((session) => (
                <ImportInboxSession
                  key={session.institution}
                  session={session}
                  sessionProgress={progress.sessions[session.institution]}
                  tickedFileIds={progress.tickedFileIds}
                  snoozedFileIds={snoozedFileIds}
                  onSelectExpectedFile={onSelectExpectedFile}
                  onSnoozeFile={handleSnoozeFile}
                />
              ))}
            </div>
          ) : null}

          {inbox.reviewQueue.length ? (
            <div className="import-inbox-review-order">
              <div>
                <strong>{messages.imports.inboxReviewOrderTitle}</strong>
                <span>{messages.imports.inboxReviewOrderDetail}</span>
              </div>
              <ol>
                {inbox.reviewQueue.slice(0, 6).map((file) => (
                  <li key={file.id}>
                    <strong>{`${formatService.formatMonthLabel(file.periodMonth)} (${file.periodMonth})`}</strong>
                    <span>{messages.imports.inboxReviewOrderItemBody(
                      file.accountName,
                      file.ownerLabel,
                      file.priority
                    )}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {inbox.cleanup.status === "needs_review" ? (
            <div className="import-inbox-cleanup">
              <strong>{messages.imports.inboxCleanupTitle}</strong>
              <span>{inbox.cleanup.detail}</span>
            </div>
          ) : null}

          {currentSessions.length ? (
            <details className="import-inbox-current">
              <summary>{messages.imports.inboxCurrentAccounts(currentSessions.length)}</summary>
              <div className="import-inbox-current-list">
                {currentSessions.flatMap((session) => session.accounts).map((account) => (
                  <span key={account.accountId}>{messages.common.triplet(account.accountName, account.ownerLabel)}</span>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// The folded line: what is still missing, or (nothing required) the
// inbox's own status.
function describeInboxProgress(inbox, progress) {
  if (progress.requiredCount > 0) {
    return messages.imports.inboxStillMissing(progress.missingCount, progress.requiredCount);
  }
  return inbox.summary.optionalFileCount > 0
    ? messages.imports.inboxOptionalFiles(inbox.summary.optionalFileCount)
    : messages.imports.inboxAllCurrent;
}

export function ImportIntakeQueueSection({
  items,
  summary,
  activeItemId,
  onLoadItem,
  onRemoveItem,
  onClear
}) {
  return (
    <section className="panel-subsection import-intake-section">
      <div className="import-inbox-header">
        <div className="section-head">
          <h3>{messages.imports.intakeTitle}</h3>
          <span className="panel-context">{messages.imports.intakeDetail}</span>
        </div>
        {items.length ? (
          <button type="button" className="subtle-action" onClick={onClear}>
            {messages.imports.intakeClear}
          </button>
        ) : null}
      </div>

      {items.length ? (
        <>
          <div className="import-intake-summary">
            <span>{messages.imports.intakeSummary(summary)}</span>
          </div>
          <div className="import-intake-list">
            {orderIntakeQueue(items).map((item, index) => {
              const coverage = describeIntakeCoverage(item, items);
              const isNext = index === 0 && !item.duplicate && item.id !== activeItemId;
              return (
              <div key={item.id} className={`import-intake-row is-${item.matchStatus}${item.duplicate ? " is-duplicate" : ""}${item.id === activeItemId ? " is-active" : ""}`}>
                <div className="import-intake-main">
                  <strong>{item.fileName}</strong>
                  <span>{messages.imports.intakeRowDetail({
                    sourceKind: describeIntakeSourceLabel(item),
                    month: item.parsed?.checkpoints?.[0]?.checkpointMonth
                      ? formatService.formatMonthLabel(item.parsed.checkpoints[0].checkpointMonth)
                      : "",
                    cardCount: item.checkpointCount,
                    rowCount: item.rowCount
                  })}</span>
                  <span>{item.id === activeItemId ? messages.imports.intakeInReview : isNext ? messages.imports.intakeReviewFirst : getIntakeStatusLabel(item)}</span>
                  {coverage ? <span className="import-intake-coverage">{messages.imports.intakeCoverage(coverage)}</span> : null}
                </div>
                <div className="import-intake-actions">
                  <button
                    type="button"
                    className={isNext ? "import-commit-button" : "subtle-action"}
                    onClick={() => onLoadItem(item)}
                    disabled={item.duplicate || item.id === activeItemId}
                  >
                    {messages.imports.intakeLoad}
                  </button>
                  <button type="button" className="subtle-action" onClick={() => onRemoveItem(item.id)}>
                    {messages.imports.intakeRemove}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="import-intake-empty">
          <strong>{messages.imports.intakeEmptyTitle}</strong>
          <span>{messages.imports.intakeEmptyDetail}</span>
        </div>
      )}
    </section>
  );
}

function describeIntakeSourceLabel(item) {
  const source = describeIntakeSource(item);
  return messages.imports.intakeSourceKind[source.kind](source.bank);
}

function getIntakeStatusLabel(item) {
  if (item.duplicate) {
    return messages.imports.intakeDuplicate;
  }
  if (item.matchStatus === "matched") {
    return messages.imports.intakeMatched;
  }
  if (item.matchStatus === "ambiguous") {
    return messages.imports.intakeAmbiguous;
  }
  if (item.matchStatus === "unexpected") {
    return messages.imports.intakeUnexpected;
  }
  return messages.imports.intakeUnknown;
}

function ImportInboxMetric({ icon, label, value }) {
  return (
    <div className="import-inbox-metric">
      <span className="import-inbox-metric-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// One bank, folded to its name and what is still missing there; open it
// for the portal, the download steps and each file.
function ImportInboxSession({ session, sessionProgress, tickedFileIds, snoozedFileIds, onSelectExpectedFile, onSnoozeFile }) {
  const requiredFiles = session.expectedFiles.filter((file) => file.priority === "required");
  const optionalFiles = session.expectedFiles.filter((file) => file.priority === "optional");
  const renderFile = (file) => (
    <ImportInboxFileRow
      key={file.id}
      file={file}
      isTicked={tickedFileIds.has(file.id)}
      isSnoozed={snoozedFileIds.has(file.id)}
      onSelectExpectedFile={onSelectExpectedFile}
      onSnoozeFile={onSnoozeFile}
    />
  );

  return (
    <details className="import-inbox-session">
      <summary className="import-inbox-session-head">
        <div>
          <strong>{session.institution}</strong>
          <span>
            {sessionProgress?.requiredCount
              ? messages.imports.inboxStillMissing(sessionProgress.missingCount, sessionProgress.requiredCount)
              : messages.imports.inboxSessionDetail(0, session.optionalFileCount)}
          </span>
        </div>
        <span className={`pill ${session.status === "needs_files" ? "warning" : "neutral"}`}>
          {session.status === "needs_files" ? messages.imports.inboxSessionNeedsFiles : messages.imports.inboxSessionOptional}
        </span>
      </summary>

      <div className="import-inbox-session-body">
        <div className="import-inbox-session-meta">
          <span>{messages.imports.inboxSessionDetail(session.requiredFileCount, session.optionalFileCount)}</span>
          {session.portalUrl ? (
            <a className="subtle-action" href={session.portalUrl} target="_blank" rel="noreferrer">
              {messages.imports.inboxOpenPortal}
            </a>
          ) : null}
        </div>

        {session.downloadInstructions.length ? (
          <ol className="import-inbox-instructions">
            {session.downloadInstructions.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
        ) : null}

        <div className="import-inbox-file-list">
          {requiredFiles.map(renderFile)}
          {optionalFiles.length ? (
            <details className="import-inbox-optional-files">
              <summary>{messages.imports.inboxOptionalSection(optionalFiles.length)}</summary>
              {optionalFiles.map(renderFile)}
            </details>
          ) : null}
        </div>
      </div>
    </details>
  );
}

// A checklist line. Its actions ("Use with import form" fills the import
// defaults from this file; "Not available" pauses it for a few days) show
// on hover or focus instead of on every line; a tap focuses the line.
function ImportInboxFileRow({ file, isTicked, isSnoozed, onSelectExpectedFile, onSnoozeFile }) {
  return (
    <div className={`import-inbox-file-row${isSnoozed ? " is-snoozed" : ""}${isTicked ? " is-ticked" : ""}`} tabIndex={-1}>
      {isTicked ? <CheckCircle2 className="import-inbox-file-tick" size={18} aria-hidden="true" /> : null}
      <div className="import-inbox-file-main">
        <strong>{file.accountName}</strong>
        <strong>{`${formatService.formatMonthLabel(file.periodMonth)} (${file.periodMonth})`}</strong>
        <span>{messages.imports.inboxFileOwner(file.ownerLabel)}</span>
        <span>{messages.imports.inboxFileDetail(
          file.detail,
          file.supportedFileTypes.join(", ")
        )}</span>
        {isSnoozed ? <span>{messages.imports.inboxSnoozed}</span> : null}
      </div>
      <div className="import-inbox-file-actions">
        <button type="button" className="subtle-action" onClick={() => onSelectExpectedFile(file)}>
          {messages.imports.inboxUseFile}
        </button>
        {!isSnoozed ? (
          <button type="button" className="subtle-action" onClick={() => onSnoozeFile(file.id)}>
            {messages.imports.inboxNotAvailable}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function readSnoozedImportFiles() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem("monies.importInbox.snoozedFiles") ?? "{}");
    const today = todayInAppTimeZone();
    return Object.fromEntries(
      Object.entries(parsed).filter(([, snoozedUntil]) => String(snoozedUntil) >= today)
    );
  } catch {
    return {};
  }
}

function writeSnoozedImportFiles(value) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("monies.importInbox.snoozedFiles", JSON.stringify(value));
}

function getSnoozeUntilDate() {
  return addDaysToIsoDate(todayInAppTimeZone(), 3);
}
