import { Fragment } from "react";
import { ResponsiveSelect } from "./responsive-select";
import { categoryPickOptions } from "./category-pick-options";
import * as Popover from "@radix-ui/react-popover";
import { ChevronRight, SquarePen, X } from "lucide-react";

import { CategoryAppearancePopover } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import {
  canInlineEditMonthPlanRow,
  canOpenMonthMobileSheet,
  getMonthPlanSharedEditHint
} from "./month-row-editing";
import { getMonthPlanEditSource } from "./month-state";
import { formatRowDateLabel, getRowDateValue, sortRows } from "./table-helpers";
import { DeleteRowButton } from "./delete-row-button";
import { SortableHeader } from "./ui-components";
import { leadProgress } from "./ui/lead-support-detail";
import { useIsMobileLayout, useIsMonthSheetLayout } from "./use-viewport";
import { moneyToneClass } from "./money-tone-class";
import { rowMotionProps } from "./row-motion";
import { flowTone, headroomTone, incomeVarianceTone, spendTone } from "../domain/money-tone";

const { categories: categoryService, format: formatService, months: monthService } = moniesClient;

const SECTION_ORDER = {
  budget_buckets: 0,
  planned_items: 1
};

// A thin actual-against-plan bar under a plan row's actual figure (design.md,
// "Lead · Support · Detail"): the same fill rule as the lead card's bar,
// rose only past the plan; money received (income) fills mint. Hidden money
// keeps only the empty track, since its length would say over or under plan.
function PlanRowBar({ actualMinor, plannedMinor, isIncome = false }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { percent, isOver } = leadProgress(actualMinor, plannedMinor, { overIsShort: !isIncome });
  const tone = isIncome ? "in" : isOver ? "short" : "neutral";
  return (
    <span className="lsd-bar month-row-bar" aria-hidden="true">
      {areTotalsVisible ? <span className={`lsd-bar-fill ${moneyToneClass(tone)}`} style={{ width: `${percent}%` }} /> : null}
    </span>
  );
}

function isPlannedItemsSection(sectionKey) {
  return sectionKey === "planned_items";
}

function isBudgetBucketsSection(sectionKey) {
  return sectionKey === "budget_buckets";
}

function shouldIgnoreRowOpenTarget(target) {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a, [role='button']"));
}

