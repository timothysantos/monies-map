import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useState } from "react";

import { splitsStripCopy as copy } from "./copy/splits-strip-copy";
import { focusDialogOnOpen } from "./focus-utils";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { useKeyboardInset } from "./use-keyboard-inset";
import { BottomActions, getIconComponent } from "./ui-components";

// The All groups sheet: one row per group with its balance in plain words, in
// the strip's order (owed to you, you owe, Non-group expenses), then a folded
// "N settled groups" row, then Create group, with Done at the bottom. Choosing
// a row opens that group. Swipes down to close on a phone (nothing to lose).
function GroupRow({ row, onChoose }) {
  const Icon = getIconComponent(row.iconKey);
  return (
    <button
      type="button"
      className={`splits-sheet-row ${row.isActive ? "is-active" : ""}`}
      aria-current={row.isActive ? "true" : undefined}
      onClick={() => onChoose(row.id)}
    >
      <span className="splits-sheet-row-icon" aria-hidden="true"><Icon size={18} strokeWidth={2.1} /></span>
      <span className="splits-sheet-row-text">
        <strong>{row.name}</strong>
        <span>{row.balanceLine}</span>
      </span>
      <ChevronRight size={16} aria-hidden="true" className="splits-sheet-row-chevron" />
    </button>
  );
}

export function SplitsGroupsSheet({ open, rows, readOnly = false, onChoose, onCreate, onClose }) {
  const [showSettled, setShowSettled] = useState(false);
  // No text field here, but every sheet with a bottom bar follows the keyboard.
  const [content, setContent] = useState(null);
  useKeyboardInset(content);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          ref={setContent}
          className="note-dialog-content split-dialog-content splits-groups-sheet"
          onOpenAutoFocus={focusDialogOnOpen}
        >
          <SheetSwipeDismiss onClose={onClose} />
          <div className="note-dialog-head splits-sheet-head">
            <Dialog.Title>{copy.allGroups}</Dialog.Title>
            <Dialog.Description className="sr-only">{copy.chooseGroupHint}</Dialog.Description>
            <button type="button" className="splits-sheet-close" aria-label={copy.close} onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="splits-sheet-body" data-sheet-body>
            <div className="splits-sheet-list" role="group" aria-label={copy.allGroups}>
              {rows.open.map((row) => <GroupRow key={row.id} row={row} onChoose={onChoose} />)}
              {rows.settled.length ? (
                <>
                  <button
                    type="button"
                    className="splits-sheet-row splits-sheet-fold"
                    aria-expanded={showSettled}
                    onClick={() => setShowSettled((current) => !current)}
                  >
                    <span className="splits-sheet-row-text">
                      <strong>{copy.settledGroups(rows.settled.length)}</strong>
                    </span>
                    <ChevronDown size={16} aria-hidden="true" className="splits-sheet-row-chevron" />
                  </button>
                  {showSettled ? rows.settled.map((row) => <GroupRow key={row.id} row={row} onChoose={onChoose} />) : null}
                </>
              ) : null}
            </div>
            {!readOnly ? (
              <button type="button" className="splits-sheet-create" onClick={onCreate}>
                <Plus size={16} aria-hidden="true" />
                {copy.createGroup}
              </button>
            ) : null}
          </div>
          <BottomActions
            className="is-sheet-bar splits-sheet-actions"
            primaryLabel={copy.done}
            onPrimary={onClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
