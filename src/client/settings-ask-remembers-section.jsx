import { ChevronRight, Sparkles } from "lucide-react";
import { categoryPickOptions } from "./category-pick-options";
import { useCallback, useEffect, useId, useState } from "react";

import { forgetEverything, requestHabitsOverview, saveHandlesSafeThings, stopHabit, updateHabit } from "./ask-habits-api";
import { askHabitsCopy } from "./copy/ask-habits-copy";
import { DeleteRowButton } from "./delete-row-button";
import { PickerRow } from "./detail-field-rows";
import { SettingsSection } from "./settings-section";
import { SheetDialog } from "./sheet-dialog";
import { DetailRows, LeadCard, MetaChip } from "./ui-components";
import { EmptyState } from "./ui-states";
import { useIsMobileLayout } from "./use-viewport";

const copy = askHabitsCopy.settings;

// Share choices for a split habit: the payer's share, 10% to 90%.
const SHARE_OPTIONS = [90, 80, 70, 60, 50, 40, 30, 20, 10].map((payer) => ({ value: String(payer), label: copy.sharePercent(payer) }));

// Settings > What Ask remembers (docs/flows/ask-flow.md "Hands-off"): the
// switch for "Let Ask handle safe things", then what Ask has learned from
// what the household confirms (a shop's category, a shop's usual split, a
// nickname), each one changeable or forgettable, and Forget everything.
// It reads and writes its own routes (no AI), so the Settings page DTO does
// not carry it. Habits are structured facts, never chat text.
export function SettingsAskRemembersSection({ isOpen, onToggle, categories }) {
  const [overview, setOverview] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const switchId = useId();

  const load = useCallback(async (signal) => {
    const next = await requestHabitsOverview({ signal });
    if (signal?.aborted) return;
    setOverview(next);
    setError(next ? "" : copy.loadFailed);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const enabled = overview?.enabled !== false;
  const habits = overview?.habits ?? [];
  const value = !overview ? null : !enabled ? copy.statusOff : habits.length ? copy.status(habits.length) : copy.statusNone;

  async function toggleEnabled() {
    if (!overview || saving) return;
    const next = !enabled;
    setSaving(true);
    setError("");
    const result = await saveHandlesSafeThings(next);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOverview((current) => (current ? { ...current, enabled: next } : current));
  }

  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    setError("");
    const body = editing.habit.edit.kind === "category"
      ? { id: editing.habit.id, categoryName: editing.categoryName }
      : editing.habit.edit.kind === "split"
        ? { id: editing.habit.id, payerSharePercent: Number(editing.payerSharePercent) }
        : { id: editing.habit.id, personId: editing.personId };
    const result = await updateHabit(body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    setStatus("");
    await load();
  }

  async function forgetOne(habit) {
    const result = await stopHabit(habit.id);
    if (!result.ok) throw new Error(result.error);
    await load();
  }

  async function forgetAll() {
    const result = await forgetEverything();
    if (!result.ok) throw new Error(result.error);
    setStatus(copy.forgotten);
    await load();
  }

  return (
    <SettingsSection id="settings-ask-remembers" title={copy.title} value={value} isOpen={isOpen} onToggle={onToggle}>
      <div className="settings-habit-toggle">
        <div className="settings-habit-toggle-copy">
          <label htmlFor={switchId}>{copy.toggleLabel}</label>
          <p className="settings-hint">{copy.toggleHint}</p>
        </div>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={enabled}
          className="settings-switch"
          disabled={!overview || saving}
          data-ask-handles-safe
          onClick={() => void toggleEnabled()}
        >
          <span className="sr-only">{copy.toggleLabel}</span>
        </button>
      </div>

      <h4 className="settings-habit-heading">{copy.habitsTitle}</h4>
      {overview && !overview.available ? <p className="settings-hint">{copy.unavailable}</p> : null}
      {habits.length ? (
        <DetailRows label={copy.habitsTitle}>
          {habits.map((habit) => (
            <div key={habit.id} className="lsd-row settings-split-row settings-habit-row" data-habit-id={habit.id}>
              <button type="button" className="settings-row-main" aria-label={copy.editTitle(habit.label)} onClick={() => setEditing({ habit, categoryName: habit.edit.categoryName ?? "", payerSharePercent: String(habit.edit.payerSharePercent ?? 50), personId: habit.edit.personId ?? "" })}>
                <span className="settings-row-text">
                  <strong>{habit.label}</strong>
                  <small>{habit.text}</small>
                  <MetaChip tone={habit.sure ? "mint" : undefined}>{habit.sure ? copy.sure : copy.suggestOnly}</MetaChip>
                </span>
                <ChevronRight size={16} aria-hidden="true" className="lsd-row-chevron" />
              </button>
              <DeleteRowButton
                label={habit.label}
                triggerLabel={`${copy.delete}: ${habit.label}`}
                confirmLabel={copy.delete}
                destructive={false}
                buttonClassName="settings-row-icon"
                prompt={copy.deletePrompt(habit.label)}
                onConfirm={() => forgetOne(habit)}
              />
            </div>
          ))}
        </DetailRows>
      ) : overview ? <EmptyState>{copy.empty}</EmptyState> : null}

      {habits.length ? (
        <div className="settings-habit-forget">
          <DeleteRowButton
            label={copy.forgetTitle}
            triggerLabel={copy.forget}
            confirmLabel={copy.forget}
            prompt={copy.forgetPrompt}
            buttonClassName="settings-habit-forget-button"
            onConfirm={forgetAll}
          >
            {copy.forget}
          </DeleteRowButton>
        </div>
      ) : null}
      {status ? <p className="settings-hint" role="status">{status}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {editing ? (
        <HabitEditDialog
          editing={editing}
          categories={categories}
          people={overview?.people ?? []}
          saving={saving}
          onChange={setEditing}
          onClose={() => { setEditing(null); setError(""); }}
          onSave={() => void saveEdit()}
        />
      ) : null}
    </SettingsSection>
  );
}

function HabitEditDialog({ editing, categories, people, saving, onChange, onClose, onSave }) {
  const isSheet = useIsMobileLayout();
  const [openRow, setOpenRow] = useState(null);
  const { habit } = editing;
  const rowOpenProps = (key) => ({ open: openRow === key, onOpenChange: (open) => setOpenRow(open ? key : null) });
  const set = (patch) => onChange((current) => (current ? { ...current, ...patch } : current));
  const person = people.find((item) => item.id === editing.personId);
  const unchanged = habit.edit.kind === "category"
    ? editing.categoryName === habit.edit.categoryName
    : habit.edit.kind === "split"
      ? Number(editing.payerSharePercent) === habit.edit.payerSharePercent
      : editing.personId === habit.edit.personId;

  return (
    <SheetDialog
      className="settings-account-dialog"
      title={copy.editTitle(habit.label)}
      description={habit.text}
      descriptionHidden
      closeLabel={copy.cancel}
      lead={<LeadCard className="sheet-dialog-lead" category={{ icon: Sparkles }} title={habit.label} subtitle={habit.text} />}
      primaryLabel={saving ? copy.saving : copy.save}
      primaryDisabled={saving || unchanged}
      isSubmitting={saving}
      isDirty={!unchanged}
      onSubmit={onSave}
      onClose={onClose}
    >
      <DetailRows label={copy.editTitle(habit.label)}>
        {habit.edit.kind === "category" ? (
          <PickerRow
            isSheet={isSheet}
            rowKey="category"
            label={copy.categoryField}
            valueLabel={editing.categoryName}
            value={editing.categoryName}
            options={categoryPickOptions(categories)}
            categoryPick={{}}
            onValueChange={(next) => set({ categoryName: next })}
            {...rowOpenProps("category")}
          />
        ) : null}
        {habit.edit.kind === "split" ? (
          <PickerRow
            isSheet={isSheet}
            rowKey="share"
            label={copy.shareField}
            valueLabel={copy.sharePercent(Number(editing.payerSharePercent))}
            value={editing.payerSharePercent}
            options={SHARE_OPTIONS}
            onValueChange={(next) => set({ payerSharePercent: next })}
            {...rowOpenProps("share")}
          />
        ) : null}
        {habit.edit.kind === "alias" ? (
          <PickerRow
            isSheet={isSheet}
            rowKey="person"
            label={copy.personField}
            valueLabel={person?.name ?? ""}
            value={editing.personId}
            options={people.map((item) => ({ value: item.id, label: item.name }))}
            onValueChange={(next) => set({ personId: next })}
            {...rowOpenProps("person")}
          />
        ) : null}
      </DetailRows>
    </SheetDialog>
  );
}
