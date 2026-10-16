import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { lazy, Suspense, useRef } from "react";

import { useRouteWorkBusy } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";

// Where the one category list opens (design.md "Category list"): a popover
// under `anchor` on a wide screen, the picker sheet on a phone. This file is
// first-screen code and stays tiny; the list, its search, the best-guess
// request and their styles are lazy chunks fetched only when a list opens.
//
// `anchor` is one DOM element (the trigger, or a Detail row's wrapper); a
// phone ignores it and draws it as it is. A trigger that lives elsewhere in
// the tree (an Entries row's label) passes `anchorRef` instead. `onChoose(value)` makes the change
// and may return a promise: `{ ok: false, error }` or a throw keeps the list
// open with the error, anything else closes a single choice. Closing returns
// focus to `returnFocusRef`'s element, else to what had focus when it opened.
const PickerSheet = lazy(() => import("./picker-sheet"));
const CategoryPopoverContent = lazy(() => import("./category-popover-content"));

/**
 * @param {{
 *   open: boolean, onOpenChange: (open: boolean) => void, anchor?: any, anchorRef?: { current: any },
 *   title: string, options: Array<{ value: string, label: string, icon?: any, iconKey?: string, colorHex?: string }>,
 *   value?: string | string[], multiple?: boolean, pinned?: Array<{ value: string, label: string }>,
 *   description?: string, searchLabel?: string, searchPlaceholder?: string,
 *   onChoose: (value: string) => any, onClear?: () => void,
 *   returnFocusRef?: { current: any }
 * }} props
 */
export function CategoryPickerHost({
  open,
  onOpenChange,
  anchor = null,
  anchorRef = undefined,
  title,
  options,
  value = "",
  multiple = false,
  pinned = undefined,
  description = "",
  searchLabel = undefined,
  searchPlaceholder = undefined,
  onChoose,
  onClear = undefined,
  returnFocusRef = undefined
}) {
  const isMobile = useIsMobileLayout();
  const openerRef = useRef(null);
  const wasOpen = useRef(false);
  // What had focus the moment the list opened (before the list takes it).
  if (open && !wasOpen.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement;
  }
  wasOpen.current = open;
  // An open list blocks optional route work, like every picker.
  useRouteWorkBusy(open);
  const close = () => onOpenChange(false);
  // The focus target may be a wrapper (a Detail row's span): focus its button.
  const baseTarget = returnFocusRef ?? openerRef;
  const focusTarget = {
    get current() {
      const element = baseTarget.current;
      const target = element?.matches?.("button, input, select, a, [tabindex]") ? element : element?.querySelector?.("button");
      return target ?? null;
    }
  };
  const restoreFocus = () => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      focusTarget.current?.focus?.({ preventScroll: true });
    }
  };

  if (isMobile) {
    return (
      <>
        {anchor}
        <Dialog.Root
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            if (!next) {
              window.requestAnimationFrame(restoreFocus);
            }
          }}
        >
          {open ? (
            <Suspense fallback={null}>
              <PickerSheet
                title={title}
                description={`Choose a value for ${title.toLowerCase()}.`}
                closeLabel={`Close ${title.toLowerCase()}`}
                options={options}
                selectedValues={multiple ? value : [value]}
                multiple={multiple}
                categoryPick={{ description, pinned, searchLabel, searchPlaceholder }}
                onChoose={onChoose}
                onClear={onClear}
                onClose={close}
              />
            </Suspense>
          ) : null}
        </Dialog.Root>
      </>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {anchorRef ? <Popover.Anchor virtualRef={anchorRef} /> : <Popover.Anchor asChild>{anchor}</Popover.Anchor>}
      {open ? (
        <Suspense fallback={null}>
          <CategoryPopoverContent
            restoreFocus={restoreFocus}
            options={options}
            value={value}
            multiple={multiple}
            pinned={pinned}
            description={description}
            searchLabel={searchLabel}
            searchPlaceholder={searchPlaceholder}
            onChoose={onChoose}
            onClear={onClear}
            onClose={close}
          />
        </Suspense>
      ) : null}
    </Popover.Root>
  );
}
