import { Landmark, SquarePen } from "lucide-react";

import { messages } from "./copy/en-SG";
import { settingsMessages } from "./copy/en-SG-settings";
import { DateRow } from "./detail-field-rows";
import { selectAllOnFocus } from "./focus-utils";
import { formatDateOnly, formatMonthLabel } from "./formatters";
import { moneyToneClass } from "./money-tone-class";
import { SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";
import { useIsMobileLayout } from "./use-viewport";
import { statementDifferenceTone } from "../domain/money-tone";

// Checkpoint editing has its own dialog because it also owns history review
// actions like export, compare, and delete.
export function SettingsReconciliationDialog({
  dialog,
  isSubmitting,
  checkpointHistoryYears,
  checkpointHistoryYear,
  visibleCheckpointHistory,
  onChange,
  onHistoryYearChange,
  onClose,
  onSave,
  onEditCheckpoint,
  onDownloadCheckpoint,
  onCompareCheckpoint,
  renderCheckpointDeleteAction,
  formatCheckpointMonth,
  formatCheckpointCoverage,
  formatCheckpointBalanceLine,
  formatCheckpointDelta
}) {
  const isSheet = useIsMobileLayout();
  const isDirty = useDraftChanged(dialog, pickCheckpointFields);
  if (!dialog) {
    return null;
  }
  const set = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const monthLabel = dialog.checkpointMonth ? formatMonthLabel(dialog.checkpointMonth) : null;
  const dateLabel = (value) => (value ? formatDateOnly(value) : "");

  return (
    <SheetDialog
      wide
      className="settings-account-dialog statement-checkpoint-dialog"
      title={settingsMessages.reconcileAccountTitle}
      description={settingsMessages.reconcileAccountDetail}
      descriptionHidden
      closeLabel="Close reconciliation dialog"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: Landmark }}
          title={dialog.accountName ?? ""}
          subtitle={settingsMessages.reconcileAccountTitle}
          chips={(
            <>
              {monthLabel ? <MetaChip>{monthLabel}</MetaChip> : null}
              {dialog.statementStartDate && dialog.statementEndDate
                ? <MetaChip>{`${dateLabel(dialog.statementStartDate)} to ${dateLabel(dialog.statementEndDate)}`}</MetaChip>
                : null}
            </>
          )}
        >
          <p className="lsd-note">{settingsMessages.reconcileAccountDetail}</p>
        </LeadCard>
      )}
      primaryLabel={isSubmitting ? messages.common.saving : settingsMessages.checkpointSave}
      primaryDisabled={!dialog.checkpointMonth?.trim() || isSubmitting}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={onSave}
      onClose={onClose}
    >
      <DetailRows label={settingsMessages.reconcileAccountTitle}>
        <DetailRow label={settingsMessages.checkpointMonth}>
          <input
            type="month"
            value={dialog.checkpointMonth ?? ""}
            enterKeyHint="next"
            onChange={(event) => set({ checkpointMonth: event.target.value })}
          />
        </DetailRow>
        <DateRow
          isSheet={isSheet}
          rowKey="start"
          label={settingsMessages.checkpointStartDate}
          value={dialog.statementStartDate ?? ""}
          valueLabel={dateLabel(dialog.statementStartDate)}
          onValueChange={(statementStartDate) => set({ statementStartDate })}
        />
        <DateRow
          isSheet={isSheet}
          rowKey="end"
          label={settingsMessages.checkpointEndDate}
          value={dialog.statementEndDate ?? ""}
          valueLabel={dateLabel(dialog.statementEndDate)}
          onValueChange={(statementEndDate) => set({ statementEndDate })}
        />
        <DetailRow label={settingsMessages.checkpointBalance}>
          <input
            inputMode="decimal"
            value={dialog.statementBalance ?? "0.00"}
            enterKeyHint="done"
            onMouseDown={selectAllOnFocus}
            onFocus={selectAllOnFocus}
            onChange={(event) => set({ statementBalance: event.target.value })}
          />
        </DetailRow>
        <DetailRow label={settingsMessages.checkpointNote}>
          <textarea
            rows={1}
            value={dialog.note ?? ""}
            onChange={(event) => set({ note: event.target.value })}
          />
        </DetailRow>
      </DetailRows>
      <p className="lsd-note">{settingsMessages.checkpointHelp}</p>
      {dialog.history?.length ? (
        <SettingsCheckpointHistory
          isSubmitting={isSubmitting}
          checkpointHistoryYears={checkpointHistoryYears}
          checkpointHistoryYear={checkpointHistoryYear}
          visibleCheckpointHistory={visibleCheckpointHistory}
          onHistoryYearChange={onHistoryYearChange}
          onEditCheckpoint={onEditCheckpoint}
          onDownloadCheckpoint={onDownloadCheckpoint}
          onCompareCheckpoint={onCompareCheckpoint}
          renderCheckpointDeleteAction={renderCheckpointDeleteAction}
          formatCheckpointMonth={formatCheckpointMonth}
          formatCheckpointCoverage={formatCheckpointCoverage}
          formatCheckpointBalanceLine={formatCheckpointBalanceLine}
          formatCheckpointDelta={formatCheckpointDelta}
        />
      ) : null}
    </SheetDialog>
  );
}

