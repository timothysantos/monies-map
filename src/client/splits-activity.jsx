import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { messages } from "./copy/en-SG";
import { splitsMessages } from "./copy/en-SG-splits";
import { moniesClient } from "./monies-client-service";
import { PAGE_FLAG, pageFlagRef } from "./page-flags";
import { SplitSettlementCard } from "./split-settlement-card";
import { SplitExpenseCard } from "./split-expense-card";
import { BottomActions } from "./ui/lead-support-detail";
import { CategoryGlyph } from "./ui-components";
import { useRouteWorkBusy } from "./use-route-work-status";
import { isMobileLayout } from "./use-viewport";
import { InlineError } from "./ui-states";
import { SettlementLockNotice } from "./settlement-lock-notice";
import { moneyToneClass } from "./money-tone-class";
import { TotalsVisibilityToggle, useMoneyPrivacy } from "./money-privacy";
import { paletteColour } from "./palette-colour";
import { rowMotionProps } from "./row-motion";
import { trackStuckDateRow } from "./stuck-date-row";

const { categories: categoryService, format: formatService } = moniesClient;

function formatSplitMoney(valueMinor, currency = "SGD") {
  return formatService.moneyWithCurrency(Math.abs(Number(valueMinor ?? 0)), currency);
}

function splitItemKey(item) {
  return `${item.kind}:${item.id}`;
}

export function splitActivityDomId(itemOrKind, maybeId) {
  const kind = typeof itemOrKind === "string" ? itemOrKind : itemOrKind?.kind;
  const id = typeof itemOrKind === "string" ? maybeId : itemOrKind?.id;
  return `split-activity-${kind}-${id}`;
}

