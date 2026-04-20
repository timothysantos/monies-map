import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { formatDateOnly, money } from "./formatters";
import { SplitExpenseFields, SplitSettlementFields } from "./splits-dialogs";
import { CategoryGlyph } from "./ui-components";

function splitItemKey(item) {
  return `${item.kind}:${item.id}`;
}

function scrollInlineEditorIntoView(element) {
  if (window.matchMedia("(max-width: 760px)").matches) {
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - ((window.innerHeight - rect.height) / 2) - 48;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

// Activity cards are shared by current split rows and archived batch history.
export function SplitActivityGroups({
  groups,
  categories,
  groupOptions = [],
  people = [],
  categoryOptions = [],
  archived = false,
  editingDraft = null,
  inlineFormError = "",
  isSubmitting = false,
  readOnly = false,
  onChangeEditingDraft,
  onCancelEditing,
  onSaveEditing,
  onRequestDelete,
  onEditExpense,
  onEditSettlement,
  onEditLinkedEntry
}) {
  const inlineEditorRef = useRef(null);
  const editingDraftKey = editingDraft ? `${editingDraft.kind}:${editingDraft.id}` : "";

  useEffect(() => {
    if (!editingDraft || archived) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isSubmitting) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (inlineEditorRef.current?.contains(target)) {
        return;
      }

      // Confirmation dialogs and select popovers are portalled outside the row.
      // They should still count as part of the current inline edit flow.
      if (
        target.closest("[role='dialog']") ||
        target.closest("[data-radix-popper-content-wrapper]") ||
        target.closest(".note-dialog-content")
      ) {
        return;
      }

      onCancelEditing?.();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [archived, editingDraft, isSubmitting, onCancelEditing]);

  useEffect(() => {
    if (!editingDraft || archived) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      if (inlineEditorRef.current) {
        scrollInlineEditorIntoView(inlineEditorRef.current);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [archived, editingDraftKey]);

  return groups.map((group) => (
    <section key={`${archived ? "archived" : "current"}-${group.date}`} className={`split-date-group ${archived ? "is-archived" : ""}`}>
      <header className="split-date-header">
        <strong>{formatDateOnly(group.date)}</strong>
        <span>{group.items.length} {messages.splits.entries}</span>
      </header>
      <div className="split-date-items">
        {group.items.map((item, index) => {
          const theme = getCategoryTheme(categories, { categoryName: item.categoryName ?? "Other" }, index);
          const isEditable = !archived && !readOnly;
          const isEditing = isEditable && editingDraft && splitItemKey(item) === `${editingDraft.kind}:${editingDraft.id}`;
          const showDirectionLabel = Boolean(item.viewerDirectionLabel) && !readOnly;
          const openEditor = () => {
            if (isEditable) {
              item.kind === "expense" ? onEditExpense(item) : onEditSettlement(item);
            }
          };

          if (isEditing) {
            return (
              <article
                ref={inlineEditorRef}
                key={splitItemKey(item)}
                className="split-inline-editor-card"
                onClick={(event) => event.stopPropagation()}
              >
                {editingDraft.kind === "expense" ? (
                  <SplitExpenseFields
                    dialog={editingDraft}
                    groupOptions={groupOptions}
                    people={people}
                    categoryOptions={categoryOptions}
                    onChange={onChangeEditingDraft}
                    autoFocusAmount
                  />
                ) : (
                  <SplitSettlementFields
                    dialog={editingDraft}
                    groupOptions={groupOptions}
                    people={people}
                    onChange={onChangeEditingDraft}
                    autoFocusAmount
                  />
                )}
                {inlineFormError ? <p className="form-error">{inlineFormError}</p> : null}
                <div className="split-inline-actions">
                  {editingDraft.linkedTransactionId ? (
                    <button
                      type="button"
                      className="subtle-action split-linked-entry-action"
                      disabled={isSubmitting}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEditLinkedEntry?.(editingDraft);
                      }}
                    >
                      {messages.splits.editLinkedEntry}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="subtle-action split-delete-action"
                    disabled={isSubmitting}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestDelete?.(editingDraft);
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="inline-action-button inline-save-action" aria-label="Done editing split" disabled={isSubmitting} onClick={() => void onSaveEditing?.()}>
                    {isSubmitting ? null : <Check size={16} />}
                    <span className="desktop-action-label">{isSubmitting ? messages.common.saving : "Save"}</span>
                  </button>
                  <button type="button" className="inline-action-button inline-cancel-action" aria-label="Cancel editing split" disabled={isSubmitting} onClick={onCancelEditing}>
                    <X size={16} />
                    <span className="desktop-action-label">Cancel</span>
                  </button>
                </div>
              </article>
            );
          }

          const cardContent = (
            <>
              <div className="split-activity-leading">
                <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                  <CategoryGlyph iconKey={theme.iconKey} />
                </span>
              </div>
              <div className="split-activity-copy">
                <strong>{item.description}</strong>
                <p>{item.kind === "expense" ? `${item.paidByPersonName} paid ${money(item.totalAmountMinor)}` : `${item.fromPersonName} paid ${item.toPersonName}`}</p>
                {item.note ? <span className="share-row-meta">{item.note}</span> : null}
                {archived && !readOnly ? (
                  <div className="split-card-actions">
                    <button
                      type="button"
                      className="subtle-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        item.kind === "expense" ? onEditExpense(item) : onEditSettlement(item);
                      }}
                    >
                      {messages.splits.editSplit}
                    </button>
                    {item.linkedTransactionId ? (
                      <button
                        type="button"
                        className="subtle-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditLinkedEntry?.(item);
                        }}
                      >
                        {messages.splits.editLinkedEntry}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="split-activity-trailing">
                {showDirectionLabel ? (
                  <strong className={item.viewerDirectionLabel.includes("borrowed") || item.viewerDirectionLabel.includes("owe") ? "tone-negative" : "tone-positive"}>
                    {item.viewerDirectionLabel}
                  </strong>
                ) : null}
                <span className="split-activity-amount-line">
                  <span>{money(item.viewerAmountMinor ?? item.totalAmountMinor)}</span>
                  <span className="share-row-meta">{item.matched ? messages.splits.linked : messages.splits.manual}</span>
                </span>
              </div>
            </>
          );

          if (isEditable) {
            return (
              <button
                key={splitItemKey(item)}
                type="button"
                className="split-activity-card"
                onClick={openEditor}
              >
                {cardContent}
              </button>
            );
          }

          return (
            <article key={splitItemKey(item)} className="split-activity-card">
              {cardContent}
            </article>
          );
        })}
      </div>
    </section>
  ));
}