// Table rendering stays separate from persistence so MonthPanel keeps the write
// flow in one place.
//
// Month-table terms:
// - "income" rows are planned incoming money for the month.
// - "planned_items" are one-off planned rows that can link to exact entries.
// - "budget_buckets" are category budgets that usually compare against grouped
//   category totals instead of one specific ledger row.
export function MonthPlanStack({
  view,
  categories,
  categorySelectOptions = categoryService.listForSelect(categories),
  accounts,
  accountSelectOptions,
  incomeRows,
  planSections,
  sectionOpen,
  tableSorts,
  editingRowId,
  editingDrafts,
  isSavingEdit = false,
  isCombinedHouseholdView,
  monthKey,
  onToggleSection,
  onAddIncomeRow,
  onAddPlanRow,
  onBudgetBucketCategoryChange,
  onBudgetBucketLabelChange,
  onBudgetBucketPlannedMinorDraftChange,
  onBeginIncomeEdit,
  onBeginPlanEdit,
  onIncomeRowChange,
  onPlanRowChange,
  onEditingDraftChange,
  onFinishEdit,
  onCancelEdit,
  onRemoveIncomeRow,
  onRemovePlanRow,
  onOpenNoteDialog,
  onOpenPlanLinkDialog,
  onOpenEntriesForActual,
  onSortChange,
  onCategoryAppearanceChange,
  saveErrorMessage = ""
}) {
  const sortedIncomeRows = sortRows(incomeRows, tableSorts.income, monthKey);
  const sortedSections = [...planSections].sort((left, right) => SECTION_ORDER[left.key] - SECTION_ORDER[right.key]);

  return (
    <div className="month-plan-stack" id="month-plan">
      <p className={`month-plan-stack-hint ${isCombinedHouseholdView ? "is-readonly" : ""}`}>
        {isCombinedHouseholdView ? messages.month.readOnlyCombinedHint : messages.month.editHint}
      </p>
      <IncomePlanSection
        categories={categories}
        categorySelectOptions={categorySelectOptions}
        incomeRows={incomeRows}
        sortedIncomeRows={sortedIncomeRows}
        sectionOpen={sectionOpen}
        tableSorts={tableSorts}
        editingRowId={editingRowId}
        editingDrafts={editingDrafts}
        isSavingEdit={isSavingEdit}
        isCombinedHouseholdView={isCombinedHouseholdView}
        onToggleSection={onToggleSection}
        onAddIncomeRow={onAddIncomeRow}
        onBeginIncomeEdit={onBeginIncomeEdit}
        onIncomeRowChange={onIncomeRowChange}
        onEditingDraftChange={onEditingDraftChange}
        onFinishEdit={onFinishEdit}
        onCancelEdit={onCancelEdit}
        onRemoveIncomeRow={onRemoveIncomeRow}
        onOpenNoteDialog={onOpenNoteDialog}
        onOpenEntriesForActual={onOpenEntriesForActual}
        onSortChange={onSortChange}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        saveErrorMessage={saveErrorMessage}
      />
      {sortedSections.map((section) => (
        <PlanningSection
          key={section.key}
          view={view}
          categories={categories}
          categorySelectOptions={categorySelectOptions}
          accounts={accounts}
          accountSelectOptions={accountSelectOptions}
          section={section}
          sectionOpen={sectionOpen}
          tableSorts={tableSorts}
          editingRowId={editingRowId}
          editingDrafts={editingDrafts}
          isSavingEdit={isSavingEdit}
          isCombinedHouseholdView={isCombinedHouseholdView}
          monthKey={monthKey}
          onToggleSection={onToggleSection}
          onAddPlanRow={onAddPlanRow}
          onBudgetBucketCategoryChange={onBudgetBucketCategoryChange}
          onBudgetBucketLabelChange={onBudgetBucketLabelChange}
          onBudgetBucketPlannedMinorDraftChange={onBudgetBucketPlannedMinorDraftChange}
          onBeginPlanEdit={onBeginPlanEdit}
          onPlanRowChange={onPlanRowChange}
          onEditingDraftChange={onEditingDraftChange}
          onFinishEdit={onFinishEdit}
          onCancelEdit={onCancelEdit}
          onRemovePlanRow={onRemovePlanRow}
          onOpenNoteDialog={onOpenNoteDialog}
          onOpenPlanLinkDialog={onOpenPlanLinkDialog}
          onOpenEntriesForActual={onOpenEntriesForActual}
          onSortChange={onSortChange}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
          saveErrorMessage={saveErrorMessage}
        />
      ))}
    </div>
  );
}