function scrollInlineEditorIntoView(element) {
  if (isMobileLayout()) {
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - ((window.innerHeight - rect.height) / 2) - 48;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

function formatExpensePaidLine(item, viewId) {
  const amount = formatSplitMoney(item.totalAmountMinor, item.currency);
  if (viewId && viewId !== "household" && item.shares?.some((share) => share.personId === viewId) && item.paidByPersonName) {
    const payerShare = item.shares.find((share) => share.personName === item.paidByPersonName);
    if (payerShare?.personId === viewId) {
      return `You paid ${amount}`;
    }
  }

  return `${item.paidByPersonName} paid ${amount}`;
}

// Activity cards are shared by current split rows and archived batch history.
// On a wide screen a split expense row turns into the split expense card in
// place (like the Entries inline editor) and a settlement row into its form;
// a phone opens the sheet instead (SplitsPanel).
export function SplitActivityGroups({
  groups,
  categories,
  groupOptions = [],
  people = [],
  categoryOptions = [],
  archived = false,
  editingDraft = null,
  inlineFormError = "",
  inlineSettlementLock = null,
  inlineReadOnly = false,
  isUndoingSettlementLock = false,
  onUndoSettlementLock = undefined,
  isSubmitting = false,
  hasEditingChanges = true,
  readOnly = false,
  onChangeEditingDraft = undefined,
  onCancelEditing = undefined,
  onSaveEditing = undefined,
  onRequestDelete = undefined,
  onEditExpense,
  onEditSettlement,
  onViewLinkedEntry,
  onRefreshActivity = undefined,
  viewId = "household"
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const inlineEditorRef = useRef(null);
  const editingDraftKey = editingDraft ? `${editingDraft.kind}:${editingDraft.id}` : "";
  const [refreshingDate, setRefreshingDate] = useState("");
  useRouteWorkBusy(refreshingDate !== "");

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

  // Escape closes the inline split card from anywhere on the page (focus is
  // on the page itself right after the row turns into the card), unless a
  // dialog or an open list has it.
  useEffect(() => {
    if (!editingDraft || archived || editingDraft.kind !== "expense") {
      return undefined;
    }
    function handleEscape(event) {
      if (event.key !== "Escape" || event.defaultPrevented || isSubmitting || document.querySelector("[role='dialog']")) {
        return;
      }
      onCancelEditing?.();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [archived, editingDraft, isSubmitting, onCancelEditing]);

  // When an inline card closes (Escape, Cancel or Save), the row comes back
  // and takes focus, so keyboard focus continues from where it was opened.
  const editedKeyRef = useRef("");
  useEffect(() => {
    if (editingDraftKey) {
      editedKeyRef.current = editingDraftKey;
      return undefined;
    }
    const key = editedKeyRef.current;
    editedKeyRef.current = "";
    if (!key) {
      return undefined;
    }
    const separator = key.indexOf(":");
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(splitActivityDomId(key.slice(0, separator), key.slice(separator + 1)))?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingDraftKey]);

  async function refreshDateGroup(date) {
    if (!onRefreshActivity || refreshingDate) {
      return;
    }

    setRefreshingDate(date);
    try {
      await onRefreshActivity();
    } finally {
      setRefreshingDate("");
    }
  }

  return groups.map((group) => {
    const formattedDate = formatService.formatDateOnly(group.date);

    return (
      <section key={`${archived ? "archived" : "current"}-${group.date}`} className={`split-date-group ${archived ? "is-archived" : ""}`}>
        <header className="split-date-header" ref={archived ? undefined : trackStuckDateRow}>
          <strong>{formattedDate}</strong>
          <div className="split-date-actions">
            <span>{splitsMessages.entryCount(group.items.length)}</span>
            {onRefreshActivity && !archived ? (
              <button
                type="button"
                className="entries-date-refresh-button split-date-refresh-button"
                aria-label={`Refresh split rows for ${formattedDate}`}
                title={`Refresh split rows for ${formattedDate}`}
                disabled={Boolean(refreshingDate)}
                onClick={() => void refreshDateGroup(group.date)}
              >
                <RefreshCw size={15} className={refreshingDate === group.date ? "is-spinning" : ""} />
              </button>
            ) : null}
          </div>
        </header>
        <div className="split-date-items">
        {group.items.map((item, index) => {
          const theme = categoryService.getTheme(categories, { categoryName: item.categoryName ?? "Other" }, index);
          const isEditable = !archived && !readOnly;
          const canOpen = !archived && Boolean(item.kind === "expense" ? onEditExpense : onEditSettlement);
          const isEditing = isEditable && editingDraft && splitItemKey(item) === `${editingDraft.kind}:${editingDraft.id}`;
          const isPendingDerived = item.isPendingDerived === true;
          // Who lent or borrowed is the sign of the viewer's share: hidden with money.
          const showDirectionLabel = Boolean(item.viewerDirectionLabel) && !readOnly && areTotalsVisible;
          // Lent or received is money coming to the viewer, borrowed a debt,
          // a settle-up they paid a plain outflow (src/domain/money-tone.ts).
          const amountToneClass = moneyToneClass(showDirectionLabel ? item.viewerTone : "neutral");
          const openEditor = () => {
            if (canOpen) {
              item.kind === "expense" ? onEditExpense(item) : onEditSettlement(item);
            }
          };

          if (isEditing && editingDraft.kind === "expense") {
            // A settled split is read-only: the reason and Undo on top, the
            // card, then Close. After the undo it is editable in place.
            return (
              <article
                ref={pageFlagRef(PAGE_FLAG.splitInlineEditor, inlineEditorRef)}
                id={splitActivityDomId(item)}
                key={splitItemKey(item)}
                className="split-inline-editor-card split-inline-expense-card"
                onClick={(event) => event.stopPropagation()}
              >
                {inlineReadOnly
                  ? <SettlementLockNotice lock={inlineSettlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                  : null}
                <SplitExpenseCard
                  key={inlineReadOnly ? "view" : "edit"}
                  layout="inline"
                  dialog={editingDraft}
                  groupOptions={groupOptions}
                  people={people}
                  categoryOptions={categoryOptions}
                  categories={categories}
                  onChange={onChangeEditingDraft}
                  autoFocusAmount={!inlineReadOnly}
                  readOnly={inlineReadOnly}
                  amountAction={<TotalsVisibilityToggle className="totals-visibility-toggle--form" />}
                  onViewLinkedEntry={onViewLinkedEntry ? () => onViewLinkedEntry(editingDraft) : undefined}
                />
                {inlineReadOnly
                  ? null
                  : inlineSettlementLock
                    ? <SettlementLockNotice lock={inlineSettlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                    : <InlineError message={inlineFormError} />}
                <BottomActions
                  className="split-inline-expense-actions"
                  destructive={inlineReadOnly ? null : (
                    <button type="button" className="lsd-quiet is-danger" disabled={isSubmitting} onClick={() => onRequestDelete?.(editingDraft)}>
                      {splitsMessages.expenseCard.deleteSplit}
                    </button>
                  )}
                  secondary={(
                    <button type="button" className="lsd-quiet" disabled={isSubmitting} onClick={onCancelEditing}>
                      {inlineReadOnly ? messages.common.close : splitsMessages.expenseCard.cancel}
                    </button>
                  )}
                  primary={inlineReadOnly ? null : (
                    <button type="button" className="lsd-primary" disabled={isSubmitting || !hasEditingChanges} onClick={() => void onSaveEditing?.()}>
                      {isSubmitting ? messages.common.saving : splitsMessages.saveExpense}
                    </button>
                  )}
                />
              </article>
            );
          }

          if (isEditing) {
            // A settle-up opens as the settlement card in place of its row
            // (wide screens), with the same bottom bar as the expense card.
            return (
              <article
                ref={pageFlagRef(PAGE_FLAG.splitInlineEditor, inlineEditorRef)}
                id={splitActivityDomId(item)}
                key={splitItemKey(item)}
                className="split-inline-editor-card split-inline-expense-card"
                onClick={(event) => event.stopPropagation()}
              >
                <SplitSettlementCard
                  layout="inline"
                  dialog={editingDraft}
                  groupOptions={groupOptions}
                  people={people}
                  onChange={onChangeEditingDraft}
                  autoFocusAmount
                  amountAction={<TotalsVisibilityToggle className="totals-visibility-toggle--form" />}
                  onViewLinkedEntry={onViewLinkedEntry ? () => onViewLinkedEntry(editingDraft) : undefined}
                />
                {inlineSettlementLock
                  ? <SettlementLockNotice lock={inlineSettlementLock} isUndoing={isUndoingSettlementLock} onUndo={onUndoSettlementLock} />
                  : <InlineError message={inlineFormError} />}
                <BottomActions
                  className="split-inline-expense-actions"
                  destructive={(
                    <button type="button" className="lsd-quiet is-danger" disabled={isSubmitting} onClick={() => onRequestDelete?.(editingDraft)}>
                      Delete
                    </button>
                  )}
                  secondary={(
                    <button type="button" className="lsd-quiet" aria-label="Cancel editing split" disabled={isSubmitting} onClick={onCancelEditing}>
                      Cancel
                    </button>
                  )}
                  primary={(
                    <button type="button" className="lsd-primary" aria-label="Done editing split" disabled={isSubmitting || !hasEditingChanges} onClick={() => void onSaveEditing?.()}>
                      {isSubmitting ? messages.common.saving : "Save"}
                    </button>
                  )}
                />
              </article>
            );
          }

          const cardContent = (
            <>
              <div className="split-activity-leading">
                <span className="category-icon category-icon-static" style={{ "--category-color": paletteColour(theme.color) }}>
                  <CategoryGlyph iconKey={theme.iconKey} />
                </span>
              </div>
              <div className="split-activity-copy">
                <strong>{item.description}</strong>
                <p>{item.kind === "expense" ? formatExpensePaidLine(item, viewId) : `${item.fromPersonName} paid ${item.toPersonName}`}</p>
                {item.note ? <span className="share-row-meta">{item.note}</span> : null}
                {item.settlementCheckpointId ? <span className="split-settlement-marker">Included in simplified settlement</span> : null}
                {item.paymentStatus === "awaiting_statement" ? <span className="split-payment-marker">Card statement pending</span> : null}
                {item.paymentStatus === "certified" ? <span className="split-payment-marker is-certified">Statement certified</span> : null}
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
                      {splitsMessages.editSplit}
                    </button>
                    {item.linkedTransactionId ? (
                      <button
                        type="button"
                        className="subtle-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewLinkedEntry?.(item);
                        }}
                      >
                        {splitsMessages.viewLinkedEntry}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="split-activity-trailing">
                {showDirectionLabel ? (
                  <strong className={amountToneClass}>
                    {item.viewerDirectionLabel}
                  </strong>
                ) : null}
                <span className="split-activity-amount-line">
                  <span className={amountToneClass}>{formatSplitMoney(item.viewerAmountMinor ?? item.totalAmountMinor, item.currency)}</span>
                  <span className="share-row-meta">
                    {isPendingDerived
                      ? messages.common.loadingLatest
                      : item.matched
                        ? splitsMessages.linked
                        : splitsMessages.manual}
                  </span>
                </span>
              </div>
            </>
          );

          const CardElement = canOpen ? "button" : "article";
          return (
            <CardElement
              id={splitActivityDomId(item)}
              key={splitItemKey(item)}
              type={canOpen ? "button" : undefined}
              className={`split-activity-card motion-row ${isPendingDerived ? "is-pending" : ""} ${item.settlementCheckpointId ? "is-settlement-included" : ""}`}
              {...rowMotionProps({ name: item.categoryName, iconKey: theme.iconKey, color: theme.color })}
              title={item.settlementCheckpointId ? "Included in simplified settlement" : undefined}
              onClick={canOpen ? openEditor : undefined}
            >
              {cardContent}
            </CardElement>
          );
        })}
      </div>
    </section>
    );
  });
}
