import { Link2 } from "lucide-react";

import { SheetDialog } from "./sheet-dialog";
import { LeadCard } from "./ui/lead-support-detail";

function formatNotePreview(value) {
  const note = value?.trim();
  return note || "No note saved.";
}

function formatPromptValue(prompt, key) {
  if (prompt.valueFormatter) {
    return prompt.valueFormatter(prompt[key]);
  }

  return formatNotePreview(prompt[key]);
}

// "Update connected note?": a note was changed on a record that is connected
// to another (an entry and its split). The lead is the question; the two notes
// sit side by side as quiet panels; Cancel is at the start of the bottom bar,
// "Save only this" beside the primary "Update both" at the end.
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
  const help = prompt.helpText ?? "Choose \"Update both\" when the note is a shared explanation for the same real-world item. Choose \"Save only this\" when the connected record needs a different note.";

  return (
    <SheetDialog
      className="linked-note-sync-dialog is-three-actions"
      title={prompt.title ?? "Update connected note?"}
      description={prompt.description}
      descriptionHidden
      closeLabel="Close"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: Link2 }}
          title={prompt.title ?? "Update connected note?"}
        >
          <p className="lsd-note">{prompt.description}</p>
        </LeadCard>
      )}
      errorMessage={prompt.error}
      primaryLabel={isSubmitting ? "Updating..." : "Update both"}
      primaryDisabled={isSubmitting}
      secondary={(
        <button type="button" className="lsd-secondary" disabled={isSubmitting} onClick={onSaveOnly}>
          {isSubmitting ? "Saving..." : "Save only this"}
        </button>
      )}
      isSubmitting={isSubmitting}
      onSubmit={onUpdateBoth}
      onClose={onCancel}
    >
      <div className="linked-note-sync-grid">
        <section className="linked-note-sync-panel">
          <h4>{prompt.editedLabel}</h4>
          <p>{formatPromptValue(prompt, "editedValue")}</p>
        </section>
        <section className="linked-note-sync-panel">
          <h4>{prompt.connectedLabel}</h4>
          <p>{formatPromptValue(prompt, "connectedValue")}</p>
        </section>
      </div>
      <p className="lsd-note">{help}</p>
    </SheetDialog>
  );
}
