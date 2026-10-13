import { messages } from "./copy/en-SG";
import { NoteSheetDialog } from "./note-sheet-dialog";

// The Monthly Note dialog, shared by Month and Summary. Summary loads it on
// demand (React.lazy), because the Summary route is on the first screen.
export default function MonthNoteDialog({ monthLabel, value, onChange, errorMessage = "", isSaving = false, onSave, onClose }) {
  return (
    <NoteSheetDialog
      title={messages.month.notesTitle}
      description={messages.month.notesDetail}
      leadTitle={monthLabel}
      leadSubtitle={messages.month.notesTitle}
      value={value}
      onChange={onChange}
      errorMessage={errorMessage}
      isSaving={isSaving}
      saveLabel={isSaving ? messages.common.saving : messages.month.doneEdit}
      cancelLabel={messages.month.cancelEdit}
      closeLabel="Close month note editor"
      onSave={onSave}
      onClose={onClose}
    />
  );
}
