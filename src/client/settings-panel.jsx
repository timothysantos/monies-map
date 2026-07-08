import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut } from "lucide-react";
import { useSearchParams } from "react-router-dom";

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
  ignoreCategoryMatchRuleIssue,
  ignoreCategoryMatchRuleSuggestion,
  retainLatestErrorDiagnostics,
  resolveReconciliationException,
  runDemoAction,
  saveCategoryMatchRule,
  saveShortcutSettings,
  saveSettingsCategory,
  updateSettingsPerson
} from "./settings-api";
import { AccountDialog } from "./account-dialog";
import { SettingsAccountsSection } from "./settings-accounts-section";
import { SettingsCategoryDialog, SettingsCategoryMatchRuleDialog, SettingsPersonDialog } from "./settings-dialogs";
import { SettingsReconciliationDialog } from "./settings-reconciliation-dialog";
import { EntryTransferTools } from "./entry-editor";
import {
  SettingsActivitySection,
  SettingsCategoriesSection,
  SettingsCategoryMatchRulesSection,
  SettingsDemoSection,
  SettingsErrorDiagnosticsSection,
  SettingsPeopleSection,
  SettingsShortcutApiSection,
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
  buildShortcutSettingsDraft,
  buildStatementComparePanel,
  buildSuggestionCategoryRuleDialog,
  filterCheckpointHistoryByYear,
  getVisibleSettingsAccounts,
  getVisibleSettingsCategories,
  groupSettingsAuditEventsByDate,
  reorderShortcutAccountPriorityIds
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
  const [settingsActionError, setSettingsActionError] = useState("");
  const [dismissTransfersConfirmOpen, setDismissTransfersConfirmOpen] = useState(false);
  const [demoStateOpen, setDemoStateOpen] = useState(false);
  const [settingsSectionsOpen, setSettingsSectionsOpen] = useState({
    people: false,
    accounts: false,
    shortcutApi: false,
    categories: false,
    categoryRules: false,
    trust: false,
    transfers: false,
    errorDiagnostics: false,
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
  const [transferDialogEntryId, setTransferDialogEntryId] = useState(null);
  const [transferDialogEntry, setTransferDialogEntry] = useState(null);
  const [transferCandidates, setTransferCandidates] = useState([]);
  const [transferCandidatesError, setTransferCandidatesError] = useState("");
  const [refreshingTransferCandidatesEntryId, setRefreshingTransferCandidatesEntryId] = useState(null);
  const [linkingTransferEntryId, setLinkingTransferEntryId] = useState(null);
  const [settlingTransferEntryId, setSettlingTransferEntryId] = useState(null);
  const [transferSettlementDrafts, setTransferSettlementDrafts] = useState({});
  const [searchParams] = useSearchParams();
  // Settings shows demo and reconciliation sections that expect a shaped page
  // slice, so keep the fallback DTO builder in the settings workflow module.
  const safeSettingsPage = useMemo(() => buildSafeSettingsPage(settingsPage), [settingsPage]);
  const visibleAccounts = useMemo(() => getVisibleSettingsAccounts(accounts, viewId), [accounts, viewId]);
  const visibleCategories = useMemo(() => getVisibleSettingsCategories(categories), [categories]);
  const categoryOptions = useMemo(() => categories.map((category) => category.name), [categories]);
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
  const [shortcutSettingsDraft, setShortcutSettingsDraft] = useState(() => buildShortcutSettingsDraft(safeSettingsPage.shortcutSettings, accounts));
  const [shortcutSettingsError, setShortcutSettingsError] = useState("");

  useEffect(() => {
    setShortcutSettingsDraft(buildShortcutSettingsDraft(safeSettingsPage.shortcutSettings, accounts));
  }, [safeSettingsPage.shortcutSettings, accounts]);

  useEffect(() => {
    const targetSection = searchParams.get("settings_section");
    if (targetSection !== "categoryRules" && targetSection !== "errorDiagnostics") {
      return;
    }

    const sectionKey = targetSection === "errorDiagnostics" ? "errorDiagnostics" : "categoryRules";
    const elementId = targetSection === "errorDiagnostics" ? "settings-error-diagnostics" : "settings-category-rules";
    setSettingsSectionsOpen((current) => ({ ...current, [sectionKey]: true }));
    window.requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({ block: "start", behavior: "smooth" });
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
    setSettingsActionError("");
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
      setSettingsActionError(error instanceof Error ? error.message : "Checkpoint export failed.");
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
    setSettingsActionError("");
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
      setSettingsActionError(error instanceof Error ? error.message : "Failed to save category");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSavePerson() {
    if (!personDialog?.personId || !personDialog.name?.trim()) {
      return;
    }

    setIsSubmitting(true);
    setSettingsActionError("");
    try {
      await updateSettingsPerson({
        personId: personDialog.personId,
        name: personDialog.name
      });
      setPersonDialog(null);
      await onRefresh(buildSettingsRefreshPlan("person_saved"));
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to update person");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCategory(category) {
    setIsSubmitting(true);
    setSettingsActionError("");
    try {
      await deleteSettingsCategory(category.id);
      await onRefresh(buildSettingsRefreshPlan("category_deleted"));
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to delete category");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveCategoryRule() {
    if (!categoryRuleDialog?.pattern?.trim() || !categoryRuleDialog.categoryId) {
      return;
    }

    setIsSubmitting(true);
    setSettingsActionError("");
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
      setSettingsActionError(error instanceof Error ? error.message : "Failed to save category match rule");
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
      setSettingsActionError(error instanceof Error ? error.message : "Failed to save category match rule");
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
      setSettingsActionError(error instanceof Error ? error.message : "Failed to ignore category match suggestion");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleIgnoreCategoryRuleIssue(issue) {
    setIsSubmitting(true);
    try {
      await ignoreCategoryMatchRuleIssue(issue.id);
      await onRefresh(buildSettingsRefreshPlan("category_rule_issue_ignored"));
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to ignore duplicate rule issue");
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
      setSettingsActionError(error instanceof Error ? error.message : "Failed to delete category match rule");
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
      setSettingsActionError(error instanceof Error ? error.message : "Failed to clear unresolved transfer");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDismissAllUnresolvedTransfers() {
    if (!safeSettingsPage.unresolvedTransfers.length) {
      return;
    }
    setDismissTransfersConfirmOpen(true);
  }

  async function confirmDismissAllUnresolvedTransfers() {
    setDismissTransfersConfirmOpen(false);
    setIsSubmitting(true);
    setSettingsActionError("");
    try {
      await dismissAllUnresolvedTransfers();
      await onRefresh(buildSettingsRefreshPlan("unresolved_transfer_dismissed_all"));
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to clear unresolved transfers");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateReconciliationException(draft) {
    setIsSubmitting(true);
    setSettingsActionError("");
    try {
      await createReconciliationException(draft);
      await onRefresh(buildSettingsRefreshPlan("reconciliation_exception_created"));
      return true;
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to create reconciliation exception.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResolveReconciliationException(exceptionId) {
    setIsSubmitting(true);
    setSettingsActionError("");
    try {
      await resolveReconciliationException({ exceptionId });
      await onRefresh(buildSettingsRefreshPlan("reconciliation_exception_resolved"));
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to resolve reconciliation exception.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetainLatestErrorDiagnostics() {
    setIsSubmitting(true);
    setSettingsActionError("");
    try {
      await retainLatestErrorDiagnostics(50);
      await onRefresh(buildSettingsRefreshPlan("error_diagnostics_retained"));
    } catch (error) {
      setSettingsActionError(error instanceof Error ? error.message : "Failed to clean up error diagnostics.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildTransferReviewUrl(item) {
    const params = new URLSearchParams(searchParams);
    params.set("view", viewId);
    params.set("month", item?.date?.slice(0, 7) || searchParams.get("month") || DEFAULT_MONTH_KEY);
    params.set("entry_type", "transfer");
    params.set("editing_entry", item.entryId);
    return `/entries?${params.toString()}`;
  }

  function openTransferReview(item) {
    const url = buildTransferReviewUrl(item);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function ensureTransferSettlementDraft(entry) {
    setTransferSettlementDrafts((current) => {
      if (current[entry.id]) {
        return current;
      }

      return {
        ...current,
        [entry.id]: {
          currentCategoryName: "Other",
          counterpartCategoryName: "Other"
        }
      };
    });
  }

  function updateTransferSettlementDraft(entryId, patch) {
    setTransferSettlementDrafts((current) => ({
      ...current,
      [entryId]: {
        currentCategoryName: current[entryId]?.currentCategoryName ?? "Other",
        counterpartCategoryName: current[entryId]?.counterpartCategoryName ?? "Other",
        ...patch
      }
    }));
  }

  async function loadTransferManager(entryId, { open = false } = {}) {
    setRefreshingTransferCandidatesEntryId(entryId);
    setTransferCandidatesError("");
    try {
      const response = await fetch(`/api/transfers/candidates?entryId=${encodeURIComponent(entryId)}`, {
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load transfer matches.");
      }
      if (!data.entry) {
        throw new Error("Transfer row no longer exists.");
      }

      setTransferDialogEntry(data.entry);
      setTransferCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      ensureTransferSettlementDraft(data.entry);
      if (open) {
        setTransferDialogEntryId(data.entry.id);
      }
      return data.entry;
    } catch (error) {
      setTransferCandidatesError(error instanceof Error ? error.message : "Failed to load transfer matches.");
      if (open) {
        setTransferDialogEntryId(entryId);
      }
      return null;
    } finally {
      setRefreshingTransferCandidatesEntryId((current) => current === entryId ? null : current);
    }
  }

  async function openTransferManager(entryId) {
    await loadTransferManager(entryId, { open: true });
  }

  async function refreshTransferCandidates(entry) {
    await loadTransferManager(entry.id);
  }

  async function linkTransferCandidate(entry, candidate) {
    const fromEntryId = entry.transferDirection === "in" ? candidate.id : entry.id;
    const toEntryId = entry.transferDirection === "in" ? entry.id : candidate.id;
    setLinkingTransferEntryId(entry.id);
    setSettingsActionError("");

    try {
      const response = await fetch("/api/transfers/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fromEntryId, toEntryId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to link transfer.");
      }

      setTransferDialogEntryId(null);
      setTransferDialogEntry(null);
      setTransferCandidates([]);
      await onRefresh(buildSettingsRefreshPlan("unresolved_transfer_linked"));
    } catch (error) {
      setTransferCandidatesError(error instanceof Error ? error.message : "Failed to link transfer.");
    } finally {
      setLinkingTransferEntryId(null);
    }
  }

  async function settleTransfer(entry) {
    const draft = transferSettlementDrafts[entry.id] ?? {
      currentCategoryName: "Other",
      counterpartCategoryName: "Other"
    };
    setSettlingTransferEntryId(entry.id);
    setSettingsActionError("");

    try {
      const response = await fetch("/api/transfers/settle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entryId: entry.id,
          counterpartEntryId: entry.linkedTransfer?.transactionId,
          currentCategoryName: draft.currentCategoryName,
          counterpartCategoryName: draft.counterpartCategoryName
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to convert transfer.");
      }

      setTransferDialogEntryId(null);
      setTransferDialogEntry(null);
      setTransferCandidates([]);
      await onRefresh(buildSettingsRefreshPlan("unresolved_transfer_settled"));
    } catch (error) {
      setTransferCandidatesError(error instanceof Error ? error.message : "Failed to convert transfer.");
    } finally {
      setSettlingTransferEntryId(null);
    }
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

  function handleGenerateShortcutApiKey() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setShortcutSettingsDraft((current) => ({ ...current, apiKey: `mm_${key}` }));
  }

  function handleMoveShortcutAccount(fromIndex, toIndex) {
    setShortcutSettingsDraft((current) => ({
      ...current,
      defaultAccountPriorityIds: reorderShortcutAccountPriorityIds(
        current.defaultAccountPriorityIds,
        fromIndex,
        toIndex
      )
    }));
  }

  async function handleSaveShortcutSettings() {
    setIsSubmitting(true);
    setShortcutSettingsError("");
    try {
      await saveShortcutSettings(shortcutSettingsDraft);
      await onRefresh(buildSettingsRefreshPlan("shortcut_settings_saved"));
    } catch (error) {
      setShortcutSettingsError(error instanceof Error ? error.message : "Failed to save shortcut settings.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleSettingsSection(sectionKey) {
    setSettingsSectionsOpen((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey]
    }));
  }

  return (
    <article className="panel settings-page">
      {settingsActionError ? <p className="form-error" role="alert">{settingsActionError}</p> : null}
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

      <SettingsShortcutApiSection
        accounts={accounts}
        draft={shortcutSettingsDraft}
        error={shortcutSettingsError}
        isOpen={settingsSectionsOpen.shortcutApi}
        isSubmitting={isSubmitting}
        shortcutSettings={safeSettingsPage.shortcutSettings}
        onApiKeyChange={(apiKey) => setShortcutSettingsDraft((current) => ({ ...current, apiKey }))}
        onDefaultParamsChange={(defaultParams) => setShortcutSettingsDraft((current) => ({ ...current, defaultParams }))}
        onGenerateApiKey={handleGenerateShortcutApiKey}
        onMoveAccount={handleMoveShortcutAccount}
        onToggle={() => toggleSettingsSection("shortcutApi")}
        onSave={handleSaveShortcutSettings}
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
        ignoredIssueIds={safeSettingsPage.ignoredCategoryMatchRuleIssueIds ?? []}
        isOpen={settingsSectionsOpen.categoryRules}
        onToggle={() => toggleSettingsSection("categoryRules")}
        onCreateRule={openCreateCategoryRuleDialog}
        onEditRule={openEditCategoryRuleDialog}
        onDeleteRule={handleDeleteCategoryRule}
        onAcceptSuggestion={handleAcceptCategoryRuleSuggestion}
        onEditSuggestion={openCategoryRuleSuggestionDialog}
        onIgnoreSuggestion={handleIgnoreCategoryRuleSuggestion}
        onIgnoreIssue={handleIgnoreCategoryRuleIssue}
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
        onManageTransfer={openTransferManager}
      />

      {transferDialogEntry ? (
        <EntryTransferTools
          entry={transferDialogEntry}
          categoryOptions={categoryOptions}
          transferCandidates={transferCandidates}
          transferDialogEntryId={transferDialogEntryId}
          transferSettlementDrafts={transferSettlementDrafts}
          linkingTransferEntryId={linkingTransferEntryId}
          settlingTransferEntryId={settlingTransferEntryId}
          refreshingTransferCandidatesEntryId={refreshingTransferCandidatesEntryId}
          transferCandidatesError={transferCandidatesError}
          onEnsureSettlementDraft={ensureTransferSettlementDraft}
          onTransferDialogEntryChange={(next) => {
            const nextValue = typeof next === "function" ? next(transferDialogEntryId) : next;
            setTransferDialogEntryId(nextValue);
            if (!nextValue) {
              setTransferDialogEntry(null);
              setTransferCandidates([]);
              setTransferCandidatesError("");
            }
          }}
          onSettlementDraftChange={updateTransferSettlementDraft}
          onRefreshCandidates={refreshTransferCandidates}
          onLinkCandidate={linkTransferCandidate}
          onSettleTransfer={settleTransfer}
          showLabel={false}
          trigger={(
            <button type="button" hidden aria-hidden="true" tabIndex={-1}>
              {messages.settings.manageTransferReview}
            </button>
          )}
        />
      ) : null}

      <SettingsErrorDiagnosticsSection
        diagnostics={safeSettingsPage.errorDiagnostics ?? []}
        isOpen={settingsSectionsOpen.errorDiagnostics}
        isSubmitting={isSubmitting}
        onToggle={() => toggleSettingsSection("errorDiagnostics")}
        onRetainLatest={handleRetainLatestErrorDiagnostics}
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

      <Dialog.Root open={dismissTransfersConfirmOpen} onOpenChange={(open) => { if (!open && !isSubmitting) setDismissTransfersConfirmOpen(false); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content settings-account-dialog">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>Clear unresolved transfers?</Dialog.Title>
                <Dialog.Description>
                  This hides {safeSettingsPage.unresolvedTransfers.length} unresolved transfer review{safeSettingsPage.unresolvedTransfers.length === 1 ? "" : "s"} from the review list.
                </Dialog.Description>
              </div>
              <Dialog.Close className="dialog-close-button" aria-label="Close confirmation dialog">
                ×
              </Dialog.Close>
            </div>
            <div className="note-dialog-actions">
              <Dialog.Close className="subtle-action" disabled={isSubmitting}>Cancel</Dialog.Close>
              <button type="button" className="dialog-primary" disabled={isSubmitting} onClick={() => void confirmDismissAllUnresolvedTransfers()}>
                {isSubmitting ? messages.common.saving : "Clear transfers"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </article>
  );
}
