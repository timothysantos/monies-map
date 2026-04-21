import { useEffect, useMemo, useState } from "react";
import { LogOut } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { extractPdfText, selectParsedStatementForCompare } from "./import-helpers";
import {
  archiveSettingsAccount,
  compareAccountCheckpointStatement,
  deleteCategoryMatchRule,
  deleteAccountCheckpoint,
  deleteSettingsCategory,
  dismissAllUnresolvedTransfers,
  dismissUnresolvedTransfer,
  fetchCheckpointExport,
  ignoreCategoryMatchRuleSuggestion,
  runDemoAction,
  saveAccountCheckpoint,
  saveCategoryMatchRule,
  saveSettingsAccount,
  saveSettingsCategory,
  updateSettingsPerson
} from "./settings-api";
import { SettingsAccountsSection } from "./settings-accounts-section";
import { SettingsAccountDialog, SettingsCategoryDialog, SettingsCategoryMatchRuleDialog, SettingsPersonDialog } from "./settings-dialogs";
import { SettingsReconciliationDialog } from "./settings-reconciliation-dialog";
import {
  SettingsActivitySection,
  SettingsCategoriesSection,
  SettingsCategoryMatchRulesSection,
  SettingsDemoSection,
  SettingsPeopleSection,
  SettingsTransfersSection,
  SettingsTrustSection
} from "./settings-sections";
import { DeleteRowButton } from "./ui-components";
import { FALLBACK_THEME } from "./ui-options";
import {
  formatCheckpointCoverage,
  formatCheckpointHistoryBalanceLine,
  formatCheckpointStatementInputMinor,
  formatMinorInput,
  formatMonthLabel,
  money,
  parseDraftMoneyInput
} from "./formatters";
import { inspectCsv } from "../lib/csv";
import { getCurrentMonthKey } from "../lib/month";
import { parseStatementText } from "../lib/statement-import";

const DEFAULT_MONTH_KEY = getCurrentMonthKey();

