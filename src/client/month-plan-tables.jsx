import { Check, ChevronRight, SquarePen, X } from "lucide-react";

import { CategoryAppearancePopover } from "./category-visuals";
import { getCategory, getCategoryPatch, getCategorySelectValue } from "./category-utils";
import { messages } from "./copy/en-SG";
import { formatMinorInput, money } from "./formatters";
import { getMonthSectionTotals } from "./month-helpers";
import { formatRowDateLabel, getRowDateValue, sortRows } from "./table-helpers";
import { DeleteRowButton, SortableHeader } from "./ui-components";

const SECTION_ORDER = {
  budget_buckets: 0,
  planned_items: 1
};

// Table rendering stays separate from persistence so MonthPanel keeps the write flow in one place.
export function MonthPlanStack({
  view,
  categories,
  accounts,
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
        onSortChange={onSortChange}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
      />
      {sortedSections.map((section) => (
        <PlanningSection
          key={section.key}
          view={view}
          categories={categories}
          accounts={accounts}
          section={section}
          sectionOpen={sectionOpen}
          tableSorts={tableSorts}
          editingRowId={editingRowId}
          editingDrafts={editingDrafts}
          isCombinedHouseholdView={isCombinedHouseholdView}
          monthKey={monthKey}
          onToggleSection={onToggleSection}
          onAddPlanRow={onAddPlanRow}
          onBeginPlanEdit={onBeginPlanEdit}
          onPlanRowChange={onPlanRowChange}
          onEditingDraftChange={onEditingDraftChange}
          onFinishEdit={onFinishEdit}
          onCancelEdit={onCancelEdit}
          onRemovePlanRow={onRemovePlanRow}
          onOpenNoteDialog={onOpenNoteDialog}
          onOpenPlanLinkDialog={onOpenPlanLinkDialog}
          onSortChange={onSortChange}
          onCategoryAppearanceChange={onCategoryAppearanceChange}
        />
      ))}
    </div>
  );
}

