import { Fragment } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronRight, SquarePen, X } from "lucide-react";

import { CategoryAppearancePopover } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import {
  canInlineEditMonthPlanRow,
  canInlineEditMonthRow,
  canOpenMonthMobileSheet,
  getMonthPlanEditSource,
  getMonthPlanSharedEditHint
} from "./month-row-editing";
import { formatRowDateLabel, getRowDateValue, sortRows } from "./table-helpers";
import { DeleteRowButton, SortableHeader } from "./ui-components";

const { categories: categoryService, format: formatService, months: monthService } = moniesClient;

const SECTION_ORDER = {
  budget_buckets: 0,
  planned_items: 1
};
const MOBILE_MONTH_EDIT_QUERY = "(max-width: 760px), (max-width: 1024px) and (orientation: portrait)";

function isPlannedItemsSection(sectionKey) {
  return sectionKey === "planned_items";
}

function isBudgetBucketsSection(sectionKey) {
  return sectionKey === "budget_buckets";
}

function useMonthMobileEditViewport() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MONTH_EDIT_QUERY).matches;
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
  onCategoryAppearanceChange
}) {
  const sortedIncomeRows = sortRows(incomeRows, tableSorts.income, monthKey);
  const sortedSections = [...planSections].sort((left, right) => SECTION_ORDER[left.key] - SECTION_ORDER[right.key]);

  return (
    <div className="month-plan-stack">
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
  onCategoryAppearanceChange
}) {
  return (
    <section className={`month-plan-section month-plan-section-income ${isCombinedHouseholdView ? "is-readonly" : ""}`}>
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
                const handleRowOpen = (event) => {
                  if (!canEditRow || shouldIgnoreRowOpenTarget(event.target)) {
                    return;
                  }
                  onBeginIncomeEdit(row);
                };
                const rowOpenProps = !isEditing && canEditRow ? { onClick: handleRowOpen } : {};

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`${isEditing ? "is-editing" : ""} ${!canEditRow ? "is-readonly" : ""}`}
                      onClick={canEditRow ? handleRowOpen : undefined}
                    >
                      <td {...rowOpenProps}>
                        <div className="month-category-cell">
                          <CategoryAppearancePopover
                            category={categoryService.get(categories, row)}
                            onChange={onCategoryAppearanceChange}
                          />
                          {isEditing ? (
                            <select
                              className="table-edit-input"
                              value={categoryService.getSelectValue(categories, row)}
                              onChange={(event) => onIncomeRowChange(row.id, categoryService.buildPatch(categories, event.target.value))}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {categorySelectOptions.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                              ))}
                            </select>
                          ) : <span>{row.categoryName}</span>}
                        </div>
                      </td>
                      <td {...rowOpenProps}>
                        {isEditing ? (
                          <input
                            className="table-edit-input"
                            value={row.label}
                            onChange={(event) => onIncomeRowChange(row.id, { label: event.target.value })}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : row.label}
                      </td>
                      <td {...rowOpenProps}>
                        {isEditing ? (
                          <input
                            className="table-edit-input table-edit-input-money"
                            value={editingDrafts.plannedMinor ?? formatService.formatMinorInput(row.plannedMinor)}
                            onChange={(event) => onEditingDraftChange({ plannedMinor: event.target.value })}
                            onClick={(event) => event.stopPropagation()}
                          />
                        ) : formatService.money(row.plannedMinor)}
                      </td>
                      <td>
                        <div className="month-actual-cell">
                          <button
                            type="button"
                            className={`month-actual-drilldown ${row.isPendingDerived ? "is-pending" : ""}`}
                            disabled={!row.actualEntryIds?.length}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenEntriesForActual({
                                categoryName: row.categoryName,
                                entryIds: row.actualEntryIds ?? []
                              });
                            }}
                          >
                            {formatService.money(row.actualMinor)}
                          </button>
                          {row.isPendingDerived ? <span className="month-row-pending-hint">Updating...</span> : null}
                        </div>
                      </td>
                      <td {...rowOpenProps} className={variance <= 0 ? "positive" : "negative"}>{formatService.money(variance)}</td>
                      <td>
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
  onCategoryAppearanceChange
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
  onCategoryAppearanceChange
}) {
  const variance = row.plannedMinor - row.actualMinor;
  const canInlineEditRow = canInlineEditMonthPlanRow({ isCombinedHouseholdView, row });
  const canOpenRow = canInlineEditRow || (useMonthMobileEditViewport() && canOpenMonthMobileSheet({ isCombinedHouseholdView, row }));
  const isDraftBudgetBucket = isBudgetBucketsSection(section.key) && row.isDraft;
  // A derived row may show a scoped share in the table. When editing, switch to
  // the source row values so the user edits the underlying plan, not the
  // weighted projection.
  const editableRow = isEditing ? getMonthPlanEditSource(row) : row;
  const sharedEditHint = isEditing ? getMonthPlanSharedEditHint({ row, viewId: view.id, viewLabel: view.label }) : "";
  const handleRowOpen = (event) => {
    if (!canOpenRow || shouldIgnoreRowOpenTarget(event.target)) {
      return;
    }
    onBeginPlanEdit(section.key, row);
  };
  const rowOpenProps = !isEditing && canOpenRow ? { onClick: handleRowOpen } : {};

  return (
    <Fragment key={row.id}>
      <tr
        className={`${isEditing ? "is-editing" : ""} ${!canOpenRow ? "is-readonly" : ""}`}
        onClick={canOpenRow ? handleRowOpen : undefined}
      >
        <td {...rowOpenProps}>
          <div className="month-category-cell">
            <CategoryAppearancePopover
              category={categoryService.get(categories, row)}
              onChange={onCategoryAppearanceChange}
            />
            {isEditing ? (
              <select
                className="table-edit-input"
                value={categoryService.getSelectValue(categories, row)}
                onChange={(event) => {
                  if (isDraftBudgetBucket) {
                    void onBudgetBucketCategoryChange(row.id, event.target.value);
                    return;
                  }

                  onPlanRowChange(section.key, row.id, categoryService.buildPatch(categories, event.target.value));
                }}
                onClick={(event) => event.stopPropagation()}
              >
                {categorySelectOptions.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            ) : <span>{row.categoryName}</span>}
          </div>
        </td>
        {isPlannedItemsSection(section.key) ? (
          <td {...rowOpenProps}>
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
        <td {...rowOpenProps}>
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
          ) : row.label}
        </td>
        <td {...rowOpenProps}>
          {isEditing ? (
            <div className="month-planned-cell">
              <input
                className="table-edit-input table-edit-input-money"
                value={editingDrafts.plannedMinor ?? formatService.formatMinorInput(editableRow.plannedMinor)}
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
          ) : formatService.money(row.plannedMinor)}
        </td>
        <td>
          <div className="month-actual-cell">
            <button
              type="button"
              className={`month-actual-drilldown ${row.isPendingDerived ? "is-pending" : ""}`}
              disabled={!row.actualEntryIds?.length}
              onClick={(event) => {
                event.stopPropagation();
                onOpenEntriesForActual({
                  categoryName: row.categoryName,
                  entryIds: row.actualEntryIds ?? []
                });
              }}
            >
              {formatService.money(row.actualMinor)}
            </button>
            {row.isPendingDerived ? <span className="month-row-pending-hint">Updating...</span> : null}
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
        <td {...rowOpenProps} className={variance >= 0 ? "positive" : "negative"}>{formatService.money(variance)}</td>
        {isPlannedItemsSection(section.key) ? (
          <td {...rowOpenProps}>
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
        <td>
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

function MonthInlineActionRow({ isEditing, columnCount, onFinishEdit, onCancelEdit, deleteAction = null }) {
  if (!isEditing) {
    return null;
  }

  return (
    <tr className="month-inline-action-row">
      <td colSpan={columnCount}>
        <div className="month-inline-edit-actions">
          {deleteAction}
          <button
            type="button"
            className="subtle-cancel month-inline-cancel-button"
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
            onClick={(event) => {
              event.stopPropagation();
              onFinishEdit();
            }}
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}

function IncomeTotalsFooter({ rows }) {
  const totals = monthService.getSectionTotals(rows);

  return (
    <tfoot>
      <tr className="table-total-row">
        <td>{messages.month.table.total}</td>
        <td>{messages.common.emptyValue}</td>
        <td>{formatService.money(totals.plannedMinor)}</td>
        <td>{formatService.money(totals.actualMinor)}</td>
        <td className={totals.varianceMinor >= 0 ? "positive" : "negative"}>{formatService.money(totals.varianceMinor)}</td>
        <td>{messages.common.emptyValue}</td>
      </tr>
    </tfoot>
  );
}

function PlanningTotalsFooter({ section }) {
  const totals = monthService.getSectionTotals(section.rows);

  return (
    <tfoot>
      <tr className="table-total-row">
        <td>{messages.month.table.total}</td>
        {section.key === "planned_items" ? <td>{messages.common.emptyValue}</td> : null}
        <td>{messages.common.emptyValue}</td>
        <td>{formatService.money(totals.plannedMinor)}</td>
        <td>{formatService.money(totals.actualMinor)}</td>
        <td className={totals.varianceMinor >= 0 ? "positive" : "negative"}>{formatService.money(totals.varianceMinor)}</td>
        {section.key === "planned_items" ? <td>{messages.common.emptyValue}</td> : null}
        <td>{messages.common.emptyValue}</td>
      </tr>
    </tfoot>
  );
}

export function LastPeriodBudgetHint({ actualMinor, month }) {
  if (!month || typeof actualMinor !== "number") {
    return null;
  }

  const isNarrowViewport = typeof window !== "undefined" && window.innerWidth <= 760;

  return (
    <div className="month-budget-default-hint">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="month-budget-default-trigger"
            aria-label={`Last month's total ${formatService.money(actualMinor)}. More about this default`}
          >
            <span className="month-budget-default-text">Last month&apos;s total: {formatService.money(actualMinor)}</span>
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
