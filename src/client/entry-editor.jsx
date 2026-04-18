import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { CategoryAppearancePopover } from "./category-visuals";
import { getCategory, getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { getTransferWallets } from "./entry-helpers";
import { CategoryGlyph } from "./ui-components";
import { formatDateOnly, formatEditableMinorInput, parseMoneyInput } from "./formatters";

// Shared field layout for creating and editing entries. Callers keep ownership of
// persistence so row editing and draft creation can each preserve their own flow.
export function EntryEditorFields({
  entry,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  splitPercentValue,
  lockTransferCategory = false,
  onChange,
  onQuickSaveCategory,
  onCategoryAppearanceChange,
  onOwnerChange,
  onSplitPercentChange,
  transferTools = null
}) {
  const [categorySavePrompt, setCategorySavePrompt] = useState(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [categorySaveError, setCategorySaveError] = useState("");
  const [useMobileCategorySaveDialog, setUseMobileCategorySaveDialog] = useState(false);
  const displayCategoryName = lockTransferCategory && entry.entryType === "transfer" ? "Transfer" : entry.categoryName;
  const category = getCategory(categories, { categoryName: displayCategoryName });
  const categoryTheme = getCategoryTheme(
    categories,
    { categoryName: displayCategoryName },
    0
  );
  const amountToneClass = entry.entryType === "income" || entry.transferDirection === "in"
    ? "entry-edit-tone-positive"
    : "entry-edit-tone-negative";
  const typeToneClass = entry.entryType === "income"
    ? "entry-edit-tone-positive"
    : entry.entryType === "expense"
      ? "entry-edit-tone-negative"
      : "entry-edit-tone-transfer";

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const update = () => setUseMobileCategorySaveDialog(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  function handleCategoryChange(nextCategoryName) {
    onChange({ categoryName: nextCategoryName });
    if (!onQuickSaveCategory || nextCategoryName === entry.categoryName) {
      return;
    }
    setCategorySaveError("");
    setCategorySavePrompt({ categoryName: nextCategoryName });
  }

  async function saveCategoryShortcut() {
    if (!categorySavePrompt || !onQuickSaveCategory) {
      return;
    }

    setIsSavingCategory(true);
    setCategorySaveError("");
    try {
      await onQuickSaveCategory(categorySavePrompt.categoryName);
      setCategorySavePrompt(null);
    } catch (error) {
      setCategorySaveError(error instanceof Error ? error.message : "Failed to save category.");
    } finally {
      setIsSavingCategory(false);
    }
  }

  function dismissCategorySavePrompt() {
    if (isSavingCategory) {
      return;
    }
    setCategorySavePrompt(null);
    setCategorySaveError("");
  }

  const categorySelect = (
    <select
      className="table-edit-input"
      value={entry.categoryName}
      onChange={(event) => handleCategoryChange(event.target.value)}
    >
      {categoryOptions.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );

  const categorySavePromptBody = (
    <>
      <strong>Save this category?</strong>
      <p>Update this entry now without saving the rest of the row.</p>
      {categorySaveError ? <p className="form-error">{categorySaveError}</p> : null}
      <div className="delete-popover-actions">
        <button type="button" className="subtle-cancel" disabled={isSavingCategory} onClick={dismissCategorySavePrompt}>
          Not yet
        </button>
        <button type="button" className="subtle-action" disabled={isSavingCategory} onClick={() => void saveCategoryShortcut()}>
          {isSavingCategory ? "Saving..." : "Save category"}
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="entry-edit-grid">
        <label>
          <span>{messages.entries.editCategory}</span>
          <div className="entry-category-field">
            {category && onCategoryAppearanceChange ? (
              <CategoryAppearancePopover
                category={category}
                onChange={onCategoryAppearanceChange}
              />
            ) : (
              <span
                className="category-icon category-icon-static"
                style={{ "--category-color": categoryTheme.color }}
              >
                <CategoryGlyph iconKey={categoryTheme.iconKey} />
              </span>
            )}
            {lockTransferCategory && entry.entryType === "transfer" ? (
              <input
                className="table-edit-input"
                value="Transfer"
                readOnly
              />
            ) : (
              useMobileCategorySaveDialog ? (
                <>
                  {categorySelect}
                  <Dialog.Root open={Boolean(categorySavePrompt)} onOpenChange={(open) => {
                    if (!open) {
                      dismissCategorySavePrompt();
                    }
                  }}>
                    <Dialog.Portal>
                      <Dialog.Overlay className="entry-category-save-overlay" />
                      <Dialog.Content className="entry-category-save-popover entry-category-save-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
                        <Dialog.Title className="entry-category-save-title">Save this category?</Dialog.Title>
                        <p>Update this entry now without saving the rest of the row.</p>
                        {categorySaveError ? <p className="form-error">{categorySaveError}</p> : null}
                        <div className="delete-popover-actions">
                          <button type="button" className="subtle-cancel" disabled={isSavingCategory} onClick={dismissCategorySavePrompt}>
                            Not yet
                          </button>
                          <button type="button" className="subtle-action" disabled={isSavingCategory} onClick={() => void saveCategoryShortcut()}>
                            {isSavingCategory ? "Saving..." : "Save category"}
                          </button>
                        </div>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                </>
              ) : (
                <Popover.Root open={Boolean(categorySavePrompt)} onOpenChange={(open) => {
                  if (!open) {
                    dismissCategorySavePrompt();
                  }
                }}>
                  <Popover.Anchor asChild>
                    {categorySelect}
                  </Popover.Anchor>
                  <Popover.Portal>
                    <Popover.Content className="entry-category-save-popover" sideOffset={8} align="end">
                      {categorySavePromptBody}
                      <Popover.Arrow className="category-popover-arrow" />
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              )
            )}
          </div>
        </label>
        <label>
          <span>{messages.entries.editDate}</span>
          <input
            className="table-edit-input"
            type="date"
            value={entry.date}
            onChange={(event) => onChange({ date: event.target.value })}
          />
        </label>
        <label>
          <span>{messages.entries.editWallet}</span>
          <select
            className="table-edit-input"
            value={entry.accountId ?? entry.accountName}
            onChange={(event) => {
              const selectedAccount = accountOptions.find((option) => option.value === event.target.value);
              onChange({
                accountId: selectedAccount?.value,
                accountName: selectedAccount?.accountName ?? event.target.value,
                accountOwnerLabel: selectedAccount?.ownerLabel
              });
            }}
          >
            {accountOptions.map((option) => (
              <option key={option.id ?? option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{messages.entries.editOwner}</span>
          <select
            className="table-edit-input"
            value={entry.ownershipType === "shared" ? "Shared" : (entry.ownerName ?? "")}
            onChange={(event) => onOwnerChange(event.target.value)}
          >
            {ownerOptions.map((person) => (
              <option key={person} value={person}>{person}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{messages.entries.editAmount}</span>
          <input
            className={`table-edit-input table-edit-input-money ${amountToneClass}`}
            type="number"
            step="0.01"
            inputMode="decimal"
            value={formatEditableMinorInput(entry.amountMinor)}
            onChange={(event) => onChange({ amountMinor: Math.max(0, parseMoneyInput(event.target.value, entry.amountMinor)) })}
          />
        </label>
        <label>
          <span>{messages.entries.editType}</span>
          <select
            className={`table-edit-input ${typeToneClass}`}
            value={entry.entryType}
            onChange={(event) => onChange({ entryType: event.target.value })}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
        {entry.entryType === "transfer" ? (
          <label>
            <span>{messages.entries.editTransferDirection}</span>
            <select
              className="table-edit-input"
              value={entry.transferDirection ?? "out"}
              onChange={(event) => onChange({ transferDirection: event.target.value })}
            >
              <option value="out">Transfer out</option>
              <option value="in">Transfer in</option>
            </select>
          </label>
        ) : null}
        {transferTools}
        {entry.ownershipType === "shared" && splitPercentValue != null ? (
          <label>
            <span>{messages.entries.editSplit}</span>
            <input
              className="table-edit-input table-edit-input-money"
              type="number"
              min="0"
              max="100"
              value={splitPercentValue}
              onChange={(event) => onSplitPercentChange(Number(event.target.value))}
            />
          </label>
        ) : null}
      </div>
      <div className="entry-writing-grid">
        <label>
          <span>{messages.entries.editDescription}</span>
          <textarea
            className="table-edit-input table-edit-textarea"
            value={entry.description}
            onChange={(event) => onChange({ description: event.target.value })}
            rows={3}
          />
        </label>
        <label>
          <span>{messages.entries.editNote}</span>
          <textarea
            className="table-edit-input table-edit-textarea"
            value={entry.note ?? ""}
            onChange={(event) => onChange({ note: event.target.value })}
            rows={3}
          />
        </label>
      </div>
    </>
  );
}

// Transfer matching is row-editing behavior, but it lives beside the editor
// fields so the main entries panel does not carry the nested dialog markup.
export function EntryTransferTools({
  entry,
  categoryOptions,
  transferCandidates,
  transferDialogEntryId,
  transferSettlementDrafts,
  linkingTransferEntryId,
  settlingTransferEntryId,
  onEnsureSettlementDraft,
  onTransferDialogEntryChange,
  onSettlementDraftChange,
  onLinkCandidate,
  onSettleTransfer
}) {
  if (entry.entryType !== "transfer") {
    return null;
  }

  const isLinkedTransfer = Boolean(entry.linkedTransfer);

  return (
    <div className="entry-edit-transfer-helper">
      <span>Transfer match</span>
      <Dialog.Root
        open={transferDialogEntryId === entry.id}
        onOpenChange={(open) => {
          if (open) {
            onEnsureSettlementDraft(entry);
            onTransferDialogEntryChange(entry.id);
            return;
          }
          onTransferDialogEntryChange((current) => current === entry.id ? null : current);
        }}
      >
        <Dialog.Trigger asChild>
          <button type="button" className="subtle-action">
            Manage transfer
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content transfer-match-dialog">
            <div className="transfer-match-head">
              <div>
                <Dialog.Title>Transfer details</Dialog.Title>
                <Dialog.Description>
                  {isLinkedTransfer
                    ? "Review, relink, or break this matched transfer pair."
                    : "This row is marked as a transfer and still needs a matching wallet row."}
                </Dialog.Description>
              </div>
              <button
                type="button"
                className="icon-action subtle-cancel"
                aria-label="Close transfer manager"
                onClick={() => onTransferDialogEntryChange(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="transfer-match-layout">
              <section className="transfer-match-section">
                <h4>Wallets</h4>
                <div className="transfer-wallet-grid">
                  <div>
                    <span className="transfer-match-label">From wallet</span>
                    <strong>{getTransferWallets(entry).fromWalletName}</strong>
                  </div>
                  <div>
                    <span className="transfer-match-label">To wallet</span>
                    <strong>{getTransferWallets(entry).toWalletName}</strong>
                  </div>
                </div>
              </section>
              <section className="transfer-match-section">
                <h4>{isLinkedTransfer ? "Exact matches" : "Find matching side"}</h4>
                <span className="transfer-match-label">
                  {isLinkedTransfer ? "Potential exact matches" : "Potential rows with the same amount in another wallet"}
                </span>
                <div className="transfer-match-stack">
                  {transferCandidates.length ? transferCandidates.map((candidate) => {
                    const isCurrentLink = entry.linkedTransfer?.transactionId === candidate.id;
                    return (
                      <div key={candidate.id} className="transfer-match-card">
                        <div>
                          <strong>{candidate.accountName}</strong>
                          <p>{formatDateOnly(candidate.date)} • {candidate.description}</p>
                        </div>
                        {isCurrentLink ? (
                          <span className="entry-chip entry-chip-transfer">Current match</span>
                        ) : (
                          <button
                            type="button"
                            className="subtle-action"
                            disabled={linkingTransferEntryId === entry.id}
                            onClick={() => void onLinkCandidate(entry, candidate)}
                          >
                            Use match
                          </button>
                        )}
                      </div>
                    );
                  }) : (
                    <p className="transfer-match-empty">
                      {isLinkedTransfer
                        ? "No exact amount match found in another wallet for this month."
                        : "No matching row exists yet. Import or add the other side of this transfer, then link it here."}
                    </p>
                  )}
                </div>
              </section>
              <section className="transfer-match-section transfer-settlement">
                <h4>{isLinkedTransfer ? "Break connection" : "Not a transfer?"}</h4>
                <span className="transfer-match-label">
                  {isLinkedTransfer ? "Break connection and convert both sides" : "Convert this unmatched transfer into a regular entry"}
                </span>
                <div className="transfer-settlement-grid">
                  <label>
                    <span>This entry becomes</span>
                    <select
                      className="table-edit-input"
                      value={transferSettlementDrafts[entry.id]?.currentCategoryName ?? "Other"}
                      onChange={(event) => onSettlementDraftChange(entry.id, { currentCategoryName: event.target.value })}
                    >
                      {categoryOptions.filter((option) => option !== "Transfer").map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  {entry.linkedTransfer ? (
                    <label>
                      <span>Counterpart becomes</span>
                      <select
                        className="table-edit-input"
                        value={transferSettlementDrafts[entry.id]?.counterpartCategoryName ?? "Other"}
                        onChange={(event) => onSettlementDraftChange(entry.id, { counterpartCategoryName: event.target.value })}
                      >
                        {categoryOptions.filter((option) => option !== "Transfer").map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <p className="transfer-match-empty">
                  {isLinkedTransfer
                    ? "This removes the transfer link for both sides so you do not leave the counterpart behind as a transfer."
                    : "Use this only if the import classified the row as a transfer but it is actually normal income or spending."}
                </p>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={settlingTransferEntryId === entry.id}
                  onClick={() => void onSettleTransfer(entry)}
                >
                  {isLinkedTransfer ? "Break connection" : "Convert entry"}
                </button>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
