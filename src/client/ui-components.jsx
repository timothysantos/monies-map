import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Receipt, X } from "lucide-react";
import { useEffect, useState } from "react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { ResponsiveSelect } from "./responsive-select";
import { ICON_REGISTRY } from "./ui-options";

const { format: formatService } = moniesClient;

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
  selectionLabel
}) {
  const [useMobilePicker, setUseMobilePicker] = useState(false);
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const update = () => setUseMobilePicker(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

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
          <Dialog.Portal>
            <Dialog.Overlay className="note-dialog-overlay" />
            <Dialog.Content className="note-dialog-content mobile-select-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
              <div className="note-dialog-head mobile-select-head">
                <Dialog.Title>{label}</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Choose one or more values for {label.toLowerCase()}.
                </Dialog.Description>
                <button
                  type="button"
                  className="icon-action subtle-cancel mobile-select-close"
                  aria-label={`Close ${label.toLowerCase()}`}
                  onClick={() => setOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mobile-select-options">
                {normalizedOptions.map((option) => {
                  const checked = selectedValues.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`mobile-select-option ${checked ? "is-selected" : ""}`}
                      aria-pressed={checked}
                      onClick={() => toggleValue(option.value)}
                    >
                      <span className="mobile-select-option-main">
                        <span>{option.label}</span>
                      </span>
                      {checked ? <Check size={18} /> : null}
                    </button>
                  );
                })}
              </div>
              <div className="entries-filter-multiselect-actions mobile-select-actions">
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
            </Dialog.Content>
          </Dialog.Portal>
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

export function DeleteRowButton({
  label,
  onConfirm,
  triggerLabel,
  confirmLabel = "Confirm",
  destructive = true,
  prompt,
  buttonClassName = "",
  children = null
}) {
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setIsWorking(true);
    setError("");
    try {
      await onConfirm?.();
      setOpen(false);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The action could not finish.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (isWorking) {
          return;
        }
        setOpen(nextOpen);
        if (!nextOpen) {
          setError("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={destructive ? `subtle-remove ${buttonClassName}`.trim() : `icon-action ${buttonClassName}`.trim()}
          aria-label={triggerLabel ?? `Delete ${label}`}
          disabled={isWorking}
          onClick={(event) => event.stopPropagation()}
        >
          {children ?? (destructive ? <span aria-hidden="true">&times;</span> : <X size={16} />)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="delete-popover"
          sideOffset={8}
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
          <p>
            {prompt ?? <>You are deleting <strong>{label}</strong>. Confirm?</>}
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="delete-popover-actions">
            <Popover.Close asChild>
              <button type="button" className="subtle-action" disabled={isWorking}>
                Cancel
              </button>
            </Popover.Close>
            <button
              type="button"
              className={`subtle-action ${destructive ? "subtle-danger" : ""}`}
              disabled={isWorking}
              onClick={() => void handleConfirm()}
            >
              {isWorking ? messages.common.working : confirmLabel}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function MetricCard({ card }) {
  const value = card.amountMinor == null ? card.value : formatService.money(card.amountMinor);
  return (
    <div className={`metric ${card.tone ? `metric-${card.tone}` : ""}`}>
      <span>{card.label}</span>
      <strong>{value}</strong>
      {card.detail ? (
        card.detailPopover ? (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className="metric-detail-trigger">
                {card.detail}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="metric-detail-popover" sideOffset={8} align="start">
                <p>{card.detailPopover}</p>
                <Popover.Arrow className="category-popover-arrow" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : <p>{card.detail}</p>
      ) : null}
    </div>
  );
}

export function SortableHeader({ label, sort, columnKey, onSort, tableKey }) {
  const isActive = sort?.key === columnKey;
  const marker = !isActive ? "" : sort.direction === "asc" ? " ↑" : " ↓";

  return (
    <th>
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

export function BarLine({ label, valueMinor, maxMinor, tone }) {
  const percent = Math.max((valueMinor / Math.max(maxMinor, 1)) * 100, 6);
  return (
    <div className="plan-bar-line">
      <span>{label}</span>
      <div className="plan-bar-track">
        <span className={`plan-bar-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <strong>{formatService.money(valueMinor)}</strong>
    </div>
  );
}

export function getIconComponent(iconKey) {
  return ICON_REGISTRY[iconKey] ?? Receipt;
}

export function CategoryGlyph({ iconKey }) {
  const Icon = getIconComponent(iconKey);
  return <Icon size={18} strokeWidth={2.2} aria-hidden="true" />;
}
