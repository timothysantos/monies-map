import * as Dialog from "@radix-ui/react-dialog";
import { InlineError } from "./ui-states";

// Asks an unlinked login which household profile it belongs to. Modal
// because it interrupts only when the shell has no identity mapping. App,
// the identity owner, keeps the draft, the submit handler and the rule for
// which name a chosen profile suggests.
export function LoginRegistrationDialog({ draft, people, error, isSubmitting, onSubmit, onPersonChange, onNameChange }) {
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content login-registration-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
          <form onSubmit={onSubmit}>
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>Set up this login</Dialog.Title>
                <Dialog.Description>
                  Link {draft.email} to one household profile. This lets Splits open on your view next time.
                </Dialog.Description>
              </div>
            </div>
            <div className="login-registration-form">
              <label>
                <span>Household profile</span>
                <select
                  className="table-edit-input"
                  value={draft.personId}
                  enterKeyHint="next"
                  onChange={(event) => onPersonChange(event.target.value)}
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Display name</span>
                <input
                  className="table-edit-input"
                  value={draft.name}
                  placeholder="Name for this household profile"
                  enterKeyHint="done"
                  onChange={(event) => onNameChange(event.target.value)}
                />
              </label>
            </div>
            <InlineError message={error} />
            <div className="note-dialog-actions">
              <button type="submit" className="dialog-primary" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save login"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
