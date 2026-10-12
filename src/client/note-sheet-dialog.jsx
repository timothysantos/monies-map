import { NotebookPen } from "lucide-react";
import { useRef } from "react";

import { SheetDialog } from "./sheet-dialog";
import { LeadCard } from "./ui/lead-support-detail";

// The note dialogs (a plan row's note, the month's note, the Summary month
// note) share one shape: the lead says whose note it is, the note is the one
// field, and Cancel and Done sit in the bottom bar. The sheet asks before
// dropping a changed note (`isDirty` is the text against what it opened with).
export function NoteSheetDialog({
  title,
  description,
  leadTitle,
  leadSubtitle = null,
  value,
  onChange,
  errorMessage = "",
  isSaving = false,
  saveLabel,
  cancelLabel,
  closeLabel,
  onSave,
  onClose
}) {
  const openedWith = useRef(value);
  return (
    <SheetDialog
      className="note-sheet-dialog"
      title={title}
      description={description}
      descriptionHidden
      closeLabel={closeLabel}
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: NotebookPen }}
          title={leadTitle}
          subtitle={leadSubtitle}
        >
          <p className="lsd-note">{description}</p>
        </LeadCard>
      )}
      errorMessage={errorMessage}
      primaryLabel={saveLabel}
      primaryDisabled={isSaving}
      quietLabel={cancelLabel}
      isSubmitting={isSaving}
      isDirty={value !== openedWith.current}
      onSubmit={onSave}
      onClose={onClose}
    >
      <textarea
        className="sheet-dialog-note"
        aria-label={title}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={8}
        enterKeyHint="done"
      />
    </SheetDialog>
  );
}
