import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown } from "lucide-react";
import { lazy, Suspense, useId, useMemo, useRef, useState } from "react";
// The phone picker sheet loads when a picker opens: this module is first-screen code.
const PickerSheet = lazy(() => import("./picker-sheet"));
import { CategoryPickerHost } from "./category-picker-host";
import { useRouteWorkBusy } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";

export function ResponsiveSelect({
  value,
  options,
  onValueChange,
  title,
  className = "table-edit-input",
  disabled = false,
  open = undefined,
  onOpenChange = undefined,
  hideMobileTrigger = false,
  // The id of a visible label (a Detail row's). The native select is named
  // by it; the phone trigger by it and its value ("Category Savings"), so a
  // label around the trigger cannot hide the value it shows.
  labelId = undefined,
  // A list of categories: the shared category list (search, best guess first)
  // instead of the native select and the plain sheet. `description` is the
  // entry's text the best guess is for; `pinned` rows (All categories) stay
  // above the list. onValueChange may return a promise (see category-picker-host.jsx).
  categoryPick = undefined
}) {
  const triggerRef = useRef(null);
  const useMobilePicker = useIsMobileLayout();
  const valueId = useId();
  const [isOpenInternal, setIsOpenInternal] = useState(false);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? null,
    [options, value]
  );
  const isControlledOpen = typeof open === "boolean";
  const isOpen = isControlledOpen ? open : isOpenInternal;
  // An open mobile picker sheet covers the page, so it blocks optional work.
  useRouteWorkBusy(isOpen);

  function updateOpen(nextOpen) {
    if (!isControlledOpen) {
      setIsOpenInternal(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }

  if (categoryPick) {
    const trigger = hideMobileTrigger ? <span /> : (
      <button
        ref={triggerRef}
        type="button"
        className={`${className} responsive-select-trigger`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
        aria-label={labelId ? undefined : `${title}, ${selectedOption?.label ?? ""}`}
        onClick={() => updateOpen(!isOpen)}
      >
        <span id={valueId} className="responsive-select-value">{selectedOption?.label ?? ""}</span>
        <ChevronDown size={18} />
      </button>
    );
    return (
      <CategoryPickerHost
        open={isOpen}
        onOpenChange={updateOpen}
        anchor={trigger}
        returnFocusRef={hideMobileTrigger ? undefined : triggerRef}
        title={title}
        options={options}
        value={value}
        pinned={categoryPick.pinned}
        description={categoryPick.description}
        onChoose={onValueChange}
      />
    );
  }

  if (!useMobilePicker) {
    return (
      <select
        className={className}
        aria-labelledby={labelId}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }

  return (
    <>
      {!hideMobileTrigger ? (
        <button
          type="button"
          className={`${className} responsive-select-trigger`}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
          onClick={(event) => {
            event.currentTarget.blur();
            updateOpen(true);
          }}
        >
          <span id={valueId} className="responsive-select-value">{selectedOption?.label ?? ""}</span>
          <ChevronDown size={18} />
        </button>
      ) : null}
      <Dialog.Root open={isOpen} onOpenChange={updateOpen}>
        {isOpen ? (
          <Suspense fallback={null}>
            <PickerSheet
              title={title}
              description={`Choose a value for ${title.toLowerCase()}.`}
              closeLabel={`Close ${title.toLowerCase()}`}
              options={options}
              selectedValues={[value]}
              onChoose={(next) => {
                onValueChange(next);
                updateOpen(false);
              }}
              onClose={() => updateOpen(false)}
            />
          </Suspense>
        ) : null}
      </Dialog.Root>
    </>
  );
}
