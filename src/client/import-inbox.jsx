import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Clock3, FileText, Landmark, ListChecks } from "lucide-react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const { format: formatService } = moniesClient;

export function ImportInboxSection({
  inbox,
  onSelectExpectedFile
}) {
  const [snoozedFiles, setSnoozedFiles] = useState(() => readSnoozedImportFiles());
  const snoozedFileIds = useMemo(() => new Set(Object.keys(snoozedFiles)), [snoozedFiles]);
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
    <section className={`panel-subsection import-inbox-section ${hasRequiredFiles ? "has-work" : "is-current"}`}>
      <div className="import-inbox-header">
        <div className="section-head">
          <h3>{messages.imports.inboxTitle}</h3>
          <span className="panel-context">{messages.imports.inboxDetail}</span>
        </div>
        <ImportInboxStatusPill inbox={inbox} />
      </div>

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
    </section>
  );
}

export function ImportIntakeQueueSection({
  items,
  summary,
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
            {items.map((item) => (
              <div key={item.id} className={`import-intake-row is-${item.matchStatus}${item.duplicate ? " is-duplicate" : ""}`}>
                <div className="import-intake-main">
                  <strong>{item.sourceLabel || item.fileName}</strong>
                  <span>{messages.imports.intakeRowDetail({
                    fileName: item.fileName,
                    rowCount: item.rowCount,
                    checkpointCount: item.checkpointCount,
                    parserKey: item.parserKey
                  })}</span>
                  <span>{getIntakeStatusLabel(item)}</span>
                </div>
                <div className="import-intake-actions">
                  <button
                    type="button"
                    className="subtle-action"
                    onClick={() => onLoadItem(item)}
                    disabled={item.duplicate}
                  >
                    {messages.imports.intakeLoad}
                  </button>
                  <button type="button" className="subtle-action" onClick={() => onRemoveItem(item.id)}>
                    {messages.imports.intakeRemove}
                  </button>
                </div>
              </div>
            ))}
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

function ImportInboxStatusPill({ inbox }) {
  if (inbox.summary.requiredFileCount > 0) {
    return (
      <span className="pill warning">
        {messages.imports.inboxNeedsFiles(inbox.summary.requiredFileCount)}
      </span>
    );
  }

  if (inbox.summary.optionalFileCount > 0) {
    return (
      <span className="pill neutral">
        {messages.imports.inboxOptionalFiles(inbox.summary.optionalFileCount)}
      </span>
    );
  }

  return <span className="pill success">{messages.imports.inboxAllCurrent}</span>;
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

function ImportInboxSession({ session, snoozedFileIds, onSelectExpectedFile, onSnoozeFile }) {
  const requiredFiles = session.expectedFiles.filter((file) => file.priority === "required");
  const optionalFiles = session.expectedFiles.filter((file) => file.priority === "optional");

  return (
    <section className="import-inbox-session">
      <div className="import-inbox-session-head">
        <div>
          <strong>{session.institution}</strong>
          <span>{messages.imports.inboxSessionDetail(session.requiredFileCount, session.optionalFileCount)}</span>
        </div>
        <div className="import-inbox-session-actions">
          {session.portalUrl ? (
            <a className="subtle-action" href={session.portalUrl} target="_blank" rel="noreferrer">
              {messages.imports.inboxOpenPortal}
            </a>
          ) : null}
          <span className={`pill ${session.status === "needs_files" ? "warning" : "neutral"}`}>
            {session.status === "needs_files" ? messages.imports.inboxSessionNeedsFiles : messages.imports.inboxSessionOptional}
          </span>
        </div>
      </div>

      {session.downloadInstructions.length ? (
        <ol className="import-inbox-instructions">
          {session.downloadInstructions.map((instruction) => (
            <li key={instruction}>{instruction}</li>
          ))}
        </ol>
      ) : null}

      <div className="import-inbox-file-list">
        {requiredFiles.map((file) => (
          <ImportInboxFileRow
            key={file.id}
            file={file}
            isSnoozed={snoozedFileIds.has(file.id)}
            onSelectExpectedFile={onSelectExpectedFile}
            onSnoozeFile={onSnoozeFile}
          />
        ))}
        {optionalFiles.length ? (
          <details className="import-inbox-optional-files">
            <summary>{messages.imports.inboxOptionalSection(optionalFiles.length)}</summary>
            {optionalFiles.map((file) => (
              <ImportInboxFileRow
                key={file.id}
                file={file}
                isSnoozed={snoozedFileIds.has(file.id)}
                onSelectExpectedFile={onSelectExpectedFile}
                onSnoozeFile={onSnoozeFile}
              />
            ))}
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ImportInboxFileRow({ file, isSnoozed, onSelectExpectedFile, onSnoozeFile }) {
  return (
    <div className={`import-inbox-file-row ${isSnoozed ? "is-snoozed" : ""}`}>
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
    const today = new Date().toISOString().slice(0, 10);
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
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return date.toISOString().slice(0, 10);
}