function IncomePlanSection({
  categories,
  categorySelectOptions,
  incomeRows,
  sortedIncomeRows,
  sectionOpen,
  tableSorts,
  editingRowId,
  editingDrafts,
  isSavingEdit = false,
  isCombinedHouseholdView,
  onToggleSection,
  onAddIncomeRow,
  onBeginIncomeEdit,
  onIncomeRowChange,
  onEditingDraftChange,
  onFinishEdit,
  onCancelEdit,
  onRemoveIncomeRow,
  onOpenNoteDialog,
  onOpenEntriesForActual,
  onSortChange,
  onCategoryAppearanceChange,
  saveErrorMessage = ""
}) {
  return (
    <section className={`month-plan-section month-plan-section-income ${isCombinedHouseholdView ? "is-readonly" : ""}`} id="month-plan-income">
      <div className="month-plan-summary">
        <div className="panel-subhead month-plan-header-bar">
          <button
            type="button"
            className="month-plan-summary-toggle"
            aria-expanded={sectionOpen.income}
            onClick={() => onToggleSection("income")}
          >
            <div className="month-section-head month-section-head-inline month-section-head-with-toggle">
              <span className={`month-section-toggle ${sectionOpen.income ? "is-open" : ""}`} aria-hidden="true">
                <ChevronRight size={16} />
              </span>
              <h3>{messages.month.incomeSectionTitle}</h3>
              <p className="month-section-detail-inline">{messages.month.incomeSectionDetail}</p>
            </div>
          </button>
          <div className="month-summary-actions">
            {!isCombinedHouseholdView ? (
              <button
                type="button"
                className="subtle-action"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAddIncomeRow();
                }}
              >
                {messages.month.addIncomeSource}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {sectionOpen.income ? (
        <div className="table-wrap month-table-wrap">
          <table>
            <thead>
              <tr>
                <SortableHeader label={messages.month.table.category} sort={tableSorts.income} columnKey="categoryName" onSort={onSortChange} tableKey="income" />
                <SortableHeader label={messages.month.table.item} sort={tableSorts.income} columnKey="label" onSort={onSortChange} tableKey="income" />
                <SortableHeader label={messages.month.table.planned} sort={tableSorts.income} columnKey="plannedMinor" onSort={onSortChange} tableKey="income" />
                <SortableHeader label={messages.month.table.actual} sort={tableSorts.income} columnKey="actualMinor" onSort={onSortChange} tableKey="income" />
                <SortableHeader label={messages.month.table.variance} sort={tableSorts.income} columnKey="variance" onSort={onSortChange} tableKey="income" />
                <SortableHeader label={messages.month.table.note} sort={tableSorts.income} columnKey="note" onSort={onSortChange} tableKey="income" />
              </tr>
            </thead>
            <tbody>
              {sortedIncomeRows.map((row) => {
                const isEditing = editingRowId === row.id;
                const canEditRow = !isCombinedHouseholdView && !row.isDerived;
                const variance = row.plannedMinor - row.actualMinor;
                const isRowOpenable = !isEditing && canEditRow;
                const handleRowOpen = (event) => {
                  if (shouldIgnoreRowOpenTarget(event.target)) {
                    return;
                  }
                  onBeginIncomeEdit(row);
                };

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`motion-row ${isEditing ? "is-editing" : ""} ${!canEditRow ? "is-readonly" : ""}`}
                      {...rowMotionProps(categoryService.get(categories, row))}
                      onClick={isRowOpenable ? handleRowOpen : undefined}
                    >
                      <td className="month-cell-category">
                        <div className="month-category-cell">
                          <CategoryAppearancePopover
                            category={categoryService.get(categories, row)}
                            onChange={onCategoryAppearanceChange}
                          />
                          {isEditing ? (
                            <span onClick={(event) => event.stopPropagation()}>
                              <ResponsiveSelect
                                className="table-edit-input"
                                title={messages.month.table.category}
                                value={categoryService.getSelectValue(categories, row)}
                                options={categoryPickOptions(categorySelectOptions, { valueKey: "id" })}
                                categoryPick={{}}
                                onValueChange={(categoryId) => onIncomeRowChange(row.id, categoryService.buildPatch(categories, categoryId))}
                              />
                            </span>
                          ) : <span className={row.categoryName === row.label ? "is-same-as-item" : undefined}>{row.categoryName}</span>}
                        </div>
                      </td>
                      <td className="month-cell-item">
                        {isEditing ? (
                          <input
                            className="table-edit-input"
                            value={row.label}
                            onChange={(event) => onIncomeRowChange(row.id, { label: event.target.value })}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : isRowOpenable ? (
                          <MonthRowOpenButton row={row} onOpen={() => onBeginIncomeEdit(row)} />
                        ) : row.label}
                      </td>
                      <td className="month-cell-planned">
                        {isEditing ? (
                        <input
                          className="table-edit-input table-edit-input-money"
                          value={editingDrafts.plannedMinor ?? formatService.formatMinorInput(row.plannedMinor)}
                          onMouseDown={selectAllOnFocus}
                          onFocus={selectAllOnFocus}
                          onChange={(event) => onEditingDraftChange({ plannedMinor: event.target.value })}
                          onClick={(event) => event.stopPropagation()}
                        />
                        ) : <PrivateMoney>{formatService.money(row.plannedMinor)}</PrivateMoney>}
                      </td>
                      <td className="month-cell-actual">
                        <div className="month-actual-cell">
                          {/* An openable figure (design.md "Openable figures"):
                              View entries lists exactly the entries behind
                              the actual, Ask about this asks about income. */}
                          <button
                            type="button"
                            className={`month-actual-drilldown ${row.isPendingDerived ? "is-pending" : ""}`}
                            disabled={!row.actualEntryIds?.length}
                            data-fig="earned"
                            data-fig-ids={(row.actualEntryIds ?? []).join(" ")}
                          >
                            <PrivateMoney className={moneyToneClass(flowTone(row.actualMinor))}>{formatService.money(row.actualMinor)}</PrivateMoney>
                          </button>
                          {row.isPendingDerived ? <span className="month-row-pending-hint">Updating...</span> : null}
                          <PlanRowBar actualMinor={row.actualMinor} plannedMinor={row.plannedMinor} isIncome />
                        </div>
                      </td>
                      <td className={`month-cell-variance ${moneyToneClass(incomeVarianceTone(row.plannedMinor, row.actualMinor))}`}><PrivateMoney>{formatService.money(variance)}</PrivateMoney></td>
                      <td className={`month-cell-note ${row.note ? "" : "is-empty"}`}>
                        <div className="table-note-actions">
                          <button
                            type="button"
                            className="note-trigger"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!isCombinedHouseholdView && !row.isDerived) {
                                onOpenNoteDialog("income", row.id, null, row.note);
                              }
                            }}
                          >
                            <span>{row.note || messages.common.emptyValue}</span>
                            {!isCombinedHouseholdView && !row.isDerived ? <SquarePen size={14} /> : null}
                          </button>
                        </div>
                      </td>
                    </tr>
                    <MonthInlineActionRow
                      isEditing={isEditing}
                      columnCount={6}
                      onFinishEdit={onFinishEdit}
                      onCancelEdit={onCancelEdit}
                      isSavingEdit={isSavingEdit}
                      errorMessage={saveErrorMessage}
                      deleteAction={incomeRows.length > 1 && canEditRow && !row.isDraft ? (
                        <DeleteRowButton
                          label={row.label || row.categoryName || "income row"}
                          buttonClassName="month-inline-delete-button"
                          triggerLabel={`Delete ${row.label || row.categoryName || "income row"}`}
                          onConfirm={() => onRemoveIncomeRow(row.id)}
                        >
                          Delete
                        </DeleteRowButton>
                      ) : null}
                    />
                  </Fragment>
                );
              })}
            </tbody>
            <IncomeTotalsFooter rows={incomeRows} />
          </table>
        </div>
      ) : null}
    </section>
  );
}

