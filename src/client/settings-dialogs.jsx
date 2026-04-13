import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, SquarePen, X } from "lucide-react";
import { messages } from "./copy/en-SG";
import { ACCOUNT_KIND_OPTIONS, COLOR_OPTIONS, FALLBACK_THEME, ICON_OPTIONS } from "./ui-options";

// Settings dialogs receive draft objects from SettingsPanel; save handlers stay
// in the panel because they own API calls and refresh sequencing.
export function SettingsPersonDialog({ dialog, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{messages.settings.editPerson}</Dialog.Title>
              <Dialog.Description>{messages.settings.editPersonDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close person dialog"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="settings-account-form settings-person-form">
            <label className="table-edit-field">
              <span>{messages.settings.personDisplayName}</span>
              <input
                className="table-edit-input"
                value={dialog?.name ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)}
              />
            </label>
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.name?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {messages.settings.savePerson}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettingsCategoryDialog({ dialog, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog settings-category-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{dialog?.mode === "create" ? messages.settings.createCategory : messages.settings.editCategory}</Dialog.Title>
              <Dialog.Description>{dialog?.mode === "create" ? messages.settings.createCategoryDetail : messages.settings.editCategoryDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close category dialog"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="settings-account-form">
            <label className="table-edit-field">
              <span>{messages.settings.categoryName}</span>
              <input
                className="table-edit-input"
                value={dialog?.name ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categorySlug}</span>
              <input
                className="table-edit-input"
                value={dialog?.slug ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, slug: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryIcon}</span>
              <CategoryIconSelector
                value={dialog?.iconKey ?? FALLBACK_THEME.iconKey}
                colorHex={dialog?.colorHex ?? FALLBACK_THEME.colorHex}
                onChange={(iconKey) => onChange((current) => current ? { ...current, iconKey } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryColor}</span>
              <CategoryColorSelector
                value={dialog?.colorHex ?? FALLBACK_THEME.colorHex}
                onChange={(colorHex) => onChange((current) => current ? { ...current, colorHex } : current)}
              />
            </label>
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.name?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {dialog?.mode === "create" ? messages.settings.createCategory : messages.settings.saveCategory}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettingsAccountDialog({ dialog, error, people, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{dialog?.mode === "create" ? messages.settings.createAccount : messages.settings.editAccount}</Dialog.Title>
              <Dialog.Description>{dialog?.mode === "create" ? messages.settings.createAccountDetail : messages.settings.editAccountDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close account dialog"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="settings-account-form">
            <label className="table-edit-field">
              <span>{messages.settings.accountName}</span>
              <input
                className="table-edit-input"
                value={dialog?.name ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.accountInstitution}</span>
              <input
                className="table-edit-input"
                value={dialog?.institution ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, institution: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.accountType}</span>
              <select
                className="table-edit-input"
                value={dialog?.kind ?? "bank"}
                onChange={(event) => onChange((current) => current ? { ...current, kind: event.target.value } : current)}
              >
                {ACCOUNT_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.accountCurrency}</span>
              <input
                className="table-edit-input"
                value={dialog?.currency ?? "SGD"}
                onChange={(event) => onChange((current) => current ? { ...current, currency: event.target.value.toUpperCase() } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.accountOpeningBalance}</span>
              <input
                className="table-edit-input table-edit-input-money"
                value={dialog?.openingBalance ?? "0.00"}
                onChange={(event) => onChange((current) => current ? { ...current, openingBalance: event.target.value } : current)}
              />
              <small className="field-help">{messages.settings.accountOpeningBalanceHelp}</small>
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.accountOwner}</span>
              <select
                className="table-edit-input"
                value={dialog?.isJoint ? "shared" : (dialog?.ownerPersonId || "")}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange((current) => current ? {
                    ...current,
                    isJoint: value === "shared",
                    ownerPersonId: value === "shared" ? "" : value
                  } : current);
                }}
              >
                <option value="shared">Shared</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.name?.trim() || !dialog?.institution?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {dialog?.mode === "create" ? messages.settings.createAccount : messages.settings.saveAccount}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog settings-reconciliation-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{messages.settings.reconcileAccountTitle}</Dialog.Title>
              <Dialog.Description>{messages.settings.reconcileAccountDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close reconciliation dialog"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="settings-account-form settings-reconciliation-form">
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.accountName}</span>
              <input className="table-edit-input" value={dialog?.accountName ?? ""} readOnly />
            </label>
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.checkpointMonth}</span>
              <input
                type="month"
                className="table-edit-input"
                value={dialog?.checkpointMonth ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, checkpointMonth: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.checkpointStartDate}</span>
              <input
                type="date"
                className="table-edit-input"
                value={dialog?.statementStartDate ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, statementStartDate: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field settings-reconciliation-field-half">
              <span>{messages.settings.checkpointEndDate}</span>
              <input
                type="date"
                className="table-edit-input"
                value={dialog?.statementEndDate ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, statementEndDate: event.target.value } : current)}
              />
              <small className="field-help">{messages.settings.checkpointHelp}</small>
            </label>
            <label className="table-edit-field settings-reconciliation-balance-field">
              <span>{messages.settings.checkpointBalance}</span>
              <input
                className="table-edit-input table-edit-input-money"
                value={dialog?.statementBalance ?? "0.00"}
                onChange={(event) => onChange((current) => current ? { ...current, statementBalance: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field settings-reconciliation-note-field">
              <span>{messages.settings.checkpointNote}</span>
              <textarea
                className="table-edit-input"
                rows={4}
                value={dialog?.note ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)}
              />
            </label>
          </div>
          <div className="settings-reconciliation-scroll">
            {dialog?.history?.length ? (
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
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.checkpointMonth?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {messages.settings.checkpointSave}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
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
        <h3>{messages.settings.checkpointHistoryTitle}</h3>
        <p>{messages.settings.checkpointHistoryDetail}</p>
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
                <p className={`settings-account-health ${item.deltaMinor === 0 ? "is-matched" : "is-mismatch"}`}>
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
                      {messages.settings.checkpointExport}
                    </button>
                    <button
                      type="button"
                      className="settings-checkpoint-export"
                      disabled={isSubmitting}
                      onClick={() => onCompareCheckpoint(item)}
                    >
                      {messages.settings.statementCompareOpen}
                    </button>
                  </>
                ) : null}
              </div>
              {item.note ? <p className="settings-account-meta">{item.note}</p> : null}
            </div>
            <div className="settings-account-actions">
              <button type="button" className="icon-action" aria-label={messages.settings.checkpointEdit} onClick={() => onEditCheckpoint(item)}>
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

function CategoryIconSelector({ value, colorHex, onChange }) {
  const selectedOption =
    ICON_OPTIONS.find((option) => option.key === value) ??
    ICON_OPTIONS.find((option) => option.key === FALLBACK_THEME.iconKey) ??
    ICON_OPTIONS[0];
  const SelectedIcon = selectedOption.Icon;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="category-picker-trigger" aria-label={`Select icon. Current icon: ${selectedOption.label}`}>
          <span className="category-picker-value">
            <span className="category-picker-icon-preview" style={{ "--category-color": colorHex }}>
              <SelectedIcon size={18} strokeWidth={2.2} />
            </span>
          </span>
          <ChevronDown size={18} strokeWidth={2.2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-picker-popover" sideOffset={8} align="start">
          <strong className="category-picker-title">Select icon</strong>
          <div className="icon-grid">
            {ICON_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`icon-choice ${value === option.key ? "is-active" : ""}`}
                onClick={() => onChange(option.key)}
                aria-label={option.label}
                title={option.label}
              >
                <option.Icon size={18} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CategoryColorSelector({ value, onChange }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="category-picker-trigger" aria-label={`Select color. Current color: ${value}`}>
          <span className="category-picker-value">
            <span className="category-picker-color-preview" style={{ "--swatch-color": value }} />
          </span>
          <ChevronDown size={18} strokeWidth={2.2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-picker-popover category-color-popover" sideOffset={8} align="start">
          <strong className="category-picker-title">Select color</strong>
          <div className="color-grid">
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-choice ${value === color ? "is-active" : ""}`}
                style={{ "--swatch-color": color }}
                onClick={() => onChange(color)}
                aria-label={color}
                title={color}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
