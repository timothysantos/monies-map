import { useEffect, useMemo, useState } from "react";
import { LogOut } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import {
  archiveAccount,
  compareAccountCheckpointStatement,
  deleteAccountCheckpoint,
  fetchCheckpointExport,
  saveAccount,
  saveAccountCheckpoint
} from "./accounts-api";
import {
  createReconciliationException,
  deleteCategoryMatchRule,
  deleteSettingsCategory,
  dismissAllUnresolvedTransfers,
  dismissUnresolvedTransfer,
  ignoreCategoryMatchRuleSuggestion,
  resolveReconciliationException,
  runDemoAction,
  saveCategoryMatchRule,
  saveSettingsCategory,
  updateSettingsPerson
} from "./settings-api";
import { AccountDialog } from "./account-dialog";
import { SettingsAccountsSection } from "./settings-accounts-section";
import { SettingsCategoryDialog, SettingsCategoryMatchRuleDialog, SettingsPersonDialog } from "./settings-dialogs";
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
import { buildSettingsRefreshPlan } from "./settings-refresh-plan";
import {
  buildCheckpointHistoryYears,
  buildCreateAccountDialog,
  buildCreateCategoryDialog,
  buildCreateCategoryRuleDialog,
  buildEditAccountDialog,
  buildEditCategoryDialog,
  buildEditCategoryRuleDialog,
  buildPersonDialog,
  buildReconciliationDialog,
  buildSafeSettingsPage,
  buildStatementComparePanel,
  buildSuggestionCategoryRuleDialog,
  filterCheckpointHistoryByYear,
  getVisibleSettingsAccounts,
  getVisibleSettingsCategories,
  groupSettingsAuditEventsByDate
} from "./settings-workflow";
import { inspectCsv } from "../lib/csv";
import { getCurrentMonthKey } from "../lib/month";
import { parseStatementText } from "../lib/statement-import";

