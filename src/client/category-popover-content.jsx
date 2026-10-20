import * as Popover from "@radix-ui/react-popover";
import { RemoveScroll } from "react-remove-scroll";

import CategoryPickList from "./category-pick-list";

// The wide screen's category list: a popover under its trigger holding the
// shared list (category-pick-list.jsx). Loaded when a list opens, inside the
// caller's Popover.Root (category-picker-host.jsx).
//
// Radix would focus the first focusable thing on open; the list decides for
// itself (a mouse and keyboard device focuses its search, a touch device does
// not), so Radix's own move is cancelled. Closing returns focus to the opener,
// which is not a Popover.Trigger here.
// A filter (several choices) keeps the popover open and ends with Clear and Done.
//
// Opened inside a dialog or sheet (`insideDialog`), the popover takes the
// scroll lock while it is open. The dialog's lock (entry-mobile-sheet.jsx,
// Radix's modal dialogs) cancels every wheel and touch scroll outside the
// dialog, and the popover is portalled outside it, so without its own lock the
// list could not be scrolled with a mouse wheel or trackpad and its last
// categories were out of reach. Only the top lock acts, so the dialog's lock
// returns when the popover closes. It leaves the scrollbar and <body> styles
// alone. Outside a dialog nothing blocks scrolling and no lock is taken.
/** @param {any} props */
export default function CategoryPopoverContent({ restoreFocus, onClose, onClear = undefined, insideDialog = false, ...listProps }) {
  return (
    <Popover.Portal>
      <RemoveScroll enabled={insideDialog} forwardProps removeScrollBar={false} allowPinchZoom>
        <Popover.Content
          className="category-popover"
          sideOffset={8}
          align="start"
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus?.();
          }}
        >
          <CategoryPickList {...listProps} variant="popover" onClose={onClose} />
          {listProps.multiple ? (
            <div className="category-popover-actions">
              <button type="button" className="subtle-action" onClick={onClear}>Clear</button>
              <button type="button" className="subtle-action" onClick={onClose}>Done</button>
            </div>
          ) : null}
        </Popover.Content>
      </RemoveScroll>
    </Popover.Portal>
  );
}
