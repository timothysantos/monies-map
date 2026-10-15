import "./month-plan-sheet.css";
import { CalendarDays, List } from "lucide-react";
import { useId } from "react";

import { CategoryAppearancePopover } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { planStudioAddCopy } from "./copy/plan-studio-add-copy";
import { EntryMobileSheet } from "./entry-mobile-sheet";
import { selectAllOnFocus } from "./focus-utils";
import { formatMonthLabel } from "./formatters";
import { moniesClient } from "./monies-client-service";
import { moneyToneClass } from "./money-tone-class";
import { buildPlanSheetLead } from "./month-plan-sheet-model";
import { LastPeriodBudgetHint } from "./month-plan-tables";
import { ResponsiveSelect } from "./responsive-select";
import { BottomActions, DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";
import { useDraftChanged } from "./use-draft-changed";

const { categories: categoryService, format: formatService } = moniesClient;
const copy = messages.month.planSheet;
const table = messages.month.table;

// The fields the sheet edits: a change to any of them makes a swipe down
// ask "Discard changes?" before closing.
function pickPlanSheetFields(dialog) {
  return [dialog.plannedMinor, dialog.label, dialog.categoryValue, dialog.planDate, dialog.accountName, dialog.note];
}

// The Month plan-row sheet on a phone or portrait tablet (income, planned
// items, budget buckets; add and edit), in the Lead · Support · Detail
// language (design.md). The planned amount is the lead you type (sky, with
// the number keypad), actual against it is the bar; month, owner and entry
// count are Support chips; the other fields are Detail rows that edit in
// place. Done and Cancel sit in the bottom bar. MonthPanel keeps the draft
// (`dialog`) and every save, cancel and drilldown handler; this only lays
// the fields out.
export function MonthPlanSheet({
  dialog,
  monthKey,
  categories,
  categoryOptions,
  accountOptions,
  errorMessage,
  isSaving,
  onChange,
  onCategoryChange,
  onCategoryAppearanceChange,
  onOpenEntriesForActual,
  onClose,
  onSave
}) {
  // A line added from Plan Studio has an optional due date: it is a planned
  // item once it has one and a budget bucket without (month-panel.jsx).
  const isStudioAdd = dialog.kind === "plan" && Boolean(dialog.studioAdd);
  const isPlannedItem = dialog.kind === "plan" && (dialog.sectionKey === "planned_items" || isStudioAdd);
  const isBudgetBucket = dialog.kind === "plan" && dialog.sectionKey === "budget_buckets";
  const category = categoryService.get(categories, { categoryId: dialog.categoryValue, categoryName: dialog.categoryValue });
  const entryCount = dialog.actualEntryIds?.length ?? 0;
  const monthLabel = monthKey ? formatMonthLabel(monthKey) : "";
  const lead = buildPlanSheetLead({
    kind: dialog.kind,
    mode: dialog.mode,
    actualMinor: dialog.actualMinor ?? 0,
    plannedMinor: formatService.parseDraftMoneyInput(dialog.plannedMinor)
  });
  const actualMoney = formatService.money(lead.progress.valueMinor);
  const isDirty = useDraftChanged(dialog, pickPlanSheetFields);
  const saveLabel = isSaving ? messages.common.saving : messages.month.doneEdit;
  const categoryLabelId = useId();
  const accountLabelId = useId();

  return (
    <EntryMobileSheet
      className="month-plan-sheet-dialog"
      title={dialog.title}
      description={copy.context(dialog.ownerLabel, monthLabel)}
      errorMessage={errorMessage}
      saveLabel={saveLabel}
      isSaveDisabled={isSaving}
      isSubmitting={isSaving}
      isDirty={isDirty}
      onClose={onClose}
      onSave={onSave}
      footerContent={(
        <BottomActions
          className="is-sheet-bar"
          primaryLabel={saveLabel}
          primaryDisabled={isSaving}
          quietLabel={messages.month.cancelEdit}
          onQuiet={onClose}
        />
      )}
    >
      <div className="month-plan-sheet">
        {dialog.sharedEditHint ? <p className="month-shared-edit-hint">{dialog.sharedEditHint}</p> : null}
        <LeadCard
          className="month-plan-lead"
          bubble={<CategoryAppearancePopover category={category} onChange={onCategoryAppearanceChange} />}
          accentColor={category?.colorHex}
          title={dialog.label || category?.name || copy.kind[dialog.sectionKey ?? "income"]}
          subtitle={isStudioAdd ? dialog.studioSubtitle : copy.kind[dialog.kind === "income" ? "income" : dialog.sectionKey]}
          editable
          amount={(
            <>
              <span className={`month-plan-lead-currency ${moneyToneClass("plan")}`} aria-hidden="true">$</span>
              <input
              className={`month-plan-lead-input ${moneyToneClass("plan")}`}
              // As wide as the figure, so a long item name keeps its line.
              style={{ width: `${Math.max(3, String(dialog.plannedMinor ?? "").length)}ch` }}
              aria-label={table.planned}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              value={dialog.plannedMinor ?? ""}
              onMouseDown={selectAllOnFocus}
              onFocus={selectAllOnFocus}
              onChange={(event) => onChange({ plannedMinor: event.target.value, autoPlannedFromCategory: false })}
              />
            </>
          )}
          amountCaption={copy.plannedCaption}
          progress={lead.showProgress ? lead.progress : null}
          progressStart={lead.showProgress ? <><strong>{actualMoney}</strong> {copy[lead.actualWord]}</> : null}
          hiddenProgressStart={lead.showProgress ? `${copy[`${lead.actualWord}Hidden`]} ${actualMoney}` : null}
          progressEnd={lead.showProgress && lead.end ? (
            <span className={moneyToneClass(lead.end.tone)}>{formatService.money(lead.end.amountMinor)} {copy[lead.end.word]}</span>
          ) : null}
          chips={(
            <>
              {monthLabel ? <MetaChip icon={CalendarDays}>{monthLabel}</MetaChip> : null}
              {dialog.ownerLabel ? <MetaChip person={dialog.ownerLabel}>{dialog.ownerLabel}</MetaChip> : null}
              {entryCount > 0 ? <MetaChip icon={List}>{copy.entryCount(entryCount)}</MetaChip> : null}
            </>
          )}
        >
          {isBudgetBucket ? (
            <LastPeriodBudgetHint actualMinor={dialog.lastPeriodActualMinor} month={dialog.lastPeriodMonth} />
          ) : null}
        </LeadCard>

        <DetailRows label={copy.detailsLabel}>
          <DetailRow
            label={table.actual}
            className="month-actual-drilldown-mobile"
            action={entryCount > 0}
            value={entryCount > 0 ? copy.seeEntries(entryCount) : copy.noEntries}
            disabled={entryCount === 0}
            onClick={() => onOpenEntriesForActual({ categoryName: dialog.categoryValue, entryIds: dialog.actualEntryIds ?? [] })}
          />
          <DetailRow label={copy.itemName}>
            <input
              value={dialog.label ?? ""}
              onChange={(event) => onChange({ label: event.target.value, autoLabelFromCategory: false })}
            />
          </DetailRow>
          <DetailRow label={table.category} labelId={categoryLabelId}>
            <ResponsiveSelect
              className="table-edit-input"
              labelId={categoryLabelId}
              title={table.category}
              value={dialog.categoryValue ?? ""}
              options={categoryOptions}
              onValueChange={onCategoryChange}
            />
          </DetailRow>
          {isPlannedItem ? (
            <DetailRow label={isStudioAdd ? planStudioAddCopy.dueDate : table.day}>
              <input
                type="date"
                value={dialog.planDate ?? ""}
                onChange={(event) => onChange({ planDate: event.target.value })}
              />
            </DetailRow>
          ) : null}
          {isPlannedItem && (!isStudioAdd || dialog.planDate) ? (
            <DetailRow label={table.account} labelId={accountLabelId}>
              <ResponsiveSelect
                className="table-edit-input"
                labelId={accountLabelId}
                title={table.account}
                value={dialog.accountName ?? ""}
                options={[{ value: "", label: messages.common.emptyValue }, ...accountOptions]}
                onValueChange={(nextValue) => onChange({ accountName: nextValue })}
              />
            </DetailRow>
          ) : null}
          <DetailRow label={table.note}>
            <textarea
              rows={1}
              placeholder={copy.addNote}
              value={dialog.note ?? ""}
              onChange={(event) => onChange({ note: event.target.value })}
            />
          </DetailRow>
        </DetailRows>
      </div>
    </EntryMobileSheet>
  );
}