function PlanningSection({
  view,
  categories,
  categorySelectOptions,
  accounts,
  accountSelectOptions,
  section,
  sectionOpen,
  tableSorts,
  editingRowId,
  editingDrafts,
  isSavingEdit = false,
  isCombinedHouseholdView,
  monthKey,
  onToggleSection,
  onAddPlanRow,
  onBudgetBucketCategoryChange,
  onBudgetBucketLabelChange,
  onBudgetBucketPlannedMinorDraftChange,
  onBeginPlanEdit,
  onPlanRowChange,
  onEditingDraftChange,
  onFinishEdit,
  onCancelEdit,
  onRemovePlanRow,
  onOpenNoteDialog,
  onOpenPlanLinkDialog,
  onOpenEntriesForActual,
  onSortChange,
  onCategoryAppearanceChange,
  saveErrorMessage = ""
}) {
  return (
    <section
      className={`month-plan-section ${section.key === "planned_items" ? "month-plan-section-planned" : "month-plan-section-budgets"} ${isCombinedHouseholdView ? "is-readonly" : ""}`}
    >
      <div className="month-plan-summary">
        <div className="panel-subhead month-plan-header-bar">
          <button
            type="button"
            className="month-plan-summary-toggle"
            aria-expanded={sectionOpen[section.key]}
            onClick={() => onToggleSection(section.key)}
          >
            <div className="month-section-head month-section-head-with-toggle">
              <span className={`month-section-toggle ${sectionOpen[section.key] ? "is-open" : ""}`} aria-hidden="true">
                <ChevronRight size={16} />
              </span>
              <h3>{section.label}</h3>
              <p>{section.description}</p>
            </div>
          </button>
          <div className="month-summary-actions">
            {!isCombinedHouseholdView ? (
              <button
                type="button"
                className="subtle-action"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAddPlanRow(section.key);
                }}
              >
                {section.key === "planned_items" ? messages.month.addPlannedItem : messages.month.addBudgetBucket}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {sectionOpen[section.key] ? (
        <div className="table-wrap month-table-wrap">
          <table>
            <thead>
              <tr>
                <SortableHeader label={messages.month.table.category} sort={tableSorts[section.key]} columnKey="categoryName" onSort={onSortChange} tableKey={section.key} />
                {section.key === "planned_items" ? <SortableHeader label={messages.month.table.day} sort={tableSorts[section.key]} columnKey="day" onSort={onSortChange} tableKey={section.key} /> : null}
                <SortableHeader label={messages.month.table.item} sort={tableSorts[section.key]} columnKey="label" onSort={onSortChange} tableKey={section.key} />
                <SortableHeader label={messages.month.table.planned} sort={tableSorts[section.key]} columnKey="plannedMinor" onSort={onSortChange} tableKey={section.key} />
                <SortableHeader label={messages.month.table.actual} sort={tableSorts[section.key]} columnKey="actualMinor" onSort={onSortChange} tableKey={section.key} />
                <SortableHeader label={messages.month.table.variance} sort={tableSorts[section.key]} columnKey="variance" onSort={onSortChange} tableKey={section.key} />
                {section.key === "planned_items" ? <SortableHeader label={messages.month.table.account} sort={tableSorts[section.key]} columnKey="accountName" onSort={onSortChange} tableKey={section.key} /> : null}
                <SortableHeader label={messages.month.table.note} sort={tableSorts[section.key]} columnKey="note" onSort={onSortChange} tableKey={section.key} />
              </tr>
            </thead>
            <tbody>
              {sortRows(section.rows, tableSorts[section.key], monthKey).map((row) => (
                <PlanningRow
                  key={row.id}
                  view={view}
                  categories={categories}
                  categorySelectOptions={categorySelectOptions}
                  accounts={accounts}
                  accountSelectOptions={accountSelectOptions}
                  section={section}
                  row={row}
                  isEditing={editingRowId === row.id}
                  editingDrafts={editingDrafts}
                  isSavingEdit={isSavingEdit}
                  isCombinedHouseholdView={isCombinedHouseholdView}
                  onBudgetBucketCategoryChange={onBudgetBucketCategoryChange}
                  onBudgetBucketLabelChange={onBudgetBucketLabelChange}
                  onBudgetBucketPlannedMinorDraftChange={onBudgetBucketPlannedMinorDraftChange}
                  onBeginPlanEdit={onBeginPlanEdit}
                  onPlanRowChange={onPlanRowChange}
                  onEditingDraftChange={onEditingDraftChange}
                  onFinishEdit={onFinishEdit}
                  onCancelEdit={onCancelEdit}
                  onRemovePlanRow={onRemovePlanRow}
                  onOpenNoteDialog={onOpenNoteDialog}
                  onOpenPlanLinkDialog={onOpenPlanLinkDialog}
                  onOpenEntriesForActual={onOpenEntriesForActual}
                  onCategoryAppearanceChange={onCategoryAppearanceChange}
                  saveErrorMessage={saveErrorMessage}
                />
              ))}
            </tbody>
            <PlanningTotalsFooter section={section} />
          </table>
        </div>
      ) : null}
    </section>
  );
}

