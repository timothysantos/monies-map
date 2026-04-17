import * as Popover from "@radix-ui/react-popover";
import { Receipt, X } from "lucide-react";
import { useState } from "react";

import { messages } from "./copy/en-SG";
import { money } from "./formatters";
import { ICON_REGISTRY } from "./ui-options";

export function FilterSelect({ label, value, options, emptyLabel, onChange }) {
  return (
    <label className="entries-filter">
      <span className="entries-filter-label">{label}</span>
      <select className="table-edit-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return (
            <option key={optionValue} value={optionValue}>{optionLabel}</option>
          );
        })}
      </select>
    </label>
  );
}

export function DeleteRowButton({ label, onConfirm, triggerLabel, confirmLabel = "Confirm", destructive = true, prompt }) {
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
          className={destructive ? "subtle-remove" : "icon-action"}
          aria-label={triggerLabel ?? `Delete ${label}`}
          disabled={isWorking}
          onClick={(event) => event.stopPropagation()}
        >
          {destructive ? <span aria-hidden="true">&times;</span> : <X size={16} />}
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
  const value = card.amountMinor == null ? card.value : money(card.amountMinor);
  return (
    <div className={`metric ${card.tone ? `metric-${card.tone}` : ""}`}>
      <span>{card.label}</span>
      <strong>{value}</strong>
      {card.detail ? <p>{card.detail}</p> : null}
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
      <strong>{money(valueMinor)}</strong>
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
