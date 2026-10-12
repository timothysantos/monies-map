import "./picker-sheet.css";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";

import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions } from "./ui/lead-support-detail";

// The phone's picker sheet (design.md, "Lead · Support · Detail"): the title
// and a round close button on top, the options as a list that scrolls under
// them, and the bar at the bottom where the thumb is, with the grab handle
// and swipe down to close. ResponsiveSelect and the Entries multi-select load
// it only when a picker opens (React.lazy), because they are first-screen code.
// It renders inside the caller's own Dialog.Root, which keeps focus, scroll
// lock and focus return exactly as they were.
//
// - Single choice: tapping an option chooses it and closes; the bar has Close.
// - Several choices (`multiple`): options toggle; the bar has Clear and Done.
export default function PickerSheet({
  title,
  description,
  closeLabel,
  options,
  selectedValues,
  multiple = false,
  onChoose,
  onClear = undefined,
  onClose
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="note-dialog-overlay" />
      <Dialog.Content
        className="note-dialog-content split-dialog-content mobile-select-dialog is-picker-sheet"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetSwipeDismiss onClose={onClose} />
        <div className="note-dialog-head mobile-select-head">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          <button
            type="button"
            className="icon-action subtle-cancel mobile-select-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="mobile-select-options" data-sheet-body>
          {options.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`mobile-select-option ${isSelected ? "is-selected" : ""}`}
                aria-pressed={multiple ? isSelected : undefined}
                onClick={() => onChoose(option.value)}
              >
                <span className="mobile-select-option-main">
                  {option.iconKey ? (
                    <span
                      className="mobile-select-option-icon"
                      style={{ "--category-color": option.colorHex ?? "rgba(177, 94, 47, 0.16)" }}
                      aria-hidden="true"
                    >
                      {option.icon}
                    </span>
                  ) : null}
                  <span>{option.label}</span>
                </span>
                {isSelected ? <Check size={18} /> : null}
              </button>
            );
          })}
        </div>
        {multiple ? (
          <BottomActions
            className="is-sheet-bar"
            quietLabel="Clear"
            onQuiet={onClear}
            primary={<button type="button" className="lsd-primary" onClick={onClose}>Done</button>}
          />
        ) : (
          <BottomActions
            className="is-sheet-bar"
            secondary={<button type="button" className="lsd-quiet" onClick={onClose}>Close</button>}
          />
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
