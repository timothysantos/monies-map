import { ChevronRight, CreditCard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { requestCardRewardRules, saveCardRewardRules, saveCardRewardSuggestFrom } from "./card-rewards-api";
import { categoryPickOptions } from "./category-pick-options";
import { cardRewardsCopy } from "./copy/card-rewards-copy";
import { PickerRow } from "./detail-field-rows";
import { selectAllOnFocus } from "./focus-utils";
import { money } from "./formatters";
import { SettingsSection } from "./settings-section";
import { SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows, FilterMultiSelect, LeadCard, MetaChip } from "./ui-components";
import { EmptyState } from "./ui-states";
import { useIsMobileLayout } from "./use-viewport";

const copy = cardRewardsCopy.settings;

// Settings > Cards and rewards (DOMAIN.md "Card reward rule"): "Suggest
// cards from" (the whole household by default, owner decision 2026-11-10),
// then each credit card with what it pays back. A card opens its rules in
// the usual sheet: miles or cashback, the usual rate, bonus rules (the one
// category list, the way paid, the rate, the cap and when it starts again),
// what earns nothing and a cashback card's monthly minimum, with "Reset to
// the usual rules". Every save shows a line with Undo. It reads and writes
// its own routes (no AI), so the Settings page DTO does not carry it.

const UNIT_OPTIONS = [{ value: "miles", label: copy.unitMiles }, { value: "cashback", label: copy.unitCashback }];
const SUGGEST_OPTIONS = [{ value: "household", label: copy.suggestHousehold }, { value: "own", label: copy.suggestOwn }];
const MATCH_OPTIONS = [{ value: "both", label: copy.matchBoth }, { value: "either", label: copy.matchEither }];
const RESET_OPTIONS = [{ value: "calendar", label: copy.resetsCalendar }, { value: "statement", label: copy.resetsStatement }];

// Rules as the sheet edits them: numbers as the text typed.
const dollars = (minor) => (minor === null || minor === undefined ? "" : String(minor / 100));
function toDraft(rules) {
  const source = rules ?? { unit: "miles", baseRate: 0, bonuses: [], excludedCategories: [], minSpendMinor: null, minCount: null };
  return {
    unit: source.unit,
    baseRate: String(source.baseRate),
    excludedCategories: [...source.excludedCategories],
    minSpend: dollars(source.minSpendMinor),
    minCount: source.minCount === null || source.minCount === undefined ? "" : String(source.minCount),
    bonuses: source.bonuses.map((bonus) => ({
      id: bonus.id,
      categories: [...bonus.categories],
      exceptCategories: [...(bonus.exceptCategories ?? [])],
      channels: [...bonus.channels].sort().join(","),
      match: bonus.match ?? "both",
      rate: String(bonus.rate),
      cap: dollars(bonus.capMinor),
      cycleKind: bonus.cycle.kind,
      cycleDay: String(bonus.cycle.day ?? 1)
    }))
  };
}

const toNumber = (text) => {
  const value = Number(String(text).replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? value : NaN;
};
const toMinor = (text) => (String(text).trim() === "" ? null : Math.round(toNumber(text) * 100));

// The draft as rules for the server, or null when a number does not read.
export function draftToRules(draft) {
  const baseRate = toNumber(draft.baseRate);
  const bonuses = draft.bonuses.map((bonus) => ({
    id: bonus.id,
    categories: bonus.categories,
    exceptCategories: bonus.exceptCategories,
    channels: bonus.channels ? bonus.channels.split(",") : [],
    match: bonus.match,
    rate: toNumber(bonus.rate),
    capMinor: toMinor(bonus.cap),
    cycle: { kind: bonus.cycleKind, day: bonus.cycleKind === "statement" ? toNumber(bonus.cycleDay) : 1 }
  }));
  const minSpendMinor = draft.unit === "cashback" ? toMinor(draft.minSpend) : null;
  const minCount = draft.unit === "cashback" && String(draft.minCount).trim() !== "" ? toNumber(draft.minCount) : null;
  const numbers = [baseRate, ...bonuses.flatMap((bonus) => [bonus.rate, bonus.capMinor ?? 0, bonus.cycle.day]), minSpendMinor ?? 0, minCount ?? 0];
  if (numbers.some((value) => Number.isNaN(value))) return null;
  return { unit: draft.unit, baseRate, bonuses, excludedCategories: draft.excludedCategories, minSpendMinor, minCount };
}

/** @param {{ isOpen: boolean, onToggle: () => void, categories: any[] }} props */
export function SettingsCardRewardsSection({ isOpen, onToggle, categories }) {
  const queryClient = useQueryClient();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState("");
  // The line after a change: what was done and how to put it back.
  const [notice, setNotice] = useState(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const load = useCallback(async (signal) => {
    const next = await requestCardRewardRules({ signal });
    if (signal?.aborted) return;
    setOverview(next);
    setError(next ? "" : copy.loadFailed);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [isOpen, load]);

  // The Summary card reads its answer again next time.
  const afterChange = () => {
    void queryClient.invalidateQueries({ queryKey: ["card-rewards"] });
    return load();
  };

  async function changeSuggestFrom(from) {
    if (!overview || from === overview.suggestFrom) return;
    setError("");
    const result = await saveCardRewardSuggestFrom(from);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const label = SUGGEST_OPTIONS.find((option) => option.value === result.current)?.label ?? "";
    setNotice({ text: copy.savedSuggest(label), undo: () => saveCardRewardSuggestFrom(result.previous) });
    await afterChange();
  }

  async function runChange(card, body, words) {
    setSaving(true);
    setSheetError("");
    const result = await saveCardRewardRules({ accountId: card.accountId, ...body });
    setSaving(false);
    if (!result.ok) {
      setSheetError(result.error);
      return false;
    }
    setEditing(null);
    setNotice({ text: words, undo: () => saveCardRewardRules({ accountId: card.accountId, action: "restore", rules: result.previous }) });
    await afterChange();
    return true;
  }

  async function undo() {
    if (!notice?.undo) return;
    const result = await notice.undo();
    setNotice(result.ok ? { text: copy.restored(cardRewardsCopy.settings.title), undo: null } : { ...notice, text: copy.saveFailed });
    if (result.ok) await afterChange();
  }

  const cards = overview?.cards ?? [];
  return (
    <SettingsSection id="settings-card-rewards" title={copy.title} value={overview ? copy.status(cards.length) : null} isOpen={isOpen} onToggle={onToggle}>
      <p className="settings-hint">{copy.intro}</p>
      {overview ? (
        <DetailRows label={copy.suggestFrom}>
          <PickerRow
            isSheet={false}
            rowKey="suggest-from"
            label={copy.suggestFrom}
            valueLabel={SUGGEST_OPTIONS.find((option) => option.value === overview.suggestFrom)?.label ?? ""}
            value={overview.suggestFrom}
            options={SUGGEST_OPTIONS}
            open={suggestOpen}
            onOpenChange={setSuggestOpen}
            onValueChange={(next) => void changeSuggestFrom(next)}
          />
        </DetailRows>
      ) : null}
      {overview ? <p className="settings-hint">{copy.suggestHint}</p> : null}

      <h4 className="settings-habit-heading">{copy.cardsTitle}</h4>
      {cards.length ? (
        <DetailRows label={copy.cardsTitle}>
          {cards.map((card) => (
            <div key={card.accountId} className={`lsd-row settings-split-row settings-habit-row${card.isActive ? "" : " is-muted"}`} data-card-rewards={card.accountId}>
              <button type="button" className="settings-row-main" aria-label={copy.editTitle(card.name)} onClick={() => { setSheetError(""); setEditing({ card, draft: toDraft(card.rules) }); }}>
                <span className="settings-row-text">
                  <strong>{card.name}{card.ownerName ? ` · ${card.ownerName}` : ""}</strong>
                  <small>{copy.summary(card.rules, money)}</small>
                  {card.rules ? <MetaChip tone={card.isUsual ? "mint" : undefined}>{card.isUsual ? copy.usualChip : copy.changedChip}</MetaChip> : <MetaChip>{copy.notSetUp}</MetaChip>}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="lsd-row-chevron" />
              </button>
            </div>
          ))}
        </DetailRows>
      ) : overview ? <EmptyState>{copy.empty}</EmptyState> : null}

      {notice ? (
        <p className="settings-hint" role="status">
          {notice.text}{" "}
          {notice.undo ? <button type="button" className="subtle-action" onClick={() => void undo()}>{copy.undo}</button> : null}
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {editing ? (
        <CardRewardsDialog
          editing={editing}
          categories={categories}
          saving={saving}
          errorMessage={sheetError}
          onChange={(draft) => setEditing((current) => (current ? { ...current, draft } : current))}
          onClose={() => { setEditing(null); setSheetError(""); }}
          onSave={() => {
            const rules = draftToRules(editing.draft);
            if (!rules) {
              setSheetError(copy.badNumber);
              return;
            }
            void runChange(editing.card, { action: "save", rules }, copy.saved(editing.card.name));
          }}
          onReset={() => void runChange(editing.card, { action: "reset" }, copy.wasReset(editing.card.name))}
        />
      ) : null}
    </SettingsSection>
  );
}

function NumberRow({ label, value, onChange, rowKey }) {
  return (
    <DetailRow label={label} data-row={rowKey}>
      <input inputMode="decimal" value={value} enterKeyHint="next" onMouseDown={selectAllOnFocus} onFocus={selectAllOnFocus} onChange={(event) => onChange(event.target.value)} />
    </DetailRow>
  );
}

function CategoryListRow({ label, values, options, emptyLabel, onChange }) {
  return (
    <DetailRow label={label}>
      <FilterMultiSelect
        label={label}
        values={values}
        options={options}
        emptyLabel={emptyLabel}
        categoryPick
        selectionLabel={(selected) => (selected.length <= 2 ? selected.map((option) => option.label).join(", ") : copy.selected(selected.length))}
        onChange={onChange}
      />
    </DetailRow>
  );
}

function CardRewardsDialog({ editing, categories, saving, errorMessage, onChange, onClose, onSave, onReset }) {
  const isSheet = useIsMobileLayout();
  const [openRow, setOpenRow] = useState(null);
  const { card, draft } = editing;
  const rowOpenProps = (key) => ({ open: openRow === key, onOpenChange: (open) => setOpenRow(open ? key : null) });
  const set = (patch) => onChange({ ...draft, ...patch });
  const setBonus = (index, patch) => set({ bonuses: draft.bonuses.map((bonus, at) => (at === index ? { ...bonus, ...patch } : bonus)) });
  // Category names, so a renamed category still shows as written.
  const options = categoryPickOptions(categories);
  const original = toDraft(card.rules);
  const isDirty = JSON.stringify(original) !== JSON.stringify(draft);
  const canReset = Boolean(card.usual || card.rules);

  return (
    <SheetDialog
      className="settings-account-dialog settings-card-rewards-dialog"
      title={copy.editTitle(card.name)}
      description={copy.intro}
      descriptionHidden
      closeLabel={copy.cancel}
      lead={<LeadCard className="sheet-dialog-lead" category={{ icon: CreditCard }} title={card.name} subtitle={card.ownerName || undefined} />}
      primaryLabel={saving ? copy.saving : card.rules ? copy.save : copy.setUp}
      primaryDisabled={saving || (!isDirty && Boolean(card.rules))}
      isSubmitting={saving}
      isDirty={isDirty}
      errorMessage={errorMessage}
      destructive={canReset ? (
        <button type="button" className="subtle-action" disabled={saving} onClick={onReset} data-card-rewards-reset>
          {card.usual ? copy.reset : copy.resetNone}
        </button>
      ) : null}
      onSubmit={onSave}
      onClose={onClose}
    >
      <DetailRows label={copy.editTitle(card.name)}>
        <PickerRow
          isSheet={isSheet}
          rowKey="unit"
          label={copy.unitField}
          valueLabel={UNIT_OPTIONS.find((option) => option.value === draft.unit)?.label ?? ""}
          value={draft.unit}
          options={UNIT_OPTIONS}
          onValueChange={(unit) => set({ unit })}
          {...rowOpenProps("unit")}
        />
        <NumberRow rowKey="base" label={copy.baseField(draft.unit)} value={draft.baseRate} onChange={(baseRate) => set({ baseRate })} />
        <CategoryListRow label={copy.excluded} values={draft.excludedCategories} options={options} emptyLabel={copy.noneExcluded} onChange={(excludedCategories) => set({ excludedCategories })} />
        {draft.unit === "cashback" ? (
          <>
            <NumberRow rowKey="min-spend" label={copy.minSpend} value={draft.minSpend} onChange={(minSpend) => set({ minSpend })} />
            <NumberRow rowKey="min-count" label={copy.minCount} value={draft.minCount} onChange={(minCount) => set({ minCount })} />
          </>
        ) : null}
      </DetailRows>

      {draft.bonuses.map((bonus, index) => (
        <div key={bonus.id} className="settings-card-rewards-bonus" data-bonus={bonus.id}>
          <h4 className="settings-habit-heading">{copy.bonusHeading(index + 1)}</h4>
          <DetailRows label={copy.bonusHeading(index + 1)}>
            <CategoryListRow label={copy.bonusCategories} values={bonus.categories} options={options} emptyLabel={copy.anyCategory} onChange={(next) => setBonus(index, { categories: next })} />
            <PickerRow
              isSheet={isSheet}
              rowKey={`channel-${index}`}
              label={copy.bonusChannel}
              valueLabel={copy.channelOptions.find((option) => option.value === bonus.channels)?.label ?? bonus.channels}
              value={bonus.channels}
              options={copy.channelOptions.some((option) => option.value === bonus.channels) ? copy.channelOptions : [...copy.channelOptions, { value: bonus.channels, label: bonus.channels }]}
              onValueChange={(channels) => setBonus(index, { channels })}
              {...rowOpenProps(`channel-${index}`)}
            />
            {bonus.categories.length && bonus.channels ? (
              <PickerRow
                isSheet={isSheet}
                rowKey={`match-${index}`}
                label={copy.bonusMatch}
                valueLabel={MATCH_OPTIONS.find((option) => option.value === bonus.match)?.label ?? ""}
                value={bonus.match}
                options={MATCH_OPTIONS}
                onValueChange={(match) => setBonus(index, { match })}
                {...rowOpenProps(`match-${index}`)}
              />
            ) : null}
            <NumberRow rowKey={`rate-${index}`} label={copy.bonusRate(draft.unit)} value={bonus.rate} onChange={(rate) => setBonus(index, { rate })} />
            <NumberRow rowKey={`cap-${index}`} label={copy.bonusCap} value={bonus.cap} onChange={(cap) => setBonus(index, { cap })} />
            <PickerRow
              isSheet={isSheet}
              rowKey={`resets-${index}`}
              label={copy.bonusResets}
              valueLabel={RESET_OPTIONS.find((option) => option.value === bonus.cycleKind)?.label ?? ""}
              value={bonus.cycleKind}
              options={RESET_OPTIONS}
              onValueChange={(cycleKind) => setBonus(index, { cycleKind })}
              {...rowOpenProps(`resets-${index}`)}
            />
            {bonus.cycleKind === "statement" ? (
              <NumberRow rowKey={`day-${index}`} label={copy.statementDay} value={bonus.cycleDay} onChange={(cycleDay) => setBonus(index, { cycleDay })} />
            ) : null}
            <CategoryListRow label={copy.bonusExcept} values={bonus.exceptCategories} options={options} emptyLabel={copy.noneLeftOut} onChange={(next) => setBonus(index, { exceptCategories: next })} />
          </DetailRows>
          <button type="button" className="subtle-action" onClick={() => set({ bonuses: draft.bonuses.filter((_, at) => at !== index) })}>{copy.removeBonus}</button>
        </div>
      ))}
      {draft.bonuses.length < 6 ? (
        <button
          type="button"
          className="subtle-action"
          data-card-rewards-add-bonus
          onClick={() => set({ bonuses: [...draft.bonuses, { id: `bonus-${Date.now().toString(36).slice(-6)}`, categories: [], exceptCategories: [], channels: "", match: "both", rate: "", cap: "", cycleKind: "calendar", cycleDay: "1" }] })}
        >
          {copy.addBonus}
        </button>
      ) : null}
      {card.usual ? (
        <>
          <p className="settings-hint">{copy.usualFrom(card.usual.source)}</p>
          <p className="settings-hint">{copy.check(card.usual.check)}</p>
        </>
      ) : null}
    </SheetDialog>
  );
}
