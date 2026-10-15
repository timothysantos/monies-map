import * as Popover from "@radix-ui/react-popover";

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
/** @param {any} props */
export default function CategoryPopoverContent({ restoreFocus, onClose, onClear = undefined, ...listProps }) {
  return (
    <Popover.Portal>
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
    </Popover.Portal>
  );
}