const DEFAULT_MONTH_KEY = getCurrentMonthKey();
const { format: formatService, imports: importService } = moniesClient;

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
  // Settings shows demo and reconciliation sections that expect a shaped page
  // slice, so keep the fallback DTO builder in the settings workflow module.
  const safeSettingsPage = useMemo(() => buildSafeSettingsPage(settingsPage), [settingsPage]);
  const visibleAccounts = useMemo(() => getVisibleSettingsAccounts(accounts, viewId), [accounts, viewId]);
  const visibleCategories = useMemo(() => getVisibleSettingsCategories(categories), [categories]);
  const recentActivityGroups = useMemo(
    () => groupSettingsAuditEventsByDate(safeSettingsPage.recentAuditEvents),
    [safeSettingsPage.recentAuditEvents]
  );
  const checkpointHistoryYears = useMemo(
    () => buildCheckpointHistoryYears(reconciliationDialog?.history ?? []),
    [reconciliationDialog?.history]
  );
  const visibleCheckpointHistory = useMemo(
    () => filterCheckpointHistoryByYear(reconciliationDialog?.history ?? [], checkpointHistoryYear),
    [checkpointHistoryYear, reconciliationDialog?.history]
  );
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
      await onRefresh({
        ...buildSettingsRefreshPlan("demo_reseed"),
        broadcast: true
      });
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
      const refreshedAppShell = await onRefresh({
        ...buildSettingsRefreshPlan("demo_empty_state"),
        broadcast: true
      });
      if (refreshedAppShell?.accounts?.length) {
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
    setAccountDialog(buildCreateAccountDialog());
  }

  function openEditAccountDialog(account) {
    setAccountDialogError("");
    setAccountDialog(buildEditAccountDialog(account, formatService.formatMinorInput));
  }

  function openReconciliationDialog(account) {
    setReconciliationDialog(
      buildReconciliationDialog(account, formatService.formatCheckpointStatementInputMinor)
    );
  }

  function openStatementComparePanel(account, checkpoint) {
    const nextPanel = buildStatementComparePanel(account, checkpoint);
    if (!nextPanel) {
      return;
    }

    setSettingsSectionsOpen((current) => ({ ...current, accounts: true }));
    setStatementComparePanel(nextPanel);
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
    setCategoryDialog(buildCreateCategoryDialog(FALLBACK_THEME));
  }

  function openEditCategoryDialog(category) {
    setCategoryDialog(buildEditCategoryDialog(category));
  }

  function openCreateCategoryRuleDialog() {
    setCategoryRuleDialog(buildCreateCategoryRuleDialog(categories));
  }

  function openEditCategoryRuleDialog(rule) {
    setCategoryRuleDialog(buildEditCategoryRuleDialog(rule));
  }

  function openCategoryRuleSuggestionDialog(suggestion) {
    setCategoryRuleDialog(
      buildSuggestionCategoryRuleDialog(
        suggestion,
        messages.settings.categoryRuleSuggestionNote
      )
    );
  }

  function openEditPersonDialog(person) {
    setPersonDialog(buildPersonDialog(person));
  }

  async function handleSaveAccount() {
    if (!accountDialog) {
      return;
    }

    setIsSubmitting(true);
    setAccountDialogError("");
    try {
      await saveAccount({
        mode: accountDialog.mode,
        accountId: accountDialog.accountId,
        name: accountDialog.name,
        institution: accountDialog.institution,
        kind: accountDialog.kind,
        currency: accountDialog.currency,
        openingBalanceMinor: formatService.parseDraftMoneyInput(accountDialog.openingBalance ?? "0"),
        ownerPersonId: accountDialog.ownerPersonId,
        isJoint: accountDialog.isJoint
      });
      setAccountDialog(null);
      await onRefresh(buildSettingsRefreshPlan("account_saved"));
    } catch (error) {
      setAccountDialogError(error instanceof Error ? error.message : "Account save failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleArchiveAccount(accountId) {
    setIsSubmitting(true);
    try {
      await archiveAccount(accountId);
      await onRefresh(buildSettingsRefreshPlan("account_archived"));
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
        statementBalanceMinor: formatService.parseDraftMoneyInput(reconciliationDialog.statementBalance ?? "0"),
        note: reconciliationDialog.note
      });
      setReconciliationDialog(null);
      await onRefresh(buildSettingsRefreshPlan("checkpoint_saved"));
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
      await onRefresh(buildSettingsRefreshPlan("checkpoint_deleted"));
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
        const parsed = parseStatementText(await importService.extractPdfText(file), file.name);
        const selectedStatement = importService.selectParsedStatementForCompare(parsed, target);
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
      statementBalance: formatService.formatCheckpointStatementInputMinor(item.statementBalanceMinor, current.accountKind),
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
      await onRefresh(buildSettingsRefreshPlan("category_saved"));
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
      await onRefresh(buildSettingsRefreshPlan("person_saved"));
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
      await onRefresh(buildSettingsRefreshPlan("category_deleted"));
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
      await onRefresh(buildSettingsRefreshPlan("category_rule_saved"));
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
      await onRefresh(buildSettingsRefreshPlan("category_rule_suggestion_accepted"));
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
      await onRefresh(buildSettingsRefreshPlan("category_rule_suggestion_ignored"));
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
      await onRefresh(buildSettingsRefreshPlan("category_rule_deleted"));
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
      await onRefresh(buildSettingsRefreshPlan("unresolved_transfer_dismissed"));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to clear unresolved transfer");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDismissAllUnresolvedTransfers() {
    if (!safeSettingsPage.unresolvedTransfers.length) {
      return;
    }
    if (!window.confirm(`Clear all ${safeSettingsPage.unresolvedTransfers.length} unresolved transfer reviews? This will only hide them from this review list.`)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await dismissAllUnresolvedTransfers();
      await onRefresh(buildSettingsRefreshPlan("unresolved_transfer_dismissed_all"));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to clear unresolved transfers");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateReconciliationException(draft) {
    setIsSubmitting(true);
    try {
      await createReconciliationException(draft);
      await onRefresh(buildSettingsRefreshPlan("reconciliation_exception_created"));
      return true;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to create reconciliation exception.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResolveReconciliationException(exceptionId) {
    setIsSubmitting(true);
    try {
      await resolveReconciliationException({ exceptionId });
      await onRefresh(buildSettingsRefreshPlan("reconciliation_exception_resolved"));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to resolve reconciliation exception.");
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
    void onRefresh(buildSettingsRefreshPlan("statement_compare_linked"));
  }

  function handleStatementCompareEntryAdded(rowId) {
    setStatementCompareResult((current) => current ? {
      ...current,
      ledgerRowCount: current.ledgerRowCount + 1,
      unmatchedStatementRows: current.unmatchedStatementRows.filter((row) => row.id !== rowId)
    } : current);
    setStatementCompareStatus({ tone: "success", message: messages.settings.statementCompareEntryAdded });
    void onRefresh(buildSettingsRefreshPlan("statement_compare_entry_added"));
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
        rules={safeSettingsPage.categoryMatchRules ?? []}
        categories={categories}
        suggestions={safeSettingsPage.categoryMatchRuleSuggestions ?? []}
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
        accounts={visibleAccounts}
        exceptions={safeSettingsPage.reconciliationExceptions ?? []}
        isOpen={settingsSectionsOpen.trust}
        isSubmitting={isSubmitting}
        onToggle={() => toggleSettingsSection("trust")}
        onCreateException={handleCreateReconciliationException}
        onResolveException={handleResolveReconciliationException}
      />

      <SettingsTransfersSection
        transfers={safeSettingsPage.unresolvedTransfers}
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
          demo={safeSettingsPage.demo}
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

      <AccountDialog
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
            label={formatService.formatMonthLabel(item.month)}
            triggerLabel={messages.settings.checkpointDelete}
            confirmLabel={messages.settings.checkpointDelete}
            destructive={false}
            prompt={messages.settings.checkpointDeleteDetail(formatService.formatMonthLabel(item.month))}
            onConfirm={() => handleDeleteCheckpoint(item)}
          />
        )}
        formatCheckpointMonth={(item) => formatService.formatMonthLabel(item.month)}
        formatCheckpointCoverage={formatService.formatCheckpointCoverage}
        formatCheckpointBalanceLine={(item) => formatService.formatCheckpointHistoryBalanceLine(item, reconciliationDialog?.accountKind)}
        formatCheckpointDelta={(item) => (item.deltaMinor === 0 ? "Matched" : `Delta ${formatService.money(Math.abs(item.deltaMinor))}`)}
      />

    </article>
  );
}