// The fields a person edits; the history list does not count as a change.
function pickCheckpointFields(dialog) {
  return {
    checkpointMonth: dialog.checkpointMonth,
    statementStartDate: dialog.statementStartDate,
    statementEndDate: dialog.statementEndDate,
    statementBalance: dialog.statementBalance,
    note: dialog.note
  };
}

function SettingsCheckpointHistory({
  isSubmitting,
  checkpointHistoryYears,
  checkpointHistoryYear,
  visibleCheckpointHistory,
  onHistoryYearChange,
  onEditCheckpoint,
  onDownloadCheckpoint,
  onCompareCheckpoint,
  renderCheckpointDeleteAction,
  formatCheckpointMonth,
  formatCheckpointCoverage,
  formatCheckpointBalanceLine,
  formatCheckpointDelta
}) {
  return (
    <section className="settings-account-history">
      <div className="panel-subhead">
        <h3>{settingsMessages.checkpointHistoryTitle}</h3>
        <p>{settingsMessages.checkpointHistoryDetail}</p>
      </div>
      {checkpointHistoryYears.length > 1 ? (
        <div className="settings-checkpoint-year-filter">
          {checkpointHistoryYears.map((year) => (
            <button
              key={year}
              type="button"
              className={`summary-focus-button ${checkpointHistoryYear === year ? "is-active" : ""}`}
              onClick={() => onHistoryYearChange(year)}
            >
              {year}
            </button>
          ))}
        </div>
      ) : null}
      <div className="settings-account-list">
        {visibleCheckpointHistory.map((item) => (
          <div key={item.month} className="settings-account-row settings-checkpoint-row">
            <div className="settings-account-main">
              <strong>{formatCheckpointMonth(item)}</strong>
              <p>{formatCheckpointCoverage(item)}</p>
              <p>{formatCheckpointBalanceLine(item)}</p>
              <div className="settings-checkpoint-delta-line">
                <p className={`settings-account-health ${moneyToneClass(statementDifferenceTone(item.deltaMinor))}`}>
                  {formatCheckpointDelta(item)}
                </p>
                {item.deltaMinor !== 0 ? (
                  <>
                    <button
                      type="button"
                      className="settings-checkpoint-export"
                      disabled={isSubmitting}
                      onClick={() => void onDownloadCheckpoint(item)}
                    >
                      {settingsMessages.checkpointExport}
                    </button>
                    <button
                      type="button"
                      className="settings-checkpoint-export"
                      disabled={isSubmitting}
                      onClick={() => onCompareCheckpoint(item)}
                    >
                      {settingsMessages.statementCompareOpen}
                    </button>
                  </>
                ) : null}
              </div>
              {item.note ? <p className="settings-account-meta">{item.note}</p> : null}
            </div>
            <div className="settings-account-actions">
              <button type="button" className="icon-action" aria-label={settingsMessages.checkpointEdit} onClick={() => onEditCheckpoint(item)}>
                <SquarePen size={16} />
              </button>
              {renderCheckpointDeleteAction(item)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
