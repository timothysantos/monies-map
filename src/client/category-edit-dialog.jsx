import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";

import { messages } from "./copy/en-SG";
import { settingsMessages } from "./copy/en-SG-settings";
import { SheetDialog } from "./sheet-dialog";
import { CategoryGlyph } from "./ui-components";
import { DetailRow, DetailRows, LeadCard } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";
import { COLOR_OPTIONS, FALLBACK_THEME, ICON_OPTIONS } from "./ui-options";
import { paletteColour } from "./palette-colour";

export function CategoryEditDialog({
  dialog,
  isSubmitting = false,
  onChange,
  onClose,
  onSave
}) {
  const isDirty = useDraftChanged(dialog);
  if (!dialog) {
    return null;
  }
  const isCreate = dialog.mode === "create";
  const set = (patch) => onChange((current) => current ? { ...current, ...patch } : current);
  const iconKey = dialog.iconKey ?? FALLBACK_THEME.iconKey;
  const colorHex = dialog.colorHex ?? FALLBACK_THEME.colorHex;
  const title = isCreate ? settingsMessages.createCategory : settingsMessages.editCategory;

  return (
    <SheetDialog
      className="settings-account-dialog settings-category-dialog"
      title={title}
      description={isCreate ? settingsMessages.createCategoryDetail : settingsMessages.editCategoryDetail}
      descriptionHidden
      closeLabel="Close category dialog"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          // The bubble is the live icon and colour, so a change shows at once.
          category={{ colorHex, iconKey }}
          title={(
            <input
              className="lsd-title lsd-title-input"
              aria-label={settingsMessages.categoryName}
              placeholder={settingsMessages.categoryName}
              value={dialog.name ?? ""}
              enterKeyHint="next"
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        />
      )}
      primaryLabel={isSubmitting ? messages.common.saving : isCreate ? settingsMessages.createCategory : settingsMessages.saveCategory}
      primaryDisabled={!dialog.name?.trim() || isSubmitting}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={onSave}
      onClose={onClose}
    >
      <DetailRows label={title}>
        <DetailRow label={settingsMessages.categorySlug}>
          <input
            value={dialog.slug ?? ""}
            enterKeyHint="next"
            onChange={(event) => set({ slug: event.target.value })}
          />
        </DetailRow>
        <DetailRow label={settingsMessages.categoryIcon}>
          <CategoryIconSelector value={iconKey} colorHex={colorHex} onChange={(next) => set({ iconKey: next })} />
        </DetailRow>
        <DetailRow label={settingsMessages.categoryColor}>
          <CategoryColorSelector value={colorHex} onChange={(next) => set({ colorHex: next })} />
        </DetailRow>
      </DetailRows>
    </SheetDialog>
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
            <span className="category-picker-icon-preview" style={{ "--category-color": paletteColour(colorHex) }}>
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
            <span className="category-picker-color-preview" style={{ "--swatch-color": paletteColour(value) }} />
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
                style={{ "--swatch-color": paletteColour(color) }}
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
