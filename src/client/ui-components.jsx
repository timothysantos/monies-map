import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Receipt } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";

import { CategoryPickerHost } from "./category-picker-host";
import { ResponsiveSelect } from "./responsive-select";
import { ICON_REGISTRY } from "./ui-options";
import { useIsMobileLayout } from "./use-viewport";

// The phone picker sheet loads when a picker opens (this is first-screen code).
const PickerSheet = lazy(() => import("./picker-sheet"));

export function FilterSelect({ label, value, options, emptyLabel, onChange }) {
  const normalizedOptions = [
    { value: "", label: emptyLabel },
    ...options.map((option) => (
      typeof option === "string"
        ? { value: option, label: option }
        : option
    ))
  ];

  return (
    <label className="entries-filter">
      <span className="entries-filter-label">{label}</span>
      <ResponsiveSelect
        className="table-edit-input"
        value={value}
        options={normalizedOptions}
        title={label}
        onValueChange={onChange}
      />
    </label>
  );
}

export function FilterMultiSelect({
  label,
  values,
  options,
  emptyLabel,
  onChange,
  selectionLabel,
  // A list of categories: the shared category list (search, alphabetical)
  // with several checked, instead of the checkbox popover and the plain sheet.
  categoryPick = false
}) {
  const useMobilePicker = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const selectedValues = Array.isArray(values) ? values : [];
  const normalizedOptions = options.map((option) => (
    typeof option === "string"
      ? { value: option, label: option }
      : option
  ));
  const selectedOptions = normalizedOptions.filter((option) => selectedValues.includes(option.value));
  const triggerLabel = selectedOptions.length
    ? selectionLabel?.(selectedOptions) ?? `${selectedOptions.length} selected`
    : emptyLabel;

  function toggleValue(nextValue) {
    const nextValues = selectedValues.includes(nextValue)
      ? selectedValues.filter((value) => value !== nextValue)
      : [...selectedValues, nextValue];
    onChange(nextValues);
  }

  if (categoryPick) {
    return (
      <label className="entries-filter">
        <span className="entries-filter-label">{label}</span>
        <CategoryPickerHost
          open={open}
          onOpenChange={setOpen}
          returnFocusRef={triggerRef}
          title={label}
          options={normalizedOptions}
          value={selectedValues}
          multiple
          onChoose={toggleValue}
          onClear={() => onChange([])}
          anchor={(
            <button
              ref={triggerRef}
              type="button"
              className={`table-edit-input entries-filter-multiselect-trigger ${useMobilePicker ? "responsive-select-trigger" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <span className={`entries-filter-multiselect-value ${useMobilePicker ? "responsive-select-value" : ""}`}>{triggerLabel}</span>
              {useMobilePicker ? <ChevronDown size={18} /> : null}
            </button>
          )}
        />
      </label>
    );
  }

  if (useMobilePicker) {
    return (
      <label className="entries-filter">
        <span className="entries-filter-label">{label}</span>
        <button
          type="button"
          className="table-edit-input responsive-select-trigger entries-filter-multiselect-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            event.currentTarget.blur();
            setOpen(true);
          }}
        >
          <span className="responsive-select-value entries-filter-multiselect-value">{triggerLabel}</span>
          <ChevronDown size={18} />
        </button>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          {open ? (
            <Suspense fallback={null}>
              <PickerSheet
                multiple
                title={label}
                description={`Choose one or more values for ${label.toLowerCase()}.`}
                closeLabel={`Close ${label.toLowerCase()}`}
                options={normalizedOptions}
                selectedValues={selectedValues}
                onChoose={toggleValue}
                onClear={() => onChange([])}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          ) : null}
        </Dialog.Root>
      </label>
    );
  }

  return (
    <label className="entries-filter">
      <span className="entries-filter-label">{label}</span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="table-edit-input entries-filter-multiselect-trigger"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <span className="entries-filter-multiselect-value">{triggerLabel}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="entries-filter-multiselect-popover" sideOffset={8} align="start">
            <div className="entries-filter-multiselect-options">
              {normalizedOptions.map((option) => {
                const checked = selectedValues.includes(option.value);
                return (
                  <label key={option.value} className="entries-filter-multiselect-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="entries-filter-multiselect-actions">
              <button
                type="button"
                className="subtle-action"
                onClick={() => onChange([])}
              >
                Clear
              </button>
              <button
                type="button"
                className="subtle-action"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </label>
  );
}

export function SortableHeader({ label, sort, columnKey, onSort, tableKey }) {
  const isActive = sort?.key === columnKey;
  const marker = !isActive ? "" : sort.direction === "asc" ? " ↑" : " ↓";

  return (
    <th data-column={columnKey}>
      <button
        type="button"
        className={`table-sort-button ${isActive ? "is-active" : ""}`}
        onClick={() => onSort(tableKey, columnKey)}
      >
        {label}{marker}
      </button>
    </th>
  );
}

export function getIconComponent(iconKey) {
  return ICON_REGISTRY[iconKey] ?? Receipt;
}

export function CategoryGlyph({ iconKey }) {
  const Icon = getIconComponent(iconKey);
  return <Icon size={18} strokeWidth={2.2} aria-hidden="true" />;
}

// The Lead · Support · Detail blocks (design.md) are re-exported here so the
// bundler keeps them in this shared chunk: the Summary lead and the Month
// plan sheet both use them, and on their own they were two more files on the
// first screen (check:bundle counts files).
export { BottomActions, DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui/lead-support-detail";
export { SimpleDetail, SpendLeadGroup } from "./ui/spend-lead-group";
