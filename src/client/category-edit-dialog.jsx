import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, X } from "lucide-react";

import { messages } from "./copy/en-SG";
import { CategoryGlyph } from "./ui-components";
import { COLOR_OPTIONS, FALLBACK_THEME, ICON_OPTIONS } from "./ui-options";

export function CategoryEditDialog({
  dialog,
  isSubmitting = false,
  onChange,
  onClose,
  onSave
}) {
  return (
    <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content className="note-dialog-content settings-account-dialog settings-category-dialog">
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>{dialog?.mode === "create" ? messages.settings.createCategory : messages.settings.editCategory}</Dialog.Title>
              <Dialog.Description>{dialog?.mode === "create" ? messages.settings.createCategoryDetail : messages.settings.editCategoryDetail}</Dialog.Description>
            </div>
            <button
              type="button"
              className="icon-action subtle-cancel"
              aria-label="Close category dialog"
              disabled={isSubmitting}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="settings-account-form">
            <label className="table-edit-field">
              <span>{messages.settings.categoryName}</span>
              <input
                className="table-edit-input"
                value={dialog?.name ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, name: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categorySlug}</span>
              <input
                className="table-edit-input"
                value={dialog?.slug ?? ""}
                onChange={(event) => onChange((current) => current ? { ...current, slug: event.target.value } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryIcon}</span>
              <CategoryIconSelector
                value={dialog?.iconKey ?? FALLBACK_THEME.iconKey}
                colorHex={dialog?.colorHex ?? FALLBACK_THEME.colorHex}
                onChange={(iconKey) => onChange((current) => current ? { ...current, iconKey } : current)}
              />
            </label>
            <label className="table-edit-field">
              <span>{messages.settings.categoryColor}</span>
              <CategoryColorSelector
                value={dialog?.colorHex ?? FALLBACK_THEME.colorHex}
                onChange={(colorHex) => onChange((current) => current ? { ...current, colorHex } : current)}
              />
            </label>
          </div>
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="dialog-primary"
              disabled={!dialog?.name?.trim() || isSubmitting}
              onClick={() => void onSave()}
            >
              {isSubmitting ? messages.common.saving : dialog?.mode === "create" ? messages.settings.createCategory : messages.settings.saveCategory}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategoryIconSelector({ value, colorHex, onChange }) {
  const selectedOption =
    ICON_OPTIONS.find((option) => option.key === value) ??
    ICON_OPTIONS.find((option) => option.key === FALLBACK_THEME.iconKey) ??
    ICON_OPTIONS[0];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="category-picker-trigger" aria-label={`Select icon. Current icon: ${selectedOption.label}`}>
          <span className="category-picker-value">
            <span className="category-picker-icon-preview" style={{ "--category-color": colorHex }}>
              <CategoryGlyph iconKey={selectedOption.key} />
            </span>
          </span>
          <ChevronDown size={18} strokeWidth={2.2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-picker-popover" sideOffset={8} align="start">
          <strong className="category-picker-title">Select icon</strong>
          <div className="icon-grid">
            {ICON_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`icon-choice ${value === option.key ? "is-active" : ""}`}
                onClick={() => onChange(option.key)}
                aria-label={option.label}
                title={option.label}
              >
                <option.Icon size={18} strokeWidth={2.2} />
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CategoryColorSelector({ value, onChange }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="category-picker-trigger" aria-label={`Select color. Current color: ${value}`}>
          <span className="category-picker-value">
            <span className="category-picker-color-preview" style={{ "--swatch-color": value }} />
          </span>
          <ChevronDown size={18} strokeWidth={2.2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-picker-popover category-color-popover" sideOffset={8} align="start">
          <strong className="category-picker-title">Select color</strong>
          <div className="color-grid">
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-choice ${value === color ? "is-active" : ""}`}
                style={{ "--swatch-color": color }}
                onClick={() => onChange(color)}
                aria-label={color}
                title={color}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