export function SettingsPanel({
  settingsPage,
  accounts,
  categories,
  people,
  viewId,
  viewLabel,
  appEnvironment,
  viewerIdentity,
  loginIdentityError,
  isUnregisteringLogin,
  onUnregisterLogin,
  onLogout,
  onRefresh
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emptyStateText, setEmptyStateText] = useState("");
  const [emptyStateDialogOpen, setEmptyStateDialogOpen] = useState(false);
  const [reloadText, setReloadText] = useState("");
  const [reloadDialogOpen, setReloadDialogOpen] = useState(false);
  const [demoActionError, setDemoActionError] = useState("");
  const [demoStateOpen, setDemoStateOpen] = useState(false);
  const [settingsSectionsOpen, setSettingsSectionsOpen] = useState({
    people: false,
    accounts: false,
    categories: false,
    categoryRules: false,
    trust: false,
    transfers: false,
    activity: false
  });
  const [personDialog, setPersonDialog] = useState(null);
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountDialogError, setAccountDialogError] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(null);
  const [categoryRuleDialog, setCategoryRuleDialog] = useState(null);
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
  const canUseDemoControls = appEnvironment === "demo" || appEnvironment === "local";

  useEffect(() => {
    if (searchParams.get("settings_section") !== "categoryRules") {
      return;
    }

    setSettingsSectionsOpen((current) => ({ ...current, categoryRules: true }));
    window.requestAnimationFrame(() => {
      document.getElementById("settings-category-rules")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, [searchParams]);

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
    setDemoActionError("");
    try {
      await runDemoAction("/api/demo/reseed", "Demo reseed failed.");
      await onRefresh();
    } catch (error) {
      setDemoActionError(error instanceof Error ? error.message : "Demo reseed failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefresh() {
    setIsSubmitting(true);
    setDemoActionError("");
    try {
      await onRefresh();
      setReloadText("");
      setReloadDialogOpen(false);
    } catch (error) {
      setDemoActionError(error instanceof Error ? error.message : "Reload failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEmptyState() {
    setIsSubmitting(true);
    setDemoActionError("");
    try {
      await runDemoAction("/api/demo/empty", "Empty-state reset failed.");
      const refreshedBootstrap = await onRefresh();
      if (refreshedBootstrap?.accounts?.length) {
        throw new Error(messages.settings.emptyStateStillHasAccounts);
      }
      setEmptyStateText("");
      setEmptyStateDialogOpen(false);
    } catch (error) {
      setDemoActionError(error instanceof Error ? error.message : "Empty-state reset failed.");
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

  function openCreateCategoryRuleDialog() {
    setCategoryRuleDialog({
      mode: "create",
      ruleId: "",
      sourceSuggestionId: "",
      pattern: "",
      categoryId: categories.find((category) => category.name === "Other")?.id ?? categories[0]?.id ?? "",
      priority: 100,
      isActive: true,
      note: ""
    });
  }

  function openEditCategoryRuleDialog(rule) {
    setCategoryRuleDialog({
      mode: "edit",
      ruleId: rule.id,
      sourceSuggestionId: "",
      pattern: rule.pattern,
      categoryId: rule.categoryId,
      priority: rule.priority,
      isActive: rule.isActive,
      note: rule.note ?? ""
    });
  }

  function openCategoryRuleSuggestionDialog(suggestion) {
    setCategoryRuleDialog({
      mode: "create",
      ruleId: "",
      sourceSuggestionId: suggestion.id,
      pattern: suggestion.pattern,
      categoryId: suggestion.categoryId,
      priority: 100,
      isActive: true,
      note: messages.settings.categoryRuleSuggestionNote(suggestion.sourceCount)
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
      await saveSettingsAccount({
        mode: accountDialog.mode,
        accountId: accountDialog.accountId,
        name: accountDialog.name,
        institution: accountDialog.institution,
        kind: accountDialog.kind,
        currency: accountDialog.currency,
        openingBalanceMinor: parseDraftMoneyInput(accountDialog.openingBalance ?? "0"),
        ownerPersonId: accountDialog.ownerPersonId,
        isJoint: accountDialog.isJoint
      });
      setAccountDialog(null);
      await onRefresh();
    } catch (error) {
      setAccountDialogError(error instanceof Error ? error.message : "Account save failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleArchiveAccount(accountId) {
    setIsSubmitting(true);
    try {
      await archiveSettingsAccount(accountId);
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
      await saveAccountCheckpoint({
        accountId: reconciliationDialog.accountId,
        checkpointMonth: reconciliationDialog.checkpointMonth,
        statementStartDate: reconciliationDialog.statementStartDate,
        statementEndDate: reconciliationDialog.statementEndDate,
        statementBalanceMinor: parseDraftMoneyInput(reconciliationDialog.statementBalance ?? "0"),
        note: reconciliationDialog.note
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
      await deleteAccountCheckpoint({
        accountId: reconciliationDialog.accountId,
        checkpointMonth: item.month
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
      const exportFile = await fetchCheckpointExport({
        accountId: reconciliationDialog.accountId,
        checkpointMonth: item.month
      });

      const blobUrl = URL.createObjectURL(exportFile.blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = exportFile.filename;
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
      const data = await compareAccountCheckpointStatement({
        accountId: target.accountId,
        checkpointMonth: target.checkpointMonth,
        uploadedStatementStartDate,
        uploadedStatementEndDate,
        rows
      });

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
      await saveSettingsCategory({
        mode: categoryDialog.mode,
        categoryId: categoryDialog.categoryId,
        name: categoryDialog.name,
        slug: categoryDialog.slug,
        iconKey: categoryDialog.iconKey,
        colorHex: categoryDialog.colorHex
      });
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
      await updateSettingsPerson({
        personId: personDialog.personId,
        name: personDialog.name
      });
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
      await deleteSettingsCategory(category.id);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete category");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveCategoryRule() {
    if (!categoryRuleDialog?.pattern?.trim() || !categoryRuleDialog.categoryId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await saveCategoryMatchRule({
        ruleId: categoryRuleDialog.ruleId || undefined,
        sourceSuggestionId: categoryRuleDialog.sourceSuggestionId || undefined,
        pattern: categoryRuleDialog.pattern,
        categoryId: categoryRuleDialog.categoryId,
        priority: categoryRuleDialog.priority,
        isActive: categoryRuleDialog.isActive,
        note: categoryRuleDialog.note
      });
      setCategoryRuleDialog(null);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save category match rule");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAcceptCategoryRuleSuggestion(suggestion) {
    setIsSubmitting(true);
    try {
      await saveCategoryMatchRule({
        sourceSuggestionId: suggestion.id,
        pattern: suggestion.pattern,
        categoryId: suggestion.categoryId,
        priority: 100,
        isActive: true,
        note: messages.settings.categoryRuleSuggestionNote(suggestion.sourceCount)
      });
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to save category match rule");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleIgnoreCategoryRuleSuggestion(suggestion) {
    setIsSubmitting(true);
    try {
      await ignoreCategoryMatchRuleSuggestion(suggestion.id);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to ignore category match suggestion");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCategoryRule(rule) {
    setIsSubmitting(true);
    try {
      await deleteCategoryMatchRule(rule.id);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete category match rule");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDismissUnresolvedTransfer(entryId) {
    setIsSubmitting(true);
    try {
      await dismissUnresolvedTransfer(entryId);
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to clear unresolved transfer");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDismissAllUnresolvedTransfers() {
    if (!settingsPage.unresolvedTransfers.length) {
      return;
    }
    if (!window.confirm(`Clear all ${settingsPage.unresolvedTransfers.length} unresolved transfer reviews? This will only hide them from this review list.`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await dismissAllUnresolvedTransfers();
      await onRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to clear unresolved transfers");
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

      {viewerIdentity?.email ? (
        <section className="chart-card settings-card settings-login-card">
          <div className="settings-login-main">
            <span className="settings-login-icon" aria-hidden="true">
              <LogOut size={18} />
            </span>
            <div>
              <h3>{viewerIdentity.personId ? "Login linked" : "Signed in"}</h3>
              <p>{viewerIdentity.email}</p>
              {loginIdentityError ? <span className="form-error">{loginIdentityError}</span> : null}
            </div>
          </div>
          <div className="settings-login-actions">
            {viewerIdentity.personId ? (
              <button type="button" className="subtle-action" disabled={isUnregisteringLogin} onClick={() => void onUnregisterLogin()}>
                {isUnregisteringLogin ? "Unregistering..." : "Unregister"}
              </button>
            ) : null}
            <button type="button" className="subtle-action" onClick={onLogout}>Log out</button>
          </div>
        </section>
      ) : null}

      <SettingsPeopleSection
        people={people}
        isOpen={settingsSectionsOpen.people}
        onToggle={() => toggleSettingsSection("people")}
        onEditPerson={openEditPersonDialog}
      />

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

      <SettingsCategoriesSection
        categories={visibleCategories}
        isOpen={settingsSectionsOpen.categories}
        onToggle={() => toggleSettingsSection("categories")}
        onCreateCategory={openCreateCategoryDialog}
        onEditCategory={openEditCategoryDialog}
        onDeleteCategory={handleDeleteCategory}
      />

      <SettingsCategoryMatchRulesSection
        id="settings-category-rules"
        rules={settingsPage.categoryMatchRules ?? []}
        categories={categories}
        suggestions={settingsPage.categoryMatchRuleSuggestions ?? []}
        isOpen={settingsSectionsOpen.categoryRules}
        onToggle={() => toggleSettingsSection("categoryRules")}
        onCreateRule={openCreateCategoryRuleDialog}
        onEditRule={openEditCategoryRuleDialog}
        onDeleteRule={handleDeleteCategoryRule}
        onAcceptSuggestion={handleAcceptCategoryRuleSuggestion}
        onEditSuggestion={openCategoryRuleSuggestionDialog}
        onIgnoreSuggestion={handleIgnoreCategoryRuleSuggestion}
      />

      <SettingsTrustSection
        isOpen={settingsSectionsOpen.trust}
        onToggle={() => toggleSettingsSection("trust")}
      />

      <SettingsTransfersSection
        transfers={settingsPage.unresolvedTransfers}
        isOpen={settingsSectionsOpen.transfers}
        isSubmitting={isSubmitting}
        onToggle={() => toggleSettingsSection("transfers")}
        onDismissTransfer={handleDismissUnresolvedTransfer}
        onDismissAllTransfers={handleDismissAllUnresolvedTransfers}
        onOpenTransferReview={openTransferReview}
      />

      <SettingsActivitySection
        activityGroups={recentActivityGroups}
        isOpen={settingsSectionsOpen.activity}
        onToggle={() => toggleSettingsSection("activity")}
      />

      {canUseDemoControls ? (
        <SettingsDemoSection
          demo={settingsPage.demo}
          error={demoActionError}
          emptyStateDialogOpen={emptyStateDialogOpen}
          emptyStateText={emptyStateText}
          isOpen={demoStateOpen}
          isSubmitting={isSubmitting}
          reloadDialogOpen={reloadDialogOpen}
          reloadText={reloadText}
          onEmptyStateDialogOpenChange={setEmptyStateDialogOpen}
          onReloadDialogOpenChange={setReloadDialogOpen}
          onToggle={() => setDemoStateOpen((current) => !current)}
          onEmptyStateTextChange={setEmptyStateText}
          onReloadTextChange={setReloadText}
          onReseed={handleReseed}
          onRefresh={handleRefresh}
          onEmptyState={handleEmptyState}
        />
      ) : null}

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

      <SettingsCategoryMatchRuleDialog
        dialog={categoryRuleDialog}
        categories={categories}
        isSubmitting={isSubmitting}
        onChange={setCategoryRuleDialog}
        onClose={() => setCategoryRuleDialog(null)}
        onSave={handleSaveCategoryRule}
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
