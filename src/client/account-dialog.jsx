import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { messages } from "./copy/en-SG";
import { ACCOUNT_KIND_OPTIONS } from "./ui-options";

// Account editing is shared between settings and imports, so keep the dialog
// presentational and workflow-agnostic here.
export function AccountDialog({ dialog, error, people, isSubmitting, onChange, onClose, onSave }) {
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
                inputMode="decimal"
                value={dialog?.openingBalance ?? "0.00"}
                onChange={(event) => onChange((current) => current ? { ...current, openingBalance: event.target.value } : current)}
              />
              <small className="field-help">{messages.settings.accountOpeningBalanceHelp}</small>
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.accountOwner}</span>
              <select
                className="table-edit-input"
                value={dialog?.isJoint ? "__joint__" : (dialog?.ownerPersonId ?? "")}
                onChange={(event) => onChange((current) => {
                  if (!current) {
                    return current;
                  }

                  if (event.target.value === "__joint__") {
                    return { ...current, isJoint: true, ownerPersonId: "" };
                  }

                  return { ...current, isJoint: false, ownerPersonId: event.target.value };
                })}
              >
                <option value="__joint__">Shared</option>
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
