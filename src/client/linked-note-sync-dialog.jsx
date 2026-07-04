import * as Dialog from "@radix-ui/react-dialog";

function formatNotePreview(value) {
  const note = value?.trim();
  return note || "No note saved.";
}

export function LinkedNoteSyncDialog({
  prompt,
  isSubmitting = false,
  onCancel,
  onSaveOnly,
  onUpdateBoth
}) {
  if (!prompt) {
    return null;
  }

  return (
    <Dialog.Root open={Boolean(prompt)} onOpenChange={(open) => { if (!open && !isSubmitting) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content linked-note-sync-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>Update connected note?</Dialog.Title>
              <Dialog.Description>{prompt.description}</Dialog.Description>
            </div>
          </div>

          <div className="linked-note-sync-grid">
            <section className="linked-note-sync-panel">
              <h4>{prompt.editedLabel}</h4>
              <p>{formatNotePreview(prompt.editedNote)}</p>
            </section>
            <section className="linked-note-sync-panel">
              <h4>{prompt.connectedLabel}</h4>
              <p>{formatNotePreview(prompt.connectedNote)}</p>
            </section>
          </div>

          <p className="linked-note-sync-help">
            Choose "Update both" when the note is a shared explanation for the same real-world item. Choose "Save only this" when the connected record needs a different note.
          </p>

          {prompt.error ? <p className="form-error">{prompt.error}</p> : null}

          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onCancel}>Cancel</button>
            <button type="button" className="subtle-action" disabled={isSubmitting} onClick={onSaveOnly}>
              {isSubmitting ? "Saving..." : "Save only this"}
            </button>
            <button type="button" className="dialog-primary" disabled={isSubmitting} onClick={onUpdateBoth}>
              {isSubmitting ? "Updating..." : "Update both"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