function IncomePlanSection({
  categories,
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

                return (
                  <tr
                    key={row.id}
                    className={`${isEditing ? "is-editing" : ""} ${!canEditRow ? "is-readonly" : ""}`}
                    onClick={canEditRow ? () => onBeginIncomeEdit(row) : undefined}
                  >
                    <td>
                      <div className="month-category-cell">
                        <CategoryAppearancePopover
                          category={getCategory(categories, row)}
                          onChange={onCategoryAppearanceChange}
                        />
                        {isEditing ? (
                          <select
                            className="table-edit-input"
                            value={getCategorySelectValue(categories, row)}
                            onChange={(event) => onIncomeRowChange(row.id, getCategoryPatch(categories, event.target.value))}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>{category.name}</option>
                            ))}
                          </select>
                        ) : <span>{row.categoryName}</span>}
                      </div>
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          className="table-edit-input"
                          value={row.label}
                          onChange={(event) => onIncomeRowChange(row.id, { label: event.target.value })}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : row.label}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          className="table-edit-input table-edit-input-money"
                          value={editingDrafts.plannedMinor ?? formatMinorInput(row.plannedMinor)}
                          onChange={(event) => onEditingDraftChange({ plannedMinor: event.target.value })}
                          onClick={(event) => event.stopPropagation()}
                        />
                      ) : money(row.plannedMinor)}
                    </td>
                    <td>{money(row.actualMinor)}</td>
                    <td className={variance <= 0 ? "positive" : "negative"}>{money(variance)}</td>
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
                        <RowEditActions
                          isEditing={isEditing}
                          onFinishEdit={onFinishEdit}
                          onCancelEdit={onCancelEdit}
                        />
                        {incomeRows.length > 1 && canEditRow ? (
                          <DeleteRowButton
                            label={row.label || row.categoryName || "income row"}
                            onConfirm={() => onRemoveIncomeRow(row.id)}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
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
  accounts,
  section,
  sectionOpen,
  tableSorts,
  editingRowId,
  editingDrafts,
  isCombinedHouseholdView,
  monthKey,
  onToggleSection,
  onAddPlanRow,
  onBeginPlanEdit,
  onPlanRowChange,
  onEditingDraftChange,
  onFinishEdit,
  onCancelEdit,
  onRemovePlanRow,
  onOpenNoteDialog,
  onOpenPlanLinkDialog,
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
                  accounts={accounts}
                  section={section}
                  row={row}
                  isEditing={editingRowId === row.id}
                  editingDrafts={editingDrafts}
                  isCombinedHouseholdView={isCombinedHouseholdView}
                  onBeginPlanEdit={onBeginPlanEdit}
                  onPlanRowChange={onPlanRowChange}
                  onEditingDraftChange={onEditingDraftChange}
                  onFinishEdit={onFinishEdit}
                  onCancelEdit={onCancelEdit}
                  onRemovePlanRow={onRemovePlanRow}
                  onOpenNoteDialog={onOpenNoteDialog}
                  onOpenPlanLinkDialog={onOpenPlanLinkDialog}
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
  accounts,
  section,
  row,
  isEditing,
  editingDrafts,
  isCombinedHouseholdView,
  onBeginPlanEdit,
  onPlanRowChange,
  onEditingDraftChange,
  onFinishEdit,
  onCancelEdit,
  onRemovePlanRow,
  onOpenNoteDialog,
  onOpenPlanLinkDialog,
  onCategoryAppearanceChange
}) {
  const variance = row.plannedMinor - row.actualMinor;
  const canEditRow = !isCombinedHouseholdView && !row.isDerived;

  return (
    <tr
      className={`${isEditing ? "is-editing" : ""} ${!canEditRow ? "is-readonly" : ""}`}
      onClick={canEditRow ? () => onBeginPlanEdit(section.key, row) : undefined}
    >
      <td>
        <div className="month-category-cell">
          <CategoryAppearancePopover
            category={getCategory(categories, row)}
            onChange={onCategoryAppearanceChange}
          />
          {isEditing ? (
            <select
              className="table-edit-input"
              value={getCategorySelectValue(categories, row)}
              onChange={(event) => onPlanRowChange(section.key, row.id, getCategoryPatch(categories, event.target.value))}
              onClick={(event) => event.stopPropagation()}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          ) : <span>{row.categoryName}</span>}
        </div>
      </td>
      {section.key === "planned_items" ? (
        <td>
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
      <td>
        {isEditing ? (
          <input
            className="table-edit-input"
            value={row.label}
            onChange={(event) => onPlanRowChange(section.key, row.id, { label: event.target.value })}
            onClick={(event) => event.stopPropagation()}
          />
        ) : row.label}
      </td>
      <td>
        {isEditing ? (
          <input
            className="table-edit-input table-edit-input-money"
            value={editingDrafts.plannedMinor ?? formatMinorInput(row.plannedMinor)}
            onChange={(event) => onEditingDraftChange({ plannedMinor: event.target.value })}
            onClick={(event) => event.stopPropagation()}
          />
        ) : money(row.plannedMinor)}
      </td>
      <td>
        {section.key === "planned_items" ? (
          <button
            type="button"
            className="planned-link-trigger"
            onClick={(event) => {
              event.stopPropagation();
              if (canEditRow) {
                void onOpenPlanLinkDialog(row);
              }
            }}
            disabled={!canEditRow}
          >
            <strong>{money(row.actualMinor)}</strong>
            <span>{row.linkedEntryCount ? `${row.linkedEntryCount} linked` : "Link entries"}</span>
          </button>
        ) : money(row.actualMinor)}
      </td>
      <td className={variance >= 0 ? "positive" : "negative"}>{money(variance)}</td>
      {section.key === "planned_items" ? (
        <td>
          {isEditing ? (
            <select
              className="table-edit-input"
              value={row.accountName ?? ""}
              onChange={(event) => onPlanRowChange(section.key, row.id, { accountName: event.target.value })}
              onClick={(event) => event.stopPropagation()}
            >
              <option value="">{messages.common.emptyValue}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.name}>{account.name}</option>
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
              if (!isCombinedHouseholdView && !row.isDerived) {
                onOpenNoteDialog("plan", row.id, section.key, row.note);
              }
            }}
          >
            <span>{row.note ?? messages.common.emptyValue}</span>
            {canEditRow ? <SquarePen size={14} /> : null}
          </button>
          <RowEditActions
            isEditing={isEditing}
            onFinishEdit={onFinishEdit}
            onCancelEdit={onCancelEdit}
          />
          {canEditRow ? (
            <DeleteRowButton
              label={row.label || row.categoryName || "planning row"}
              onConfirm={() => onRemovePlanRow(section.key, row.id)}
            />
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function RowEditActions({ isEditing, onFinishEdit, onCancelEdit }) {
  if (!isEditing) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="icon-action"
        aria-label="Done editing"
        onClick={(event) => {
          event.stopPropagation();
          onFinishEdit();
        }}
      >
        <Check size={16} />
      </button>
      <button
        type="button"
        className="icon-action subtle-cancel"
        aria-label="Cancel editing"
        onClick={(event) => {
          event.stopPropagation();
          onCancelEdit();
        }}
      >
        <X size={16} />
      </button>
    </>
  );
}

function IncomeTotalsFooter({ rows }) {
  const totals = getMonthSectionTotals(rows);

  return (
    <tfoot>
      <tr className="table-total-row">
        <td>{messages.month.table.total}</td>
        <td>{messages.common.emptyValue}</td>
        <td>{money(totals.plannedMinor)}</td>
        <td>{money(totals.actualMinor)}</td>
        <td className={totals.varianceMinor >= 0 ? "positive" : "negative"}>{money(totals.varianceMinor)}</td>
        <td>{messages.common.emptyValue}</td>
      </tr>
    </tfoot>
  );
}

function PlanningTotalsFooter({ section }) {
  const totals = getMonthSectionTotals(section.rows);

  return (
    <tfoot>
      <tr className="table-total-row">
        <td>{messages.month.table.total}</td>
        {section.key === "planned_items" ? <td>{messages.common.emptyValue}</td> : null}
        <td>{messages.common.emptyValue}</td>
        <td>{money(totals.plannedMinor)}</td>
        <td>{money(totals.actualMinor)}</td>
        <td className={totals.varianceMinor >= 0 ? "positive" : "negative"}>{money(totals.varianceMinor)}</td>
        {section.key === "planned_items" ? <td>{messages.common.emptyValue}</td> : null}
        <td>{messages.common.emptyValue}</td>
      </tr>
    </tfoot>
  );
}
