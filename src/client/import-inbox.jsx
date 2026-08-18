import { CheckCircle2, CircleAlert, Clock3, FileText, Landmark, ListChecks } from "lucide-react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

const { format: formatService } = moniesClient;

export function ImportInboxSection({
  inbox,
  onSelectExpectedFile
}) {
  if (!inbox) {
    return null;
  }

  const requiredSessions = inbox.sessions.filter((session) => session.status !== "current");
  const currentSessions = inbox.sessions.filter((session) => session.status === "current");
  const hasRequiredFiles = inbox.summary.requiredFileCount > 0;

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
              onSelectExpectedFile={onSelectExpectedFile}
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
              <li key={file.id}>{messages.imports.inboxReviewOrderItem(
                formatService.formatMonthLabel(file.periodMonth),
                file.accountName,
                file.priority
              )}</li>
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
              <span key={account.accountId}>{account.accountName}</span>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
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

function ImportInboxSession({ session, onSelectExpectedFile }) {
  const requiredFiles = session.expectedFiles.filter((file) => file.priority === "required");
  const optionalFiles = session.expectedFiles.filter((file) => file.priority === "optional");

  return (
    <section className="import-inbox-session">
      <div className="import-inbox-session-head">
        <div>
          <strong>{session.institution}</strong>
          <span>{messages.imports.inboxSessionDetail(session.requiredFileCount, session.optionalFileCount)}</span>
        </div>
        <span className={`pill ${session.status === "needs_files" ? "warning" : "neutral"}`}>
          {session.status === "needs_files" ? messages.imports.inboxSessionNeedsFiles : messages.imports.inboxSessionOptional}
        </span>
      </div>

      <div className="import-inbox-file-list">
        {requiredFiles.map((file) => (
          <ImportInboxFileRow key={file.id} file={file} onSelectExpectedFile={onSelectExpectedFile} />
        ))}
        {optionalFiles.length ? (
          <details className="import-inbox-optional-files">
            <summary>{messages.imports.inboxOptionalSection(optionalFiles.length)}</summary>
            {optionalFiles.map((file) => (
              <ImportInboxFileRow key={file.id} file={file} onSelectExpectedFile={onSelectExpectedFile} />
            ))}
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ImportInboxFileRow({ file, onSelectExpectedFile }) {
  return (
    <div className="import-inbox-file-row">
      <div className="import-inbox-file-main">
        <strong>{file.label}</strong>
        <span>{messages.imports.inboxFileDetail(
          file.detail,
          file.supportedFileTypes.join(", ")
        )}</span>
      </div>
      <button type="button" className="subtle-action" onClick={() => onSelectExpectedFile(file)}>
        {messages.imports.inboxUseFile}
      </button>
    </div>
  );
}
