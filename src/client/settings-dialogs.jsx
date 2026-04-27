import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { CategoryEditDialog } from "./category-edit-dialog";
import { messages } from "./copy/en-SG";
import { ACCOUNT_KIND_OPTIONS } from "./ui-options";

// Settings dialogs receive draft objects from SettingsPanel; save handlers stay
// in the panel because they own API calls and refresh sequencing.
export function SettingsPersonDialog({ dialog, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
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
              disabled={isSubmitting}
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
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.name?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {isSubmitting ? messages.common.saving : messages.settings.savePerson}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettingsCategoryDialog({ dialog, isSubmitting, onChange, onClose, onSave }) {
  return <CategoryEditDialog dialog={dialog} isSubmitting={isSubmitting} onChange={onChange} onClose={onClose} onSave={onSave} />;
}

export function SettingsAccountDialog({ dialog, error, people, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
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
              disabled={isSubmitting}
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
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.name?.trim() || !dialog?.institution?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {isSubmitting ? messages.common.saving : dialog?.mode === "create" ? messages.settings.createAccount : messages.settings.saveAccount}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SettingsCategoryMatchRuleDialog({ dialog, categories, isSubmitting, onChange, onClose, onSave }) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{dialog?.mode === "create" ? messages.settings.createCategoryRule : messages.settings.editCategoryRule}</Dialog.Title>
              <Dialog.Description>{messages.settings.categoryRuleDialogDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close category matching rule dialog"
              disabled={isSubmitting}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="settings-account-form">
            <label className="table-edit-field">
              <span>{messages.settings.categoryRulePattern}</span>
              <input
                className="table-edit-input"
                value={dialog?.pattern ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, pattern: event.target.value } : current)}
                placeholder="SINGLIFE"
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryRuleCategory}</span>
              <select
                className="table-edit-input"
                value={dialog?.categoryId ?? categories[0]?.id ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, categoryId: event.target.value } : current)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryRulePriority}</span>
              <input
                className="table-edit-input table-edit-input-money"
                type="number"
                value={dialog?.priority ?? 100}
                onChange={(event) => onChange((current) => current ? { ...current, priority: Number(event.target.value) } : current)}
              />
              <small className="field-help">{messages.settings.categoryRulePriorityHelp}</small>
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryRuleStatus}</span>
              <select
                className="table-edit-input"
                value={dialog?.isActive === false ? "inactive" : "active"}
                onChange={(event) => onChange((current) => current ? { ...current, isActive: event.target.value === "active" } : current)}
              >
                <option value="active">{messages.settings.categoryRuleActive}</option>
                <option value="inactive">{messages.settings.categoryRuleInactive}</option>
              </select>
            </label>
            <label className="table-edit-field settings-form-wide">
              <span>{messages.settings.categoryRuleNote}</span>
              <textarea
                className="table-edit-input"
                value={dialog?.note ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, note: event.target.value } : current)}
              />
            </label>
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.pattern?.trim() || !dialog?.categoryId || isSubmitting}
              onClick={() => void onSave()}
            >
              {isSubmitting ? messages.common.saving : messages.settings.saveCategoryRule}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
