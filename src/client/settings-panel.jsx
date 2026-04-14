import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, SquarePen, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { formatAuditAction } from "./account-display";
import { messages } from "./copy/en-SG";
import { extractPdfText, selectParsedStatementForCompare } from "./import-helpers";
import { buildRequestErrorMessage } from "./request-errors";
import { SettingsAccountsSection } from "./settings-accounts-section";
import { SettingsAccountDialog, SettingsCategoryDialog, SettingsPersonDialog, SettingsReconciliationDialog } from "./settings-dialogs";
import { CategoryGlyph, DeleteRowButton } from "./ui-components";
import { FALLBACK_THEME } from "./ui-options";
import {
  buildCheckpointExportHref,
  formatCheckpointCoverage,
  formatCheckpointHistoryBalanceLine,
  formatCheckpointStatementInputMinor,
  formatDate,
  formatDateOnly,
  formatMinorInput,
  formatMonthLabel,
  getContentDispositionFilename,
  money,
  parseDraftMoneyInput
} from "./formatters";
import { inspectCsv } from "../lib/csv";
import { getCurrentMonthKey } from "../lib/month";
import { parseStatementText } from "../lib/statement-import";

const DEFAULT_MONTH_KEY = getCurrentMonthKey();

export function SettingsPanel({ settingsPage, accounts, categories, people, viewId, viewLabel, onRefresh }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emptyStateText, setEmptyStateText] = useState("");
  const [demoStateOpen, setDemoStateOpen] = useState(false);
  const [settingsSectionsOpen, setSettingsSectionsOpen] = useState({
    people: false,
    accounts: false,
    categories: false,
    trust: false,
    transfers: false,
    activity: false
  });
  const [personDialog, setPersonDialog] = useState(null);
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountDialogError, setAccountDialogError] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(null);
  const [reconciliationDialog, setReconciliationDialog] = useState(null);
  const [checkpointHistoryYear, setCheckpointHistoryYear] = useState("");
  const [statementComparePanel, setStatementComparePanel] = useState(null);
  const [statementCompareResult, setStatementCompareResult] = useState(null);
  const [statementCompareStatus, setStatementCompareStatus] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const visibleAccounts = useMemo(() => {
    const scopedAccounts = viewId === "household"
      ? accounts
      : accounts.filter((account) => account.isJoint || account.ownerPersonId === viewId);

    return scopedAccounts
      .slice()
      .sort((left, right) => (
        Number(right.isActive) - Number(left.isActive)
        || left.institution.localeCompare(right.institution)
        || left.name.localeCompare(right.name)
      ));
  }, [accounts, viewId]);
  const visibleCategories = useMemo(
    () => categories.slice().sort((left, right) => left.name.localeCompare(right.name)),
    [categories]
  );
  const recentActivityGroups = useMemo(() => {
    const grouped = new Map();
    for (const event of settingsPage.recentAuditEvents) {
      const key = event.createdAt.slice(0, 10);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(event);
    }
    return Array.from(grouped.entries()).map(([date, events]) => ({ date, events }));
  }, [settingsPage.recentAuditEvents]);
  const checkpointHistoryYears = useMemo(() => (
    Array.from(new Set((reconciliationDialog?.history ?? []).map((item) => item.month.slice(0, 4)).filter(Boolean)))
      .sort((left, right) => right.localeCompare(left))
  ), [reconciliationDialog?.history]);
  const visibleCheckpointHistory = useMemo(() => (
    (reconciliationDialog?.history ?? []).filter((item) => !checkpointHistoryYear || item.month.startsWith(`${checkpointHistoryYear}-`))
  ), [checkpointHistoryYear, reconciliationDialog?.history]);

  useEffect(() => {
    if (!reconciliationDialog) {
      setCheckpointHistoryYear("");
      return;
    }

    if (checkpointHistoryYears.length && !checkpointHistoryYears.includes(checkpointHistoryYear)) {
      setCheckpointHistoryYear(checkpointHistoryYears[0]);
    }
  }, [checkpointHistoryYear, checkpointHistoryYears, reconciliationDialog]);

  async function handleReseed() {
    setIsSubmitting(true);
    try {
      await fetch("/api/demo/reseed", { method: "POST" });
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefresh() {
    setIsSubmitting(true);
    try {
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEmptyState() {
    setIsSubmitting(true);
    try {
      await fetch("/api/demo/empty", { method: "POST" });
      await onRefresh();
      setEmptyStateText("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openCreateAccountDialog() {
    setAccountDialogError("");
    setAccountDialog({
      mode: "create",
      accountId: "",
      name: "",
      institution: "",
      kind: "bank",
      currency: "SGD",
      openingBalance: "0.00",
      ownerPersonId: "",
      isJoint: false
    });
  }

  function openEditAccountDialog(account) {
    setAccountDialogError("");
    setAccountDialog({
      mode: "edit",
      accountId: account.id,
      name: account.name,
      institution: account.institution,
      kind: account.kind,
      currency: account.currency,
      openingBalance: formatMinorInput(account.openingBalanceMinor ?? 0),
      ownerPersonId: account.ownerPersonId ?? "",
      isJoint: account.isJoint
    });
  }

  function openReconciliationDialog(account) {
    setReconciliationDialog({
      accountId: account.id,
      accountName: account.name,
      accountKind: account.kind,
      checkpointMonth: account.latestCheckpointMonth ?? "",
      statementStartDate: account.latestCheckpointStartDate ?? "",
      statementEndDate: account.latestCheckpointEndDate ?? "",
      statementBalance: formatCheckpointStatementInputMinor(
        account.latestCheckpointBalanceMinor ?? account.balanceMinor ?? 0,
        account.kind
      ),
      note: account.latestCheckpointNote ?? "",
      history: account.checkpointHistory ?? []
    });
  }

  function openStatementComparePanel(account, checkpoint) {
    if (!checkpoint?.month) {
      return;
    }

    setSettingsSectionsOpen((current) => ({ ...current, accounts: true }));
    setStatementComparePanel({
      accountId: account.id,
      accountName: account.name,
      checkpointMonth: checkpoint.month,
      statementStartDate: checkpoint.statementStartDate,
      statementEndDate: checkpoint.statementEndDate,
      deltaMinor: checkpoint.deltaMinor
    });
    setStatementCompareResult(null);
    setStatementCompareStatus(null);
    setReconciliationDialog(null);
  }

  function openStatementComparePanelFromDialog(item) {
    if (!reconciliationDialog?.accountId) {
      return;
    }

    openStatementComparePanel(
      {
        id: reconciliationDialog.accountId,
        name: reconciliationDialog.accountName
      },
      item
    );
  }

  function openCreateCategoryDialog() {
    setCategoryDialog({
      mode: "create",
      categoryId: "",
      name: "",
      slug: "",
      iconKey: FALLBACK_THEME.iconKey,
      colorHex: FALLBACK_THEME.colorHex
    });
  }

  function openEditCategoryDialog(category) {
    setCategoryDialog({
      mode: "edit",
      categoryId: category.id,
      name: category.name,
      slug: category.slug,
      iconKey: category.iconKey,
      colorHex: category.colorHex
    });
  }

  function openEditPersonDialog(person) {
    setPersonDialog({
      personId: person.id,
      name: person.name
    });
  }

  async function handleSaveAccount() {
    if (!accountDialog) {
      return;
    }

    setIsSubmitting(true);
    setAccountDialogError("");
    try {
      const endpoint = accountDialog.mode === "create" ? "/api/accounts/create" : "/api/accounts/update";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountDialog.accountId || undefined,
          name: accountDialog.name,
          institution: accountDialog.institution,
          kind: accountDialog.kind,
          currency: accountDialog.currency,
          openingBalanceMinor: parseDraftMoneyInput(accountDialog.openingBalance ?? "0"),
          ownerPersonId: accountDialog.isJoint ? null : (accountDialog.ownerPersonId || null),
          isJoint: accountDialog.isJoint
        })
      });

      if (!response.ok) {
        setAccountDialogError(await buildRequestErrorMessage(response, "Account save failed."));
        return;
      }

      setAccountDialog(null);
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleArchiveAccount(accountId) {
    setIsSubmitting(true);
    try {
      await fetch("/api/accounts/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId })
      });
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveReconciliation() {
    if (!reconciliationDialog?.accountId || !reconciliationDialog.checkpointMonth.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await fetch("/api/accounts/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: reconciliationDialog.accountId,
          checkpointMonth: reconciliationDialog.checkpointMonth,
          statementStartDate: reconciliationDialog.statementStartDate || null,
          statementEndDate: reconciliationDialog.statementEndDate || null,
          statementBalanceMinor: parseDraftMoneyInput(reconciliationDialog.statementBalance ?? "0"),
          note: reconciliationDialog.note
        })
      });
      setReconciliationDialog(null);
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCheckpoint(item) {
    if (!reconciliationDialog?.accountId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await fetch("/api/accounts/checkpoints/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: reconciliationDialog.accountId,
          checkpointMonth: item.month
        })
      });
      setReconciliationDialog((current) => current ? {
        ...current,
        history: current.history.filter((historyItem) => historyItem.month !== item.month)
      } : current);
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDownloadCheckpointExport(item) {
    if (!reconciliationDialog?.accountId) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(buildCheckpointExportHref(reconciliationDialog.accountId, item.month), {
        credentials: "same-origin"
      });

      if (!response.ok) {
        throw new Error(await buildRequestErrorMessage(response, "Checkpoint export failed."));
      }

      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = getContentDispositionFilename(response.headers.get("Content-Disposition"))
        ?? `checkpoint-${reconciliationDialog.accountId}-${item.month}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Checkpoint export failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCompareStatementUpload(target, event) {
    const [file] = event.target.files ?? [];
    event.target.value = "";
    if (!file || !target?.accountId || !target?.checkpointMonth) {
      return;
    }

    setIsSubmitting(true);
    setStatementCompareResult(null);
    setStatementCompareStatus({ tone: "active", message: messages.settings.statementCompareReading(file.name) });
    try {
      let rows = [];
      let uploadedStatementStartDate;
      let uploadedStatementEndDate;
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        const parsed = parseStatementText(await extractPdfText(file), file.name);
        const selectedStatement = selectParsedStatementForCompare(parsed, target);
        rows = selectedStatement.rows;
        uploadedStatementStartDate = selectedStatement.checkpoint?.statementStartDate;
        uploadedStatementEndDate = selectedStatement.checkpoint?.statementEndDate;
      } else {
        rows = inspectCsv(await file.text()).rows;
      }

      setStatementCompareStatus({ tone: "active", message: messages.settings.statementCompareChecking(rows.length) });
      const response = await fetch("/api/accounts/checkpoints/compare-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: target.accountId,
          checkpointMonth: target.checkpointMonth,
          uploadedStatementStartDate,
          uploadedStatementEndDate,
          rows
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Statement compare failed.");
      }

      setStatementCompareResult(data.comparison);
      setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareReady(data.comparison) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement compare failed.";
      setStatementCompareStatus({ tone: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEditCheckpoint(item) {
    setReconciliationDialog((current) => current ? {
      ...current,
      checkpointMonth: item.month,
      statementStartDate: item.statementStartDate ?? "",
      statementEndDate: item.statementEndDate ?? "",
      statementBalance: formatCheckpointStatementInputMinor(item.statementBalanceMinor, current.accountKind),
      note: item.note ?? ""
    } : current);
  }

  async function handleSaveCategory() {
    if (!categoryDialog?.name?.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = categoryDialog.mode === "create" ? "/api/categories/create" : "/api/categories/update";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: categoryDialog.categoryId || undefined,
          name: categoryDialog.name,
          slug: categoryDialog.slug,
          iconKey: categoryDialog.iconKey,
          colorHex: categoryDialog.colorHex
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to save category");
      }
      setCategoryDialog(null);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save category");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSavePerson() {
    if (!personDialog?.personId || !personDialog.name?.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/people/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: personDialog.personId,
          name: personDialog.name
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to update person");
      }
      setPersonDialog(null);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to update person");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCategory(category) {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/categories/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: category.id })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to delete category");
      }
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete category");
    } finally {
      setIsSubmitting(false);
    }
  }

  function openTransferReview(entryId) {
    const params = new URLSearchParams(searchParams);
    params.set("view", viewId);
    params.set("month", searchParams.get("month") ?? DEFAULT_MONTH_KEY);
    params.set("entry_type", "transfer");
    params.set("editing_entry", entryId);
    navigate({ pathname: "/entries", search: params.toString() });
  }

  function handleStatementCompareRowsMatched(statementRow, ledgerRow) {
    setStatementCompareResult((current) => current ? {
      ...current,
      matchedRowCount: current.matchedRowCount + 1,
      unmatchedStatementRows: current.unmatchedStatementRows.filter((row) => row.id !== statementRow.id),
      unmatchedLedgerRows: current.unmatchedLedgerRows.filter((row) => row.id !== ledgerRow.id),
      possibleMatches: current.possibleMatches.filter((candidate) => (
        candidate.statementRow.id !== statementRow.id
        && candidate.ledgerRow.id !== ledgerRow.id
      ))
    } : current);
    setStatementComparePanel((current) => current ? {
      ...current,
      deltaMinor: typeof current.deltaMinor === "number"
        ? current.deltaMinor + statementRow.signedAmountMinor - ledgerRow.signedAmountMinor
        : current.deltaMinor
    } : current);
    setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareDirectionFixed });
    void onRefresh();
  }

  function handleStatementCompareEntryAdded(rowId) {
    setStatementCompareResult((current) => current ? {
      ...current,
      ledgerRowCount: current.ledgerRowCount + 1,
      unmatchedStatementRows: current.unmatchedStatementRows.filter((row) => row.id !== rowId)
    } : current);
    setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareEntryAdded });
    void onRefresh();
  }

  function toggleSettingsSection(sectionKey) {
    setSettingsSectionsOpen((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey]
    }));
  }

  return (
    <article className="panel settings-page">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.settings}</h2>
          <span className="panel-context">{messages.settings.viewing(viewLabel)}</span>
        </div>
      </div>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("people")}
          aria-expanded={settingsSectionsOpen.people}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.peopleTitle}</h3>
              <p>{messages.settings.peopleDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.people ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.people ? (
          <div className="settings-people-grid">
            {people.map((person) => (
              <div key={person.id} className="settings-account-row settings-person-card">
                <div className="settings-account-main">
                  <strong>{person.name}</strong>
                  <p>{messages.settings.personUsageHint}</p>
                </div>
                <div className="settings-account-actions">
                  <button type="button" className="icon-action" aria-label={messages.settings.editPerson} onClick={() => openEditPersonDialog(person)}>
                    <SquarePen size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <SettingsAccountsSection
        accounts={visibleAccounts}
        categories={categories}
        people={people}
        isOpen={settingsSectionsOpen.accounts}
        isSubmitting={isSubmitting}
        statementComparePanel={statementComparePanel}
        statementCompareResult={statementCompareResult}
        statementCompareStatus={statementCompareStatus}
        onToggle={() => toggleSettingsSection("accounts")}
        onCreateAccount={openCreateAccountDialog}
        onEditAccount={openEditAccountDialog}
        onArchiveAccount={handleArchiveAccount}
        onReconcileAccount={openReconciliationDialog}
        onOpenStatementCompare={openStatementComparePanel}
        onCloseStatementCompare={() => setStatementComparePanel(null)}
        onUploadStatementCompare={handleCompareStatementUpload}
        onRowsMatched={handleStatementCompareRowsMatched}
        onEntryAdded={handleStatementCompareEntryAdded}
      />

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("categories")}
          aria-expanded={settingsSectionsOpen.categories}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.categoriesTitle}</h3>
              <p>{messages.settings.categoriesDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.categories ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.categories ? (
          <>
            <div className="settings-actions">
              <button type="button" className="subtle-action" onClick={openCreateCategoryDialog}>
                {messages.settings.addCategory}
              </button>
            </div>
            <div className="settings-categories-grid">
              {visibleCategories.map((category) => (
                <div key={category.id} className="settings-account-row settings-category-card">
                  <span
                    className="category-icon category-icon-static settings-category-icon"
                    style={{ "--category-color": category.colorHex }}
                  >
                    <CategoryGlyph iconKey={category.iconKey} />
                  </span>
                  <div className="settings-account-main">
                    <strong>{category.name}</strong>
                    <p>{messages.common.triplet(category.slug, category.iconKey, category.colorHex)}</p>
                  </div>
                  <div className="settings-account-actions">
                    <button type="button" className="icon-action" aria-label={messages.settings.editCategory} onClick={() => openEditCategoryDialog(category)}>
                      <SquarePen size={16} />
                    </button>
                    <DeleteRowButton
                      label={category.name}
                      triggerLabel={messages.settings.deleteCategory}
                      confirmLabel={messages.settings.deleteCategory}
                      destructive={false}
                      prompt={messages.settings.deleteCategoryDetail(category.name)}
                      onConfirm={() => handleDeleteCategory(category)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("trust")}
          aria-expanded={settingsSectionsOpen.trust}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.trustRulesTitle}</h3>
              <p>{messages.settings.trustRulesDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.trust ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.trust ? (
          <div className="settings-trust-grid">
            <div className="settings-demo-meta-item">
              <span>{messages.settings.trustOpeningTitle}</span>
              <strong>{messages.settings.trustOpeningDetail}</strong>
              <p>{messages.settings.trustOpeningAction}</p>
            </div>
            <div className="settings-demo-meta-item">
              <span>{messages.settings.trustCheckpointTitle}</span>
              <strong>{messages.settings.trustCheckpointDetail}</strong>
              <p>{messages.settings.trustCheckpointAction}</p>
            </div>
            <div className="settings-demo-meta-item">
              <span>{messages.settings.trustTransfersTitle}</span>
              <strong>{messages.settings.trustTransfersDetail}</strong>
              <p>{messages.settings.trustTransfersAction}</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("transfers")}
          aria-expanded={settingsSectionsOpen.transfers}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.unresolvedTransfersTitle}</h3>
              <p>{messages.settings.unresolvedTransfersDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.transfers ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.transfers ? (
          <>
            <div className="settings-transfer-list">
              {settingsPage.unresolvedTransfers.length ? settingsPage.unresolvedTransfers.map((item) => (
                <div key={item.entryId} className="settings-account-row settings-transfer-row">
                  <div className="settings-account-main settings-transfer-main">
                    <strong>{item.description}</strong>
                    <p>{messages.common.triplet(formatDateOnly(item.date), item.accountName, item.transferDirection === "in" ? "Transfer in" : "Transfer out")}</p>
                  </div>
                  <strong className="settings-transfer-amount">{money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</strong>
                  <div className="settings-account-actions">
                    <button type="button" className="subtle-action" onClick={() => openTransferReview(item.entryId)}>
                      {messages.settings.openTransferReview}
                    </button>
                  </div>
                </div>
              )) : (
                <p className="lede compact">{messages.common.emptyValue}</p>
              )}
            </div>
          </>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => toggleSettingsSection("activity")}
          aria-expanded={settingsSectionsOpen.activity}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.recentActivityTitle}</h3>
              <p>{messages.settings.recentActivityDetail}</p>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${settingsSectionsOpen.activity ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {settingsSectionsOpen.activity ? (
          <div className="settings-activity-groups">
            {recentActivityGroups.length ? recentActivityGroups.map((group) => (
              <section key={group.date} className="settings-activity-group">
                <div className="settings-activity-date">{formatDateOnly(group.date)}</div>
                <div className="settings-activity-list">
                  {group.events.map((event) => (
                    <div key={event.id} className="settings-account-row settings-activity-row">
                      <div className="settings-account-main">
                        <strong>{formatAuditAction(event.action)}</strong>
                        <p>{event.detail}</p>
                      </div>
                      <p className="settings-account-meta">{formatDate(event.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )) : (
              <p className="lede compact">{messages.common.emptyValue}</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="chart-card settings-card">
        <button
          type="button"
          className="settings-section-toggle"
          onClick={() => setDemoStateOpen((current) => !current)}
          aria-expanded={demoStateOpen}
        >
          <div className="settings-section-toggle-copy">
            <div className="chart-head">
              <h3>{messages.settings.demoTitle}</h3>
              <p>{messages.settings.demoDetail}</p>
            </div>
            <div className="settings-demo-meta">
              <div className="settings-demo-meta-item">
                <span>{messages.settings.salaryPerPerson}</span>
                <strong>{money(settingsPage.demo.salaryPerPersonMinor)}</strong>
              </div>
              <div className="settings-demo-meta-item">
                <span>{messages.settings.state}</span>
                <strong>{settingsPage.demo.emptyState ? messages.settings.emptyMode : messages.settings.seededMode}</strong>
              </div>
              <div className="settings-demo-meta-item">
                <span>{messages.settings.seededAt}</span>
                <strong>{formatDate(settingsPage.demo.lastSeededAt)}</strong>
              </div>
            </div>
          </div>
          <span className={`settings-section-toggle-icon ${demoStateOpen ? "is-open" : ""}`}>
            <ChevronRight size={18} />
          </span>
        </button>
        {demoStateOpen ? (
          <>
            <div className="settings-actions">
              <button type="button" className="subtle-action" onClick={handleReseed} disabled={isSubmitting}>
                {messages.settings.reseed}
              </button>
              <button type="button" className="subtle-action" onClick={handleRefresh} disabled={isSubmitting}>
                {messages.settings.refresh}
              </button>
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button type="button" className="subtle-action subtle-danger" disabled={isSubmitting}>
                    {messages.settings.emptyState}
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="note-dialog-overlay" />
                  <Dialog.Content className="note-dialog-content">
                    <div className="note-dialog-head">
                      <div>
                        <Dialog.Title>{messages.settings.emptyState}</Dialog.Title>
                        <Dialog.Description>{messages.settings.emptyStateDetail}</Dialog.Description>
                      </div>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="icon-action subtle-cancel"
                          aria-label="Close empty-state dialog"
                        >
                          <X size={16} />
                        </button>
                      </Dialog.Close>
                    </div>
                    <input
                      className="table-edit-input"
                      placeholder={messages.settings.emptyStatePlaceholder}
                      value={emptyStateText}
                      onChange={(event) => setEmptyStateText(event.target.value)}
                    />
                    <div className="note-dialog-actions">
                      <Dialog.Close asChild>
                        <button type="button" className="subtle-action">Cancel</button>
                      </Dialog.Close>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          className="subtle-action subtle-danger"
                          disabled={emptyStateText.trim().toLowerCase() !== "empty state" || isSubmitting}
                          onClick={handleEmptyState}
                        >
                          {messages.settings.emptyStateConfirm}
                        </button>
                      </Dialog.Close>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
            <p className="lede compact">{messages.settings.refreshHint}</p>
          </>
        ) : null}
      </section>

      <SettingsPersonDialog
        dialog={personDialog}
        isSubmitting={isSubmitting}
        onChange={setPersonDialog}
        onClose={() => setPersonDialog(null)}
        onSave={handleSavePerson}
      />

      <SettingsAccountDialog
        dialog={accountDialog}
        error={accountDialogError}
        people={people}
        isSubmitting={isSubmitting}
        onChange={setAccountDialog}
        onClose={() => {
          setAccountDialog(null);
          setAccountDialogError("");
        }}
        onSave={handleSaveAccount}
      />

      <SettingsCategoryDialog
        dialog={categoryDialog}
        isSubmitting={isSubmitting}
        onChange={setCategoryDialog}
        onClose={() => setCategoryDialog(null)}
        onSave={handleSaveCategory}
      />

      <SettingsReconciliationDialog
        dialog={reconciliationDialog}
        isSubmitting={isSubmitting}
        checkpointHistoryYears={checkpointHistoryYears}
        checkpointHistoryYear={checkpointHistoryYear}
        visibleCheckpointHistory={visibleCheckpointHistory}
        onChange={setReconciliationDialog}
        onHistoryYearChange={setCheckpointHistoryYear}
        onClose={() => {
          setReconciliationDialog(null);
          setStatementCompareResult(null);
          setStatementCompareStatus(null);
        }}
        onSave={handleSaveReconciliation}
        onEditCheckpoint={handleEditCheckpoint}
        onDownloadCheckpoint={handleDownloadCheckpointExport}
        onCompareCheckpoint={openStatementComparePanelFromDialog}
        renderCheckpointDeleteAction={(item) => (
          <DeleteRowButton
            label={formatMonthLabel(item.month)}
            triggerLabel={messages.settings.checkpointDelete}
            confirmLabel={messages.settings.checkpointDelete}
            destructive={false}
            prompt={messages.settings.checkpointDeleteDetail(formatMonthLabel(item.month))}
            onConfirm={() => handleDeleteCheckpoint(item)}
          />
        )}
        formatCheckpointMonth={(item) => formatMonthLabel(item.month)}
        formatCheckpointCoverage={formatCheckpointCoverage}
        formatCheckpointBalanceLine={(item) => formatCheckpointHistoryBalanceLine(item, reconciliationDialog?.accountKind)}
        formatCheckpointDelta={(item) => (item.deltaMinor === 0 ? "Matched" : `Delta ${money(Math.abs(item.deltaMinor))}`)}
      />

    </article>
  );
}
