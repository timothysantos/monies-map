import { useEffect, useMemo, useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import { commitImportBatch, previewImportBatch, rollbackImportBatch } from "./import-api";
import { ImportRecentHistorySection } from "./import-history";
import { buildRecentImportModel, filterRecentImportsByAccount, getRecentImportAccountOptions } from "./import-history-model";
import { buildImportWorkflowModel } from "./import-workflow-model";
import { getStatementPreviewAutoRefreshKey, shouldAutoRefreshStatementPreview } from "./import-preview-auto-refresh";
import { ImportMappingStage } from "./import-mapping-stage";
import { buildImportPreviewModel } from "./import-preview-model";
import { ImportPreviewReview } from "./import-preview-review";
import { ImportPreviewRowsTable } from "./import-preview-rows-table";
import { ImportSelectFileStage } from "./import-select-file-stage";
import { moniesClient } from "./monies-client-service";
import { SettingsAccountDialog } from "./settings-dialogs";
import { saveSettingsAccount } from "./settings-api";
import { inspectCsv } from "../lib/csv";
import {
  canParseCitibankActivityCsv,
  canRecognizeOcbcActivityCsv,
  parseCitibankActivityCsv,
  parseCurrentTransactionSpreadsheet,
  parseOcbcActivityCsv,
  parseStatementText,
  statementRowsToCsv
} from "../lib/statement-import";

const DEFAULT_SOURCE_LABEL = "Imported CSV";
const DEFAULT_STATEMENT_IMPORT_META = { sourceType: "csv", parserKey: "generic_csv" };
const DEFAULT_UNKNOWN_CATEGORY_MODE = "other";
const { format: formatService, imports: importService } = moniesClient;

// Read alongside docs/import-summary-code-glossary.md.
// This component is intentionally the import workflow "orchestrator":
// - stage 1 collects source rows and default import ownership/account choices
// - stage 2 maps CSV columns into the app's import schema
// - stage 3 reviews the server-built preview before commit
export function ImportsPanel({ importsPage, viewId, viewLabel, accounts, categories, people, onRefresh }) {
  // Imports can mount while the route payload is still hydrating, so keep a
  // minimal local shape instead of assuming the page slice is already present.
  const safeImportsPage = importsPage ?? {
    recentImports: [],
    rollbackPolicy: ""
  };
  // Draft metadata chosen by the user before preview.
  const [sourceLabel, setSourceLabel] = useState(DEFAULT_SOURCE_LABEL);
  const [importNote, setImportNote] = useState("");
  const [csvText, setCsvText] = useState("");
  const [defaultAccountName, setDefaultAccountName] = useState(accounts[0]?.name ?? "");
  const [ownershipType, setOwnershipType] = useState("direct");
  const [ownerName, setOwnerName] = useState(people[0]?.name ?? "");
  const [splitPercent, setSplitPercent] = useState("50");
  const [unknownCategoryMode, setUnknownCategoryMode] = useState(DEFAULT_UNKNOWN_CATEGORY_MODE);
  const [columnMappings, setColumnMappings] = useState({});

  // Preview payload returned by the server after entry reconciliation, category
  // matching, and account resolution.
  const [preview, setPreview] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState("");
  const [statementCheckpoints, setStatementCheckpoints] = useState([]);
  const [statementImportMeta, setStatementImportMeta] = useState(DEFAULT_STATEMENT_IMPORT_META);

  // UI-only workflow state: upload progress, modal dialogs, and navigation aids.
  const [uploadStatus, setUploadStatus] = useState(null);
  const [isParsingStatement, setIsParsingStatement] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountDialogError, setAccountDialogError] = useState("");
  const [pendingStatementAccountName, setPendingStatementAccountName] = useState("");
  const [recentImportsOpen, setRecentImportsOpen] = useState(true);
  const [recentImportPage, setRecentImportPage] = useState(1);
  const [recentImportAccountFilter, setRecentImportAccountFilter] = useState("");
  const [dismissedOverlapIds, setDismissedOverlapIds] = useState([]);
  const [jumpToSkippedRowsRequestKey, setJumpToSkippedRowsRequestKey] = useState(0);
  const fileInputRef = useRef(null);
  const mappingSectionRef = useRef(null);
  const previewSectionRef = useRef(null);
  const hasAutoScrolledMappingRef = useRef(false);
  const hasAutoScrolledPreviewRef = useRef(false);
  const lastPreviewHydratedAtRef = useRef(0);
  const lastStatementPreviewAutoRefreshRef = useRef({ key: "", at: 0 });
  const lastStatementPreviewSnapshotRef = useRef("");

  const csvInspection = useMemo(() => inspectCsv(csvText), [csvText]);
  const headerSignature = csvInspection.headers.join("|");
  const defaultAccountDirectOwnerName = useMemo(
    () => importService.getDirectOwnerForAccount(accounts, people, defaultAccountName, undefined),
    [accounts, defaultAccountName, people]
  );
  const defaultAccount = useMemo(
    () => accounts.find((account) => account.name === defaultAccountName),
    [accounts, defaultAccountName]
  );

  useEffect(() => {
    if (!defaultAccountName && accounts[0]?.name) {
      setDefaultAccountName(accounts[0].name);
    }
  }, [accounts, defaultAccountName]);

  useEffect(() => {
    if (!ownerName && people[0]?.name) {
      setOwnerName(people[0].name);
    }
  }, [ownerName, people]);

  useEffect(() => {
    if (ownershipType !== "direct" || !defaultAccountDirectOwnerName || ownerName === defaultAccountDirectOwnerName) {
      return;
    }

    setOwnerName(defaultAccountDirectOwnerName);
  }, [defaultAccountDirectOwnerName, ownerName, ownershipType]);

  useEffect(() => {
    if (!people.length) {
      return;
    }

    if (viewId === "household") {
      if (!ownerName) {
        setOwnerName(people[0].name);
      }
      return;
    }

    if (defaultAccountDirectOwnerName) {
      if (ownerName !== defaultAccountDirectOwnerName) {
        setOwnerName(defaultAccountDirectOwnerName);
      }
      return;
    }

    const matchedPerson = people.find((person) => person.id === viewId);
    if (matchedPerson && ownerName !== matchedPerson.name) {
      setOwnerName(matchedPerson.name);
    }
  }, [defaultAccountDirectOwnerName, ownerName, people, viewId]);

  useEffect(() => {
    setColumnMappings((current) => {
      const next = {};
      for (const header of csvInspection.headers) {
        next[header] = current[header] ?? importService.inferMapping(header);
      }
      return next;
    });
  }, [headerSignature, csvInspection.headers]);

  const mappedRows = useMemo(
    () => importService.buildMappedRows(csvInspection.rows, columnMappings),
    [columnMappings, csvInspection.rows]
  );
  const importPreviewModel = useMemo(
    () => buildImportPreviewModel({
      accounts,
      preview,
      previewRows,
      statementCheckpoints,
      statementImportMeta,
      dismissedOverlapIds,
      unknownCategoryMode,
      isSubmitting,
      isParsingStatement
    }),
    [accounts, dismissedOverlapIds, isParsingStatement, isSubmitting, preview, previewRows, statementCheckpoints, statementImportMeta, unknownCategoryMode]
  );
  const currentPreviewSignature = useMemo(
    () => buildStatementPreviewSnapshot(previewRows, statementCheckpoints),
    [previewRows, statementCheckpoints]
  );
  const importWorkflowModel = useMemo(
    () => buildImportWorkflowModel({
      preview,
      previewRows,
      statementCheckpoints,
      mappedRows,
      columnMappings,
      sourceLabel,
      csvText,
      importNote,
      statementImportMeta,
      uploadStatus,
      previewError,
      sourceLabelDefault: DEFAULT_SOURCE_LABEL,
      isSubmitting,
      isParsingStatement,
      currentPreviewSignature,
      hydratedPreviewSignature: lastStatementPreviewSnapshotRef.current
    }),
    [
      currentPreviewSignature,
      csvText,
      importNote,
      isParsingStatement,
      isSubmitting,
      preview,
      previewError,
      previewRows,
      sourceLabel,
      statementCheckpoints,
      statementImportMeta,
      uploadStatus,
      mappedRows,
      columnMappings
    ]
  );
  const importDraftExists = importWorkflowModel.hasDraft;
  const recentImportAccountOptions = useMemo(
    () => getRecentImportAccountOptions(safeImportsPage.recentImports, accounts),
    [accounts, safeImportsPage.recentImports]
  );
  const filteredRecentImports = useMemo(
    () => filterRecentImportsByAccount(safeImportsPage.recentImports, recentImportAccountFilter),
    [recentImportAccountFilter, safeImportsPage.recentImports]
  );
  const recentImportModel = useMemo(
    () => buildRecentImportModel(filteredRecentImports, recentImportPage),
    [filteredRecentImports, recentImportPage]
  );
  const {
    accountMappingAccountNames,
    detectedPreviewAccountNames,
    certifiedConflictRows,
    duplicateCheckpointAccounts,
    hasBlockingCategoryPolicy,
    hasAlreadyCoveredCheckpointRefresh,
    hasDuplicateCheckpointAccounts,
    hasEmptyStatementCheckpointOnly,
    hasStatementReconciliationMismatch,
    isCommitDisabled,
    commitLabel,
    knownAccountNames,
    previewReconciliationRowCount,
    reconciledExistingRowCount,
    skippedPreviewRowCount,
    needsReviewPreviewRowCount,
    showStatementAccountMapping,
    statementReconciliations,
    unknownPreviewAccountNames,
    visibleOverlapImports
  } = importPreviewModel;
  const statementPreviewAutoRefreshKey = useMemo(
    () => getStatementPreviewAutoRefreshKey({
      sourceType: statementImportMeta.sourceType,
      statementCheckpoints,
      previewRows
    }),
    [previewRows, statementCheckpoints, statementImportMeta.sourceType]
  );

  useEffect(() => {
    setRecentImportPage((current) => Math.min(Math.max(current, 1), recentImportModel.pageCount));
  }, [recentImportModel.pageCount]);

  useEffect(() => {
    setRecentImportPage(1);
  }, [recentImportAccountFilter]);

  useEffect(() => {
    if (!importWorkflowModel.readyForMapping) {
      hasAutoScrolledMappingRef.current = false;
      return;
    }
    if (hasAutoScrolledMappingRef.current) {
      return;
    }
    hasAutoScrolledMappingRef.current = true;
    mappingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [importWorkflowModel.readyForMapping]);

  useEffect(() => {
    if (!preview) {
      hasAutoScrolledPreviewRef.current = false;
      return;
    }
    if (hasAutoScrolledPreviewRef.current) {
      return;
    }
    hasAutoScrolledPreviewRef.current = true;
    previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [preview]);

  function handleCsvTextChange(nextText) {
    setCsvText(nextText);
    setStatementCheckpoints([]);
    setStatementImportMeta(DEFAULT_STATEMENT_IMPORT_META);
    setUploadStatus(null);
  }

  function handleDefaultAccountChange(nextAccountName) {
    setDefaultAccountName(nextAccountName);
    const nextOwnerName = importService.getDirectOwnerForAccount(accounts, people, nextAccountName, undefined);
    if (ownershipType === "direct" && nextOwnerName) {
      setOwnerName(nextOwnerName);
    }
  }

  function resetImportForm() {
    setSourceLabel(DEFAULT_SOURCE_LABEL);
    setImportNote("");
    setCsvText("");
    setDefaultAccountName(accounts[0]?.name ?? "");
    setOwnershipType("direct");
    setOwnerName(people[0]?.name ?? "");
    setSplitPercent("50");
    setUnknownCategoryMode(DEFAULT_UNKNOWN_CATEGORY_MODE);
    setColumnMappings({});
    setPreview(null);
    setPreviewRows([]);
    setPreviewError("");
    setStatementCheckpoints([]);
    setStatementImportMeta(DEFAULT_STATEMENT_IMPORT_META);
    setUploadStatus(null);
    setIsParsingStatement(false);
    setIsDragActive(false);
    setDismissedOverlapIds([]);
    setJumpToSkippedRowsRequestKey(0);
    hasAutoScrolledMappingRef.current = false;
    hasAutoScrolledPreviewRef.current = false;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleUploadImportFile(event) {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    await processImportFile(file);
    event.target.value = "";
  }

  async function previewParsedImport({
    parsed,
    sourceType,
    nextStatementCheckpoints,
    nextDefaultAccountName,
    successMessage
  }) {
    setSourceLabel(parsed.sourceLabel);
    setStatementCheckpoints(nextStatementCheckpoints);
    setStatementImportMeta({ sourceType, parserKey: parsed.parserKey });
    setCsvText(statementRowsToCsv(parsed.rows));

    if (nextDefaultAccountName) {
      setDefaultAccountName(nextDefaultAccountName);
    }

    setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
    await previewImportRows({
      rows: parsed.rows,
      nextSourceLabel: parsed.sourceLabel,
      nextDefaultAccountName: nextDefaultAccountName || defaultAccountName,
      nextStatementCheckpoints
    });
    setUploadStatus({ tone: "success", message: successMessage });
  }

  function markPreviewRefreshStarted(message) {
    if (message) {
      setUploadStatus({ tone: "active", message });
    }
    setIsSubmitting(true);
  }

  function refreshPreviewFromRows({
    rows,
    nextStatementCheckpoints = statementCheckpoints,
    activeMessage,
    successMessage,
    silent = false
  }) {
    markPreviewRefreshStarted(silent ? undefined : activeMessage);

    return previewImportRows({
      rows,
      nextStatementCheckpoints
    })
      .then(() => {
        if (!silent && successMessage) {
          setUploadStatus({ tone: "success", message: successMessage });
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Import preview failed.";
        setPreviewError(message);
        setUploadStatus({ tone: "error", message });
      })
      .finally(() => setIsSubmitting(false));
  }

  async function processImportFile(file) {
    setPreviewError("");
    setUploadStatus({ tone: "active", message: messages.imports.uploadReading(file.name) });
    setPreview(null);
    setPreviewRows([]);
    setIsParsingStatement(true);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadExtracting(file.name) });
        const text = await importService.extractPdfText(file);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseStatementText(text, file.name);
        const parsedCheckpoints = withDetectedStatementAccounts(parsed.checkpoints);

        await previewParsedImport({
          parsed,
          sourceType: "pdf",
          nextStatementCheckpoints: parsedCheckpoints,
          nextDefaultAccountName: parsed.checkpoints[0]?.accountName ?? defaultAccountName,
          successMessage: parsed.checkpoints.length > 1
            ? messages.imports.uploadStatementReady(parsed.rows.length, parsed.checkpoints.length)
            : messages.imports.uploadReady(parsed.rows.length)
        });
        return;
      }

      if (/\.xls$/i.test(file.name) || file.type === "application/vnd.ms-excel") {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseCurrentTransactionSpreadsheet(await file.arrayBuffer(), file.name);

        await previewParsedImport({
          parsed,
          sourceType: "csv",
          nextStatementCheckpoints: [],
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          successMessage: messages.imports.uploadReady(parsed.rows.length)
        });
        return;
      }

      const nextText = await file.text();
      const activityContext = {
        accountName: defaultAccount?.name ?? defaultAccountName,
        accountKind: defaultAccount?.kind,
        institution: defaultAccount?.institution
      };
      if (/\.csv$/i.test(file.name) && canParseCitibankActivityCsv(file.name, activityContext)) {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseCitibankActivityCsv(nextText, file.name, activityContext);

        await previewParsedImport({
          parsed,
          sourceType: "csv",
          nextStatementCheckpoints: [],
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          successMessage: messages.imports.uploadReady(parsed.rows.length)
        });
        return;
      }

      if (/\.csv$/i.test(file.name) && canRecognizeOcbcActivityCsv(nextText, file.name, activityContext)) {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseOcbcActivityCsv(nextText, file.name, activityContext);

        await previewParsedImport({
          parsed,
          sourceType: "csv",
          nextStatementCheckpoints: [],
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          successMessage: messages.imports.uploadReady(parsed.rows.length)
        });
        return;
      }

      setDismissedOverlapIds([]);
      setCsvText(nextText);
      setStatementCheckpoints([]);
      setStatementImportMeta(DEFAULT_STATEMENT_IMPORT_META);
      setUploadStatus({ tone: "success", message: messages.imports.uploadCsvReady(file.name) });
    } catch (error) {
      setPreview(null);
      setPreviewRows([]);
      const message = error instanceof Error ? error.message : "Statement import failed.";
      setPreviewError(message);
      setUploadStatus({ tone: "error", message });
    } finally {
      setIsParsingStatement(false);
    }
  }

  async function previewImportRows({
    rows,
    nextSourceLabel = sourceLabel,
    nextDefaultAccountName = defaultAccountName,
    nextStatementCheckpoints = statementCheckpoints
  }) {
    // All source formats eventually converge here so the server only has one
    // preview path to reason about.
    setPreviewError("");
    try {
      const data = await previewImportBatch({
        sourceLabel: nextSourceLabel,
        sourceType: statementImportMeta.sourceType,
        rows,
        defaultAccountName: nextDefaultAccountName,
        ownershipType,
        ownerName,
        splitPercent,
        statementCheckpoints: nextStatementCheckpoints
      });
      setDismissedOverlapIds((current) => current.filter((id) => data.preview?.overlapImports?.some((item) => item.id === id)));
      setPreview(data.preview);
      setPreviewRows(data.preview?.previewRows ?? []);
      lastPreviewHydratedAtRef.current = Date.now();
      lastStatementPreviewSnapshotRef.current = buildStatementPreviewSnapshot(
        data.preview?.previewRows ?? [],
        nextStatementCheckpoints
      );
    } catch (error) {
      setPreview(null);
      setPreviewRows([]);
      throw error;
    }
  }

  useEffect(() => {
    function handleStatementPreviewAutoRefresh() {
      const now = Date.now();
      if (!shouldAutoRefreshStatementPreview({
        hasPreview: importWorkflowModel.hasReviewablePreview,
        autoRefreshKey: statementPreviewAutoRefreshKey,
        isWorkflowLocked: importWorkflowModel.isWorkflowLocked,
        isSubmitting,
        isParsingStatement,
        isDocumentVisible: typeof document === "undefined" || document.visibilityState === "visible",
        now,
        lastPreviewHydratedAt: lastPreviewHydratedAtRef.current,
        lastAutoRefreshAt: lastStatementPreviewAutoRefreshRef.current.at,
        lastAutoRefreshKey: lastStatementPreviewAutoRefreshRef.current.key
      })) {
        return;
      }

      // Statement previews can stay open while the local backend or account
      // metadata changes underneath them. Re-run the current draft when the tab
      // comes back into view so stale mismatch badges do not linger.
      lastStatementPreviewAutoRefreshRef.current = {
        key: statementPreviewAutoRefreshKey,
        at: now
      };
      void refreshPreviewFromRows({
        rows: previewRows.map(importService.buildRawRowFromPreviewRow),
        silent: true
      });
    }

    window.addEventListener("focus", handleStatementPreviewAutoRefresh);
    document.addEventListener("visibilitychange", handleStatementPreviewAutoRefresh);
    return () => {
      window.removeEventListener("focus", handleStatementPreviewAutoRefresh);
      document.removeEventListener("visibilitychange", handleStatementPreviewAutoRefresh);
    };
  }, [
    importWorkflowModel.hasReviewablePreview,
    importWorkflowModel.isWorkflowLocked,
    isParsingStatement,
    isSubmitting,
    previewRows,
    statementPreviewAutoRefreshKey
  ]);

  async function handlePreview() {
    if (!importWorkflowModel.readyForPreview) {
      return;
    }

    setIsSubmitting(true);
    try {
      await previewImportRows({ rows: mappedRows });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDropImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    const [file] = event.dataTransfer.files ?? [];
    if (file) {
      void processImportFile(file);
    }
  }

  function handleDragOverImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  }

  function handleDragLeaveImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }

  async function handleCommit() {
    // `needs_review` and `skipped` rows stay out of the commit payload. They
    // still matter during preview because they affect statement reconciliation.
    const rowsToCommit = previewRows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review");
    if (!rowsToCommit.length && !statementCheckpoints.length) {
      return;
    }

    setIsSubmitting(true);
    try {
      await commitImportBatch({
        sourceLabel: preview?.sourceLabel ?? sourceLabel,
        sourceType: statementImportMeta.sourceType,
        parserKey: statementImportMeta.parserKey,
        note: importNote,
        statementCheckpoints,
        statementControlRows: statementImportMeta.sourceType === "pdf" ? previewRows : undefined,
        statementReconciliations: statementImportMeta.sourceType === "pdf" ? statementReconciliations : undefined,
        rows: rowsToCommit
      });
      resetImportForm();
      await onRefresh({ broadcast: true, invalidateImports: true });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : messages.imports.commitFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRollback(importId) {
    setIsSubmitting(true);
    try {
      await rollbackImportBatch(importId);
      await onRefresh({ broadcast: true, invalidateImports: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  function updatePreviewRow(rowId, patch) {
    // Edits to reconciliation-sensitive fields invalidate prior match decisions, so
    // the row goes back to a neutral "included until re-previewed" state.
    const reconciliationKeyFields = ["date", "description", "amountMinor", "entryType", "transferDirection", "accountId", "accountName"];
    const shouldClearReconciliationMatches = reconciliationKeyFields.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    setPreviewRows((current) => current.map((row) => (
      row.rowId === rowId
        ? {
          ...row,
          ...patch,
          reconciliationMatches: shouldClearReconciliationMatches ? undefined : row.reconciliationMatches,
          reconciliationMatch: shouldClearReconciliationMatches ? undefined : row.reconciliationMatch,
          reconciliationMatchCount: shouldClearReconciliationMatches ? undefined : row.reconciliationMatchCount,
          reconciliationTargetTransactionId: shouldClearReconciliationMatches ? undefined : row.reconciliationTargetTransactionId,
          commitStatus: shouldClearReconciliationMatches ? "included" : (patch.commitStatus ?? row.commitStatus),
          commitStatusReason: shouldClearReconciliationMatches ? undefined : row.commitStatusReason,
          commitStatusExplicit: shouldClearReconciliationMatches ? false : row.commitStatusExplicit
        }
        : row
    )));
  }

  function updatePreviewRowAccount(rowId, patch) {
    let nextRows = [];
    setPreviewRows((current) => {
      nextRows = current.map((row) => (
        row.rowId === rowId
          ? {
            ...row,
            ...patch,
            reconciliationMatches: undefined,
            reconciliationMatch: undefined,
            reconciliationMatchCount: undefined,
            reconciliationTargetTransactionId: undefined,
            commitStatus: "included",
            commitStatusReason: undefined,
            commitStatusExplicit: false
          }
          : row
      ));
      return nextRows;
    });

    // Account changes alter the backend candidate set, so a local clear is not
    // enough. Re-run preview immediately to avoid leaving stale near-match
    // badges on rows that should disappear after remapping.
    void refreshPreviewFromRows({
      rows: nextRows.map(importService.buildRawRowFromPreviewRow),
      activeMessage: messages.imports.accountMappingRefreshing,
      successMessage: messages.imports.accountMappingRefreshed
    });
  }

  function updatePreviewRowCommitStatus(rowId, commitStatus) {
    const nextRows = previewRows.map((row) => (
      row.rowId === rowId
        ? {
          ...row,
          commitStatus,
          reconciliationTargetTransactionId: commitStatus === "included" ? row.reconciliationTargetTransactionId : undefined,
          commitStatusReason: getPreviewCommitStatusReason(commitStatus, row.reconciliationMatches?.[0]?.matchKind ?? row.reconciliationMatch?.matchKind),
          isCertifiedConflict: commitStatus === "included" ? false : row.isCertifiedConflict,
          isStatementMatchResolved: false,
          commitStatusExplicit: true
        }
        : row
    ));
    setPreviewRows(nextRows);
    if (statementCheckpoints.length) {
      void refreshPreviewFromRows({
        rows: nextRows.map(importService.buildRawRowFromPreviewRow),
        activeMessage: messages.imports.statementReconciliationRefreshing,
        successMessage: messages.imports.statementReconciliationRefreshed
      });
    }
  }

  function promotePreviewRowReconciliationTarget(rowId, targetTransactionId) {
    const nextRows = previewRows.map((row) => (
      row.rowId === rowId
        ? {
          ...row,
          reconciliationTargetTransactionId: targetTransactionId,
          commitStatus: "included",
          commitStatusReason: "This import will promote the selected existing ledger row instead of creating a new one.",
          commitStatusExplicit: true
        }
        : row
    ));
    setPreviewRows(nextRows);
    if (statementCheckpoints.length) {
      void refreshPreviewFromRows({
        rows: nextRows.map(importService.buildRawRowFromPreviewRow),
        activeMessage: messages.imports.statementReconciliationRefreshing,
        successMessage: messages.imports.statementReconciliationRefreshed
      });
    }
  }

  function getPreviewAccountOwnerPatch(accountName, row, accountId) {
    // Direct-account imports carry a single owner. Joint/shared imports keep
    // their existing ownership semantics and do not auto-rewrite owner names.
    if (row.ownershipType !== "direct") {
      return {};
    }

    const nextOwnerName = importService.getDirectOwnerForAccount(accounts, people, accountName, row.ownerName ?? ownerName, accountId);
    return nextOwnerName ? { ownerName: nextOwnerName } : {};
  }

  function updateStatementCheckpoint(index, patch) {
    setStatementCheckpoints((current) => current.map((checkpoint, checkpointIndex) => (
      checkpointIndex === index ? { ...checkpoint, ...patch } : checkpoint
    )));
  }

  function remapPreviewAccount(fromAccountName, toAccountId) {
    if (!toAccountId) {
      return;
    }

    const nextAccount = accounts.find((account) => account.id === toAccountId);
    if (!nextAccount) {
      return;
    }

    // Statement account labels are parser hints. This remap replaces that hint
    // with a real app account across both preview rows and checkpoints.
    const nextRows = previewRows.map((row) => (
      getPreviewRowStatementAccountName(row) === fromAccountName
        ? {
          ...row,
          statementAccountName: fromAccountName,
          accountId: nextAccount.id,
          accountName: nextAccount.name,
          ...getPreviewAccountOwnerPatch(nextAccount.name, row, nextAccount.id)
        }
        : row
    ));
    const nextCheckpoints = statementCheckpoints.map((checkpoint) => (
      getCheckpointDetectedAccountName(checkpoint) === fromAccountName
        ? { ...checkpoint, detectedAccountName: fromAccountName, accountId: nextAccount.id, accountName: nextAccount.name }
        : checkpoint
    ));
    setPreviewRows(nextRows);
    setStatementCheckpoints(nextCheckpoints);
    void refreshPreviewFromRows({
      rows: nextRows.map(importService.buildRawRowFromPreviewRow),
      nextStatementCheckpoints: nextCheckpoints,
      activeMessage: messages.imports.accountMappingRefreshing,
      successMessage: messages.imports.accountMappingRefreshed
    });
  }

  async function applyStatementAccountMapping(fromAccountName, nextAccount) {
    const nextRows = previewRows.map((row) => (
      getPreviewRowStatementAccountName(row) === fromAccountName
        ? {
          ...row,
          statementAccountName: fromAccountName,
          accountId: nextAccount.id,
          accountName: nextAccount.name,
          ...getCreatedAccountOwnerPatch(nextAccount, row)
        }
        : row
    ));
    const nextCheckpoints = statementCheckpoints.map((checkpoint) => (
      getCheckpointDetectedAccountName(checkpoint) === fromAccountName
        ? { ...checkpoint, detectedAccountName: fromAccountName, accountId: nextAccount.id, accountName: nextAccount.name }
        : checkpoint
    ));

    setPreviewRows(nextRows);
    setStatementCheckpoints(nextCheckpoints);
    try {
      await refreshPreviewFromRows({
        rows: nextRows.map(importService.buildRawRowFromPreviewRow),
        nextStatementCheckpoints: nextCheckpoints,
        activeMessage: messages.imports.accountMappingRefreshing,
        successMessage: messages.imports.accountMappingRefreshed
      });
    } catch {
      // refreshPreviewFromRows already translated the failure into UI state.
    }
  }

  function openCreateStatementAccountDialog(statementAccountName) {
    const checkpoint = statementCheckpoints.find((item) => getCheckpointDetectedAccountName(item) === statementAccountName);
    const kind = inferStatementAccountKind(statementAccountName, statementImportMeta.parserKey);
    const openingBalanceMinor = inferOpeningBalanceInputMinor({
      checkpoint,
      kind,
      previewRows: previewRows.filter((row) => getPreviewRowStatementAccountName(row) === statementAccountName)
    });

    setPendingStatementAccountName(statementAccountName);
    setAccountDialogError("");
    setAccountDialog({
      mode: "create",
      accountId: "",
      name: checkpoint?.accountName || statementAccountName,
      institution: inferStatementInstitution(statementAccountName, statementImportMeta.parserKey),
      kind,
      currency: "SGD",
      openingBalance: formatService.formatMinorInput(openingBalanceMinor),
      ownerPersonId: viewId === "household" ? "" : viewId,
      isJoint: viewId === "household"
    });
  }

  function getCreatedAccountOwnerPatch(account, row) {
    if (row.ownershipType !== "direct") {
      return {};
    }
    if (account.isJoint) {
      return {};
    }

    const owner = people.find((person) => person.id === account.ownerPersonId);
    return owner ? { ownerName: owner.name } : {};
  }

  async function handleSaveStatementAccount() {
    if (!accountDialog || !pendingStatementAccountName) {
      return;
    }

    setIsSubmitting(true);
    setAccountDialogError("");
    try {
      const data = await saveSettingsAccount({
        mode: "create",
        accountId: "",
        name: accountDialog.name,
        institution: accountDialog.institution,
        kind: accountDialog.kind,
        currency: accountDialog.currency,
        openingBalanceMinor: formatService.parseDraftMoneyInput(accountDialog.openingBalance ?? "0"),
        ownerPersonId: accountDialog.ownerPersonId,
        isJoint: accountDialog.isJoint
      });
      const createdAccount = {
        id: data.accountId,
        name: accountDialog.name.trim(),
        institution: accountDialog.institution.trim(),
        kind: accountDialog.kind,
        currency: accountDialog.currency,
        ownerPersonId: accountDialog.isJoint ? "" : accountDialog.ownerPersonId,
        isJoint: accountDialog.isJoint
      };
      const detectedAccountName = pendingStatementAccountName;
      await onRefresh({ refreshShell: true });
      await applyStatementAccountMapping(detectedAccountName, createdAccount);
      setUploadStatus({ tone: "success", message: messages.imports.accountCreatedFromStatement(createdAccount.name) });
      setAccountDialog(null);
      setPendingStatementAccountName("");
    } catch (error) {
      setAccountDialogError(error instanceof Error ? error.message : "Account save failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleRefreshStatementReconciliation() {
    if (!previewRows.length) {
      return;
    }

    void refreshPreviewFromRows({
      rows: previewRows.map(importService.buildRawRowFromPreviewRow),
      activeMessage: messages.imports.statementReconciliationRefreshing,
      successMessage: messages.imports.statementReconciliationRefreshed
    });
  }

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.imports}</h2>
          <span className="panel-context">{messages.imports.viewing(viewLabel)}</span>
        </div>
      </div>
      <section className="panel-subsection import-workflow">
        <div className="import-header">
          <div>
            <h3>{messages.imports.composerTitle}</h3>
            <p className="lede compact">{messages.imports.composerDetail}</p>
          </div>
          {importDraftExists ? (
            <button type="button" className="subtle-action" onClick={resetImportForm} disabled={isSubmitting}>
              {messages.imports.startOver}
            </button>
          ) : null}
        </div>

        {/* Stage 1: get raw source rows into the draft. */}
        <ImportSelectFileStage
          currentStage={importWorkflowModel.currentStage}
          sourceLabel={sourceLabel}
          onSourceLabelChange={setSourceLabel}
          defaultAccountName={defaultAccountName}
          onDefaultAccountChange={handleDefaultAccountChange}
          accounts={accounts}
          ownershipType={ownershipType}
          onOwnershipTypeChange={setOwnershipType}
          ownerName={ownerName}
          onOwnerNameChange={setOwnerName}
          people={people}
          splitPercent={splitPercent}
          onSplitPercentChange={setSplitPercent}
          importNote={importNote}
          onImportNoteChange={setImportNote}
          csvText={csvText}
          onCsvTextChange={handleCsvTextChange}
          fileInputRef={fileInputRef}
          onUploadImportFile={handleUploadImportFile}
          isDragActive={isDragActive}
          isParsingStatement={isParsingStatement}
          onDragOverImportFile={handleDragOverImportFile}
          onDragLeaveImportFile={handleDragLeaveImportFile}
          onDropImportFile={handleDropImportFile}
          uploadStatus={uploadStatus}
          rollbackPolicy={safeImportsPage.rollbackPolicy}
        />

        {/* Stage 2: map source columns into the app's import schema. */}
        {importWorkflowModel.readyForMapping ? (
          <ImportMappingStage
            mappingSectionRef={mappingSectionRef}
            currentStage={importWorkflowModel.currentStage}
            csvInspection={csvInspection}
            unknownCategoryMode={unknownCategoryMode}
            onUnknownCategoryModeChange={setUnknownCategoryMode}
            missingRequiredFields={importWorkflowModel.missingRequiredFields}
            duplicateMappings={importWorkflowModel.duplicateMappings}
            columnMappings={columnMappings}
            onColumnMappingChange={(header, nextValue) => {
              setColumnMappings((current) => ({ ...current, [header]: nextValue }));
            }}
            isSubmitting={isSubmitting}
            isParsingStatement={isParsingStatement}
            readyForPreview={importWorkflowModel.readyForPreview}
            onPreview={handlePreview}
            previewError={previewError}
          />
        ) : null}

        {/* Stage 3: review the normalized preview and commit only safe rows. */}
        <div ref={previewSectionRef} className={`import-stage-card ${importWorkflowModel.currentStage === 3 ? "is-current" : ""}`}>
          <div className="import-stage-head">
            <div className="section-head">
              <h3>{messages.imports.previewRows}</h3>
              <span className="panel-context">
                {preview ? messages.imports.transactionCount(preview.importedRows) : messages.imports.previewEmpty}
              </span>
            </div>
            <div className="import-stage-head-actions">
              <span className={`import-stage-label ${importWorkflowModel.currentStage === 3 ? "is-current" : ""}`}>
                {messages.imports.steps[2]}
              </span>
              {preview ? (
                <button
                  type="button"
                  className="subtle-action"
                  onClick={resetImportForm}
                >
                  {messages.imports.startOver}
                </button>
              ) : null}
            </div>
          </div>
          {preview ? <p className="import-stage-note">{messages.imports.previewReady}</p> : null}
          {previewRows.length > 100 ? (
            <p className="import-stage-note">{messages.imports.largeImportNotice(previewRows.length)}</p>
          ) : null}

          <ImportPreviewReview
            preview={preview}
            previewRows={previewRows}
            accounts={accounts}
            accountMappingAccountNames={accountMappingAccountNames}
            knownAccountNames={knownAccountNames}
            detectedPreviewAccountNames={detectedPreviewAccountNames}
            unknownPreviewAccountNames={unknownPreviewAccountNames}
            unknownCategoryMode={unknownCategoryMode}
            showStatementAccountMapping={showStatementAccountMapping}
            visibleOverlapImports={visibleOverlapImports}
            previewReconciliationRowCount={previewReconciliationRowCount}
            certifiedConflictRows={certifiedConflictRows}
            reconciledExistingRowCount={reconciledExistingRowCount}
            statementImportSourceType={statementImportMeta.sourceType}
            skippedPreviewRowCount={skippedPreviewRowCount}
            needsReviewPreviewRowCount={needsReviewPreviewRowCount}
            statementReconciliations={statementReconciliations}
            hasStatementReconciliationMismatch={hasStatementReconciliationMismatch}
            statementCheckpoints={statementCheckpoints}
            hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
            duplicateCheckpointAccounts={duplicateCheckpointAccounts}
            isSubmitting={isSubmitting}
            canJumpToSkippedRows={skippedPreviewRowCount > 0}
            onRemapPreviewAccount={remapPreviewAccount}
            onCreateStatementAccount={openCreateStatementAccountDialog}
            onDismissOverlap={(importId) => setDismissedOverlapIds((current) => [...new Set([...current, importId])])}
            onUpdatePreviewRowCommitStatus={updatePreviewRowCommitStatus}
            onJumpToSkippedRows={() => setJumpToSkippedRowsRequestKey((current) => current + 1)}
            onRefreshStatementReconciliation={handleRefreshStatementReconciliation}
            onUpdateStatementCheckpoint={updateStatementCheckpoint}
          />

          {preview ? (
            <ImportPreviewRowsTable
              previewRows={previewRows}
              accounts={accounts}
              categories={categories}
              people={people}
              knownAccountNames={knownAccountNames}
              statementCheckpointCount={statementCheckpoints.length}
              reconciledExistingRowCount={reconciledExistingRowCount}
              statementImportSourceType={statementImportMeta.sourceType}
              hasAlreadyCoveredCheckpointRefresh={hasAlreadyCoveredCheckpointRefresh}
              hasEmptyStatementCheckpointOnly={hasEmptyStatementCheckpointOnly}
              isCommitDisabled={isCommitDisabled}
              isSubmitting={isSubmitting}
              commitLabel={commitLabel}
              jumpToSkippedRowsRequestKey={jumpToSkippedRowsRequestKey}
              onCommit={handleCommit}
              onUpdatePreviewRow={updatePreviewRow}
              onUpdatePreviewRowAccount={updatePreviewRowAccount}
              onUpdatePreviewRowCommitStatus={updatePreviewRowCommitStatus}
              onPromotePreviewRowReconciliationTarget={promotePreviewRowReconciliationTarget}
              getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
            />
          ) : (
            <p className="lede compact">{messages.imports.previewEmpty}</p>
          )}
        </div>
      </section>

      <ImportRecentHistorySection
        recentImports={filteredRecentImports}
        recentImportAccountFilter={recentImportAccountFilter}
        recentImportAccountOptions={recentImportAccountOptions}
        recentImportGroups={recentImportModel.groups}
        recentImportsOpen={recentImportsOpen}
        isRefreshing={isSubmitting}
        recentImportPage={recentImportPage}
        recentImportPageCount={recentImportModel.pageCount}
        recentImportStart={recentImportModel.start}
        recentImportEnd={recentImportModel.end}
        onToggleOpen={() => setRecentImportsOpen((current) => !current)}
        onAccountFilterChange={setRecentImportAccountFilter}
        onPreviousPage={() => setRecentImportPage((current) => Math.max(1, current - 1))}
        onNextPage={() => setRecentImportPage((current) => Math.min(recentImportModel.pageCount, current + 1))}
        onRollback={handleRollback}
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
          setPendingStatementAccountName("");
        }}
        onSave={handleSaveStatementAccount}
      />
    </article>
  );
}

function inferStatementAccountKind(accountName, parserKey) {
  return /credit_card|card/i.test(parserKey) || /card/i.test(accountName)
    ? "credit_card"
    : "bank";
}

function inferStatementInstitution(accountName, parserKey) {
  if (/citibank|citi/i.test(parserKey) || /citi/i.test(accountName)) {
    return "Citibank";
  }
  if (/ocbc/i.test(parserKey) || /ocbc/i.test(accountName)) {
    return "OCBC";
  }
  if (/uob/i.test(parserKey) || /uob/i.test(accountName)) {
    return "UOB";
  }
  return "";
}

function inferOpeningBalanceInputMinor({ checkpoint, kind, previewRows }) {
  if (!checkpoint) {
    return 0;
  }

  const internalStatementBalanceMinor = kind === "credit_card"
    ? -checkpoint.statementBalanceMinor
    : checkpoint.statementBalanceMinor;
  const statementNetMinor = previewRows.reduce((sum, row) => sum + getPreviewRowSignedMinor(row), 0);
  const internalOpeningBalanceMinor = internalStatementBalanceMinor - statementNetMinor;
  return kind === "credit_card" ? -internalOpeningBalanceMinor : internalOpeningBalanceMinor;
}

function getPreviewRowSignedMinor(row) {
  return row.entryType === "income" || (row.entryType === "transfer" && row.transferDirection === "in")
    ? Number(row.amountMinor)
    : -Number(row.amountMinor);
}

function withDetectedStatementAccounts(checkpoints) {
  return checkpoints.map((checkpoint) => ({
    ...checkpoint,
    detectedAccountName: checkpoint.detectedAccountName ?? checkpoint.accountName
  }));
}

function getCheckpointDetectedAccountName(checkpoint) {
  return checkpoint.detectedAccountName ?? checkpoint.accountName;
}

function getPreviewRowStatementAccountName(row) {
  return row.statementAccountName ?? row.rawRow?.statementAccountName ?? row.rawRow?.statementAccount ?? row.rawRow?.account ?? row.accountName;
}

function getPreviewCommitStatusReason(commitStatus, matchKind) {
  if (commitStatus === "skipped" && matchKind === "exact") {
    return "An exact reconciliation match already exists in the ledger.";
  }

  if (commitStatus === "skipped" && matchKind === "probable") {
    return "A probable reconciliation match already exists in the ledger.";
  }

  if (commitStatus === "skipped") {
    return "Skipped by user before commit.";
  }

  if (commitStatus === "needs_review") {
    return "A possible reconciliation match needs a user decision before commit.";
  }

  return undefined;
}

function buildStatementPreviewSnapshot(previewRows, statementCheckpoints) {
  return JSON.stringify({
    checkpoints: statementCheckpoints.map((checkpoint) => ([
      checkpoint.accountId ?? "",
      checkpoint.accountName ?? "",
      checkpoint.detectedAccountName ?? "",
      checkpoint.checkpointMonth ?? "",
      checkpoint.statementStartDate ?? "",
      checkpoint.statementEndDate ?? "",
      Number(checkpoint.statementBalanceMinor ?? 0)
    ])),
    rows: previewRows.map((row) => ([
      row.rowId,
      row.commitStatus,
      row.reconciliationTargetTransactionId ?? "",
      row.accountId ?? "",
      row.accountName ?? "",
      row.statementAccountName ?? "",
      row.date,
      row.description,
      Number(row.amountMinor ?? 0)
    ]))
  });
}