function PlanningRow({
  view,
  categories,
  categorySelectOptions,
  accounts,
  accountSelectOptions,
  section,
  row,
  isEditing,
  editingDrafts,
  isSavingEdit = false,
  isCombinedHouseholdView,
  onBudgetBucketCategoryChange,
  onBudgetBucketLabelChange,
  onBudgetBucketPlannedMinorDraftChange,
  onBeginPlanEdit,
  onPlanRowChange,
  onEditingDraftChange,
  onFinishEdit,
  onCancelEdit,
  onRemovePlanRow,
  onOpenNoteDialog,
  onOpenPlanLinkDialog,
  onOpenEntriesForActual,
  onCategoryAppearanceChange,
  saveErrorMessage = ""
}) {
  const variance = row.plannedMinor - row.actualMinor;
  const isMonthSheetLayout = useIsMonthSheetLayout();
  const canInlineEditRow = canInlineEditMonthPlanRow({ isCombinedHouseholdView, row });
  const canOpenRow = canInlineEditRow || (isMonthSheetLayout && canOpenMonthMobileSheet({ isCombinedHouseholdView, row }));
  const isDraftBudgetBucket = isBudgetBucketsSection(section.key) && row.isDraft;
  // A derived row may show a scoped share in the table. When editing, switch to
  // the source row values so the user edits the underlying plan, not the
  // weighted projection.
  const editableRow = isEditing ? getMonthPlanEditSource(row) : row;
  const sharedEditHint = isEditing ? getMonthPlanSharedEditHint({ row, viewId: view.id, viewLabel: view.label }) : "";
  const isRowOpenable = !isEditing && canOpenRow;
  const handleRowOpen = (event) => {
    if (shouldIgnoreRowOpenTarget(event.target)) {
      return;
    }
    onBeginPlanEdit(section.key, row);
  };

  return (
    <Fragment key={row.id}>
      <tr
        className={`motion-row ${isEditing ? "is-editing" : ""} ${!canOpenRow ? "is-readonly" : ""}`}
        {...rowMotionProps(categoryService.get(categories, row))}
        onClick={isRowOpenable ? handleRowOpen : undefined}
      >
        <td className="month-cell-category">
          <div className="month-category-cell">
            <CategoryAppearancePopover
              category={categoryService.get(categories, row)}
              onChange={onCategoryAppearanceChange}
            />
            {isEditing ? (
              <span onClick={(event) => event.stopPropagation()}>
                <ResponsiveSelect
                  className="table-edit-input"
                  title={messages.month.table.category}
                  value={categoryService.getSelectValue(categories, row)}
                  options={categoryPickOptions(categorySelectOptions, { valueKey: "id" })}
                  categoryPick={{}}
                  onValueChange={(categoryId) => {
                    if (isDraftBudgetBucket) {
                      void onBudgetBucketCategoryChange(row.id, categoryId);
                      return;
                    }

                    onPlanRowChange(section.key, row.id, categoryService.buildPatch(categories, categoryId));
                  }}
                />
              </span>
            ) : <span className={row.categoryName === row.label ? "is-same-as-item" : undefined}>{row.categoryName}</span>}
          </div>
        </td>
        {isPlannedItemsSection(section.key) ? (
          <td className="month-cell-date">
            {isEditing ? (
              <input
                className="table-edit-input"
                type="date"
                value={getRowDateValue(row, view.monthPage.month)}
                onChange={(event) => onPlanRowChange(section.key, row.id, { dayLabel: event.target.value, dayOfWeek: undefined })}
                onClick={(event) => event.stopPropagation()}
              />
            ) : formatRowDateLabel(row, view.monthPage.month)}
          </td>
        ) : null}
        <td className="month-cell-item">
          {isEditing ? (
            <input
              className="table-edit-input"
              value={editableRow.label}
              onChange={(event) => {
                if (isDraftBudgetBucket) {
                  onBudgetBucketLabelChange(row.id, event.target.value);
                  return;
                }

                onPlanRowChange(section.key, row.id, { label: event.target.value });
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : isRowOpenable ? (
            <MonthRowOpenButton row={row} onOpen={() => onBeginPlanEdit(section.key, row)} />
          ) : row.label}
        </td>
        <td className="month-cell-planned">
          {isEditing ? (
            <div className="month-planned-cell">
              <input
                className="table-edit-input table-edit-input-money"
                value={editingDrafts.plannedMinor ?? formatService.formatMinorInput(editableRow.plannedMinor)}
                onMouseDown={selectAllOnFocus}
                onFocus={selectAllOnFocus}
                onChange={(event) => {
                  if (isDraftBudgetBucket) {
                    onBudgetBucketPlannedMinorDraftChange(row.id, event.target.value);
                    return;
                  }

                  onEditingDraftChange({ plannedMinor: event.target.value });
                }}
                onClick={(event) => event.stopPropagation()}
              />
              {isDraftBudgetBucket ? (
                <LastPeriodBudgetHint actualMinor={row.lastPeriodActualMinor} month={row.lastPeriodMonth} />
              ) : null}
              {sharedEditHint ? <p className="month-shared-edit-hint">{sharedEditHint}</p> : null}
            </div>
          ) : <PrivateMoney>{formatService.money(row.plannedMinor)}</PrivateMoney>}
        </td>
        <td className="month-cell-actual">
          <div className="month-actual-cell">
            {/* An openable figure (design.md "Openable figures"): View
                entries lists exactly the entries behind the actual, whose
                Spent total is this actual. */}
            <button
              type="button"
              className={`month-actual-drilldown ${row.isPendingDerived ? "is-pending" : ""}`}
              disabled={!row.actualEntryIds?.length}
              data-fig="spent"
              data-fig-ids={(row.actualEntryIds ?? []).join(" ")}
              data-fig-arg={row.categoryName}
              data-fig-ask={row.categoryName ? "category" : undefined}
            >
              <PrivateMoney className={moneyToneClass(spendTone(row.actualMinor, row.plannedMinor))}>{formatService.money(row.actualMinor)}</PrivateMoney>
            </button>
            {row.isPendingDerived ? <span className="month-row-pending-hint">Updating...</span> : null}
            <PlanRowBar actualMinor={row.actualMinor} plannedMinor={row.plannedMinor} />
            {isPlannedItemsSection(section.key) ? (
              <button
                type="button"
                className="planned-link-manage-trigger"
                onClick={(event) => {
                  event.stopPropagation();
                  if (canInlineEditRow) {
                    void onOpenPlanLinkDialog(row);
                  }
                }}
                disabled={!canInlineEditRow}
              >
                {row.linkedEntryCount ? `${row.linkedEntryCount} linked` : "Link entries"}
              </button>
            ) : null}
          </div>
        </td>
        <td className={`month-cell-variance ${moneyToneClass(headroomTone(variance))}`}><PrivateMoney>{formatService.money(variance)}</PrivateMoney></td>
        {isPlannedItemsSection(section.key) ? (
          <td className="month-cell-account">
            {isEditing ? (
              <select
                className="table-edit-input"
                value={row.accountName ?? ""}
                onChange={(event) => onPlanRowChange(section.key, row.id, { accountName: event.target.value })}
                onClick={(event) => event.stopPropagation()}
              >
                <option value="">{messages.common.emptyValue}</option>
                {(accountSelectOptions ?? accounts.map((account) => ({ id: account.id, value: account.name, label: account.name }))).map((account) => (
                  <option key={account.id} value={account.value}>{account.label}</option>
                ))}
              </select>
            ) : row.accountName ?? messages.common.emptyValue}
          </td>
        ) : null}
        <td className={`month-cell-note ${row.note ? "" : "is-empty"}`}>
          <div className="table-note-actions">
            <button
              type="button"
              className="note-trigger"
              onClick={(event) => {
                event.stopPropagation();
                if (canInlineEditRow) {
                  onOpenNoteDialog("plan", row.id, section.key, row.note);
                }
              }}
            >
              <span>{editableRow.note ?? messages.common.emptyValue}</span>
              {canInlineEditRow ? <SquarePen size={14} /> : null}
            </button>
          </div>
        </td>
      </tr>
      <MonthInlineActionRow
        isEditing={isEditing}
        columnCount={section.key === "planned_items" ? 8 : 6}
        onFinishEdit={onFinishEdit}
        onCancelEdit={onCancelEdit}
        isSavingEdit={isSavingEdit}
        errorMessage={saveErrorMessage}
        deleteAction={canInlineEditRow && !row.isDraft ? (
          <DeleteRowButton
            label={row.label || row.categoryName || "planning row"}
            buttonClassName="month-inline-delete-button"
            triggerLabel={`Delete ${row.label || row.categoryName || "planning row"}`}
            onConfirm={() => onRemovePlanRow(section.key, row.id)}
          >
            Delete
          </DeleteRowButton>
        ) : null}
      />
    </Fragment>
  );
}

// The row click stays as a mouse shortcut on the <tr>; this button is the
// keyboard and screen-reader way to open the same row, so the table keeps its
// row and cell semantics instead of turning the <tr> into a fake button.
function MonthRowOpenButton({ row, onOpen }) {
  const rowName = row.label || row.categoryName || messages.common.emptyValue;

  return (
    <button
      type="button"
      className="month-row-open-button"
      aria-label={`Edit ${rowName} row`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {row.label}
    </button>
  );
}

function MonthInlineActionRow({ isEditing, columnCount, onFinishEdit, onCancelEdit, deleteAction = null, isSavingEdit = false, errorMessage = "" }) {
  if (!isEditing) {
    return null;
  }

  return (
    <tr className="month-inline-action-row" data-testid="month-inline-action-row">
      <td colSpan={columnCount}>
        <div className="month-inline-edit-actions">
          {deleteAction}
          <button
            type="button"
            className="subtle-cancel month-inline-cancel-button"
            data-testid="month-inline-cancel-button"
            disabled={isSavingEdit}
            onClick={(event) => {
              event.stopPropagation();
              onCancelEdit();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dialog-primary month-inline-save-button"
            data-testid="month-inline-save-button"
            disabled={isSavingEdit}
            onClick={(event) => {
              event.stopPropagation();
              onFinishEdit();
            }}
          >
            {isSavingEdit ? messages.common.saving : "Save"}
          </button>
        </div>
        {errorMessage ? <p className="form-error month-inline-error" role="alert" data-testid="month-inline-error">{errorMessage}</p> : null}
      </td>
    </tr>
  );
}

function IncomeTotalsFooter({ rows }) {
  const totals = monthService.getSectionTotals(rows);

  return (
    <tfoot>
      <tr className="table-total-row">
        <td className="month-cell-total">{messages.month.table.total}</td>
        <td className="month-cell-blank">{messages.common.emptyValue}</td>
        <td className="month-cell-planned"><PrivateMoney>{formatService.money(totals.plannedMinor)}</PrivateMoney></td>
        <td className={`month-cell-actual ${moneyToneClass(flowTone(totals.actualMinor))}`}><PrivateMoney>{formatService.money(totals.actualMinor)}</PrivateMoney></td>
        <td className={`month-cell-variance ${moneyToneClass(incomeVarianceTone(totals.plannedMinor, totals.actualMinor))}`}><PrivateMoney>{formatService.money(totals.varianceMinor)}</PrivateMoney></td>
        <td className="month-cell-blank">{messages.common.emptyValue}</td>
      </tr>
    </tfoot>
  );
}

function PlanningTotalsFooter({ section }) {
  const totals = monthService.getSectionTotals(section.rows);

  return (
    <tfoot>
      <tr className="table-total-row">
        <td className="month-cell-total">{messages.month.table.total}</td>
        {section.key === "planned_items" ? <td className="month-cell-blank">{messages.common.emptyValue}</td> : null}
        <td className="month-cell-blank">{messages.common.emptyValue}</td>
        <td className="month-cell-planned"><PrivateMoney>{formatService.money(totals.plannedMinor)}</PrivateMoney></td>
        <td className={`month-cell-actual ${moneyToneClass(spendTone(totals.actualMinor, totals.plannedMinor))}`}><PrivateMoney>{formatService.money(totals.actualMinor)}</PrivateMoney></td>
        <td className={`month-cell-variance ${moneyToneClass(headroomTone(totals.varianceMinor))}`}><PrivateMoney>{formatService.money(totals.varianceMinor)}</PrivateMoney></td>
        {section.key === "planned_items" ? <td className="month-cell-blank">{messages.common.emptyValue}</td> : null}
        <td className="month-cell-blank">{messages.common.emptyValue}</td>
      </tr>
    </tfoot>
  );
}

export function LastPeriodBudgetHint({ actualMinor, month }) {
  const isNarrowViewport = useIsMobileLayout();
  if (!month || typeof actualMinor !== "number") {
    return null;
  }

  return (
    <div className="month-budget-default-hint">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="month-budget-default-trigger"
            aria-label="Last month's total. More about this default"
          >
            <span className="month-budget-default-text">Last month&apos;s total: <PrivateMoney>{formatService.money(actualMinor)}</PrivateMoney></span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="month-budget-default-popover"
            side={isNarrowViewport ? "top" : "bottom"}
            align={isNarrowViewport ? "center" : "start"}
            sideOffset={isNarrowViewport ? 12 : 8}
            collisionPadding={16}
          >
            <div className="month-budget-default-head">
              <strong>Budget default</strong>
              <Popover.Close asChild>
                <button type="button" className="icon-action subtle-cancel" aria-label="Close budget default help">
                  <X size={14} />
                </button>
              </Popover.Close>
            </div>
            <p>
              Default amount was set to the chosen category&apos;s total expense from {formatService.formatMonthLabel(month)}.
            </p>
            <Popover.Arrow className="category-popover-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
