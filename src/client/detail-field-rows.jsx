import { useLayoutEffect, useRef, useState } from "react";

import { CategoryPickerHost } from "./category-picker-host";
import { ResponsiveSelect } from "./responsive-select";
import { DetailRow } from "./ui/lead-support-detail";

// Detail rows that change one field, shared by the entry edit card and the
// split expense card (design.md, "Lead · Support · Detail"):
// - in a phone sheet a choice opens the app's picker sheet and a date opens
//   the phone's date picker from a field laid over the row;
// - in a wide layout a choice is a native select over the row and a date a
//   visible inline field, so the keyboard reaches every field in order.

/**
 * @param {{
 *   isSheet: boolean, rowKey: string, label: string, valueLabel: string, value: string,
 *   options: { value: string, label: string }[], onValueChange: (value: string) => void,
 *   open?: boolean, onOpenChange?: (open: boolean) => void, locked?: boolean, disabled?: boolean,
 *   categoryPick?: { description?: string, pinned?: Array<{ value: string, label: string }> }
 * }} props
 *
 * A row for a category passes `categoryPick`: the row opens the shared
 * category list (search, best guess first) in a popover on a wide screen and
 * the picker sheet on a phone, in place of the native select.
 */
export function PickerRow({ isSheet, rowKey, label, valueLabel, value, options, onValueChange, open = false, onOpenChange = () => {}, locked = false, disabled = false, categoryPick = undefined }) {
  if (locked) {
    return <DetailRow label={label} value={valueLabel} state="locked" data-row={rowKey} />;
  }
  if (categoryPick) {
    return (
      <CategoryRowPicker
        label={label}
        rowKey={rowKey}
        valueLabel={valueLabel}
        value={value}
        options={options}
        onValueChange={onValueChange}
        categoryPick={categoryPick}
        disabled={disabled}
        externalOpen={open}
        onExternalOpenChange={onOpenChange}
      />
    );
  }
  if (isSheet) {
    return (
      <span className="lsd-row-group">
        <DetailRow label={label} value={valueLabel} data-row={rowKey} aria-haspopup="dialog" disabled={disabled} onClick={() => onOpenChange(true)} />
        <ResponsiveSelect
          hideMobileTrigger
          title={label}
          value={value}
          options={options}
          open={open}
          onOpenChange={onOpenChange}
          onValueChange={(next) => {
            onValueChange(next);
            onOpenChange(false);
          }}
        />
      </span>
    );
  }
  return (
    <DetailRow label={label} value={valueLabel} data-row={rowKey}>
      <select className="lsd-row-native" aria-label={label} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </DetailRow>
  );
}

function CategoryRowPicker({ label, rowKey, valueLabel, value, options, onValueChange, categoryPick, disabled, externalOpen, onExternalOpenChange }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const rowRef = useRef(null);
  // Open from the row itself, or from the caller's own open state.
  const open = ownOpen || externalOpen;
  const setOpen = (next) => {
    setOwnOpen(next);
    onExternalOpenChange(next);
  };
  return (
    <CategoryPickerHost
      open={open}
      onOpenChange={setOpen}
      returnFocusRef={rowRef}
      title={label}
      options={options}
      value={value}
      pinned={categoryPick.pinned}
      description={categoryPick.description}
      onChoose={onValueChange}
      anchor={(
        <span className="lsd-row-group" ref={rowRef}>
          <DetailRow label={label} value={valueLabel} data-row={rowKey} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)} />
        </span>
      )}
    />
  );
}

/**
 * @param {{
 *   isSheet: boolean, rowKey: string, label: string, value: string | undefined, valueLabel: string,
 *   onValueChange: (value: string) => void, locked?: boolean
 * }} props
 */
export function DateRow({ isSheet, rowKey, label, value, valueLabel, onValueChange, locked = false }) {
  if (locked) {
    return <DetailRow label={label} value={valueLabel} state="locked" data-row={rowKey} />;
  }
  if (isSheet) {
    return (
      <DetailRow label={label} value={valueLabel} state={value ? undefined : "empty"} data-row={rowKey}>
        <input
          className="lsd-row-native"
          type="date"
          aria-label={label}
          value={value ?? ""}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </DetailRow>
    );
  }
  return (
    <DetailRow label={label} data-row={rowKey}>
      <input
        className="lsd-row-input lsd-row-date"
        type="date"
        aria-label={label}
        value={value ?? ""}
        enterKeyHint="next"
        onChange={(event) => onValueChange(event.target.value)}
      />
    </DetailRow>
  );
}

// A text field that grows with what is typed. `singleLine` (what it was)
// turns Enter into "done" and line breaks into spaces.
export function GrowingTextarea({ value, onChange, singleLine = false, className, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      {...rest}
      ref={ref}
      className={className}
      rows={1}
      value={value}
      autoComplete="off"
      enterKeyHint={singleLine ? "done" : "enter"}
      onKeyDown={singleLine ? (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      } : undefined}
      onChange={(event) => onChange(singleLine ? event.target.value.replace(/\s*\n+\s*/g, " ") : event.target.value)}
    />
  );
}
