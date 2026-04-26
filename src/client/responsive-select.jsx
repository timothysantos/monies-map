import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function ResponsiveSelect({
  value,
  options,
  onValueChange,
  title,
  className = "table-edit-input",
  disabled = false,
  open,
  onOpenChange,
  hideMobileTrigger = false
}) {
  const [useMobilePicker, setUseMobilePicker] = useState(false);
  const [isOpenInternal, setIsOpenInternal] = useState(false);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? null,
    [options, value]
  );
  const isControlledOpen = typeof open === "boolean";
  const isOpen = isControlledOpen ? open : isOpenInternal;

  function updateOpen(nextOpen) {
    if (!isControlledOpen) {
      setIsOpenInternal(nextOpen);
    }
    onOpenChange?.(nextOpen);
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

  if (!useMobilePicker) {
    return (
      <select
        className={className}
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
          onClick={() => updateOpen(true)}
        >
          <span className="responsive-select-value">{selectedOption?.label ?? ""}</span>
          <ChevronDown size={18} />
        </button>
      ) : null}
      <Dialog.Root open={isOpen} onOpenChange={updateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content mobile-select-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
            <div className="note-dialog-head mobile-select-head">
              <Dialog.Title>{title}</Dialog.Title>
              <button
                type="button"
                className="icon-action subtle-cancel mobile-select-close"
                aria-label={`Close ${title.toLowerCase()}`}
                onClick={() => updateOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="mobile-select-options">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`mobile-select-option ${option.value === value ? "is-selected" : ""}`}
                  onClick={() => {
                    onValueChange(option.value);
                    updateOpen(false);
                  }}
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
                  {option.value === value ? <Check size={18} /> : null}
                </button>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
