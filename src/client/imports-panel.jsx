import { useEffect, useMemo, useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import { commitImportBatch, previewImportBatch, rollbackImportBatch } from "./import-api";
import { ImportRecentHistorySection } from "./import-history";
import { buildRecentImportModel, filterRecentImportsByAccount, getRecentImportAccountOptions } from "./import-history-model";
import { ImportMappingStage } from "./import-mapping-stage";
import { buildImportPreviewModel, hasImportDraft } from "./import-preview-model";
import { ImportPreviewReview } from "./import-preview-review";
import { ImportPreviewRowsTable } from "./import-preview-rows-table";
import { ImportSelectFileStage } from "./import-select-file-stage";
import { SettingsAccountDialog } from "./settings-dialogs";
import { saveSettingsAccount } from "./settings-api";
import {
  buildMappedImportRows,
  buildRawImportRowFromPreviewRow,
  extractPdfText,
  getImportDirectOwnerForAccount,
  inferImportMapping
} from "./import-helpers";
import { inspectCsv } from "../lib/csv";
import {
  formatMinorInput,
  parseDraftMoneyInput
} from "./formatters";
import {
  canParseCitibankActivityCsv,
  canParseOcbcActivityCsv,
  parseCitibankActivityCsv,
  parseCurrentTransactionSpreadsheet,
  parseOcbcActivityCsv,
  parseStatementText,
  statementRowsToCsv
} from "../lib/statement-import";

export function ImportsPanel({ importsPage, viewId, viewLabel, accounts, categories, people, onRefresh }) {
  // Keep import flow state centralized while the UI is being split up: CSV paste,
  // PDF/XLS parsing, preview, checkpoints, and commit all share this payload.
  const [sourceLabel, setSourceLabel] = useState("Imported CSV");
  const [importNote, setImportNote] = useState("");
  const [csvText, setCsvText] = useState("");
  const [defaultAccountName, setDefaultAccountName] = useState(accounts[0]?.name ?? "");
  const [ownershipType, setOwnershipType] = useState("direct");
  const [ownerName, setOwnerName] = useState(people[0]?.name ?? "");
  const [splitPercent, setSplitPercent] = useState("50");
  const [unknownCategoryMode, setUnknownCategoryMode] = useState("other");
  const [columnMappings, setColumnMappings] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState("");
  const [statementCheckpoints, setStatementCheckpoints] = useState([]);
  const [statementImportMeta, setStatementImportMeta] = useState({ sourceType: "csv", parserKey: "generic_csv" });
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
  const fileInputRef = useRef(null);
  const mappingSectionRef = useRef(null);
  const previewSectionRef = useRef(null);
  const hasAutoScrolledMappingRef = useRef(false);
  const hasAutoScrolledPreviewRef = useRef(false);

  const csvInspection = useMemo(() => inspectCsv(csvText), [csvText]);
  const headerSignature = csvInspection.headers.join("|");
  const defaultAccountDirectOwnerName = useMemo(
    () => getImportDirectOwnerForAccount(accounts, people, defaultAccountName, undefined),
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
        next[header] = current[header] ?? inferImportMapping(header);
      }
      return next;
    });
  }, [headerSignature, csvInspection.headers]);

  const mappedFields = useMemo(() => {
    const counts = {};
    for (const value of Object.values(columnMappings)) {
      if (!value || value === "ignore") {
        continue;
      }
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }, [columnMappings]);

  const duplicateMappings = useMemo(
    () => Object.entries(mappedFields).filter(([, count]) => count > 1).map(([field]) => field),
    [mappedFields]
  );

  const mappedRows = useMemo(
    () => buildMappedImportRows(csvInspection.rows, columnMappings),
    [columnMappings, csvInspection.rows]
  );

  const missingRequiredFields = [
    !mappedFields.date ? "date" : null,
    !mappedFields.description ? "description" : null,
    !mappedFields.amount && !mappedFields.expense && !mappedFields.income ? "amount/expense/income" : null
  ].filter(Boolean);
  const readyForMapping = csvInspection.headers.length > 0;
  const readyForPreview = mappedRows.length > 0 && missingRequiredFields.length === 0 && duplicateMappings.length === 0;
  const currentStage = preview ? 3 : readyForMapping ? 2 : 1;
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
  const importDraftExists = hasImportDraft({
    preview,
    previewRows,
    csvText,
    importNote,
    statementCheckpoints,
    uploadStatus,
    previewError,
    sourceLabel
  });
  const recentImportAccountOptions = useMemo(
    () => getRecentImportAccountOptions(importsPage.recentImports, accounts),
    [accounts, importsPage.recentImports]
  );
  const filteredRecentImports = useMemo(
    () => filterRecentImportsByAccount(importsPage.recentImports, recentImportAccountFilter),
    [importsPage.recentImports, recentImportAccountFilter]
  );
  const recentImportModel = useMemo(
    () => buildRecentImportModel(filteredRecentImports, recentImportPage),
    [filteredRecentImports, recentImportPage]
  );
  const {
    detectedPreviewAccountNames,
    duplicateCheckpointAccounts,
    hasBlockingCategoryPolicy,
    hasAlreadyCoveredCheckpointRefresh,
    hasDuplicateCheckpointAccounts,
    hasEmptyStatementCheckpointOnly,
    hasStatementReconciliationMismatch,
    isCommitDisabled,
    commitLabel,
    knownAccountNames,
    previewDuplicateRowCount,
    statementCertificationRowCount,
    skippedPreviewRowCount,
    needsReviewPreviewRowCount,
    showStatementAccountMapping,
    statementReconciliations,
    unknownPreviewAccountNames,
    visibleOverlapImports
  } = importPreviewModel;

  useEffect(() => {
    setRecentImportPage((current) => Math.min(Math.max(current, 1), recentImportModel.pageCount));
  }, [recentImportModel.pageCount]);

  useEffect(() => {
    setRecentImportPage(1);
  }, [recentImportAccountFilter]);

  useEffect(() => {
    if (!readyForMapping) {
      hasAutoScrolledMappingRef.current = false;
      return;
    }
    if (hasAutoScrolledMappingRef.current) {
      return;
    }
    hasAutoScrolledMappingRef.current = true;
    mappingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [readyForMapping]);

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
    setStatementImportMeta({ sourceType: "csv", parserKey: "generic_csv" });
    setUploadStatus(null);
  }

  function handleDefaultAccountChange(nextAccountName) {
    setDefaultAccountName(nextAccountName);
    const nextOwnerName = getImportDirectOwnerForAccount(accounts, people, nextAccountName, undefined);
    if (ownershipType === "direct" && nextOwnerName) {
      setOwnerName(nextOwnerName);
    }
  }

  function resetImportForm() {
    setSourceLabel("Imported CSV");
    setImportNote("");
    setCsvText("");
    setDefaultAccountName(accounts[0]?.name ?? "");
    setOwnershipType("direct");
    setOwnerName(people[0]?.name ?? "");
    setSplitPercent("50");
    setUnknownCategoryMode("other");
    setColumnMappings({});
    setPreview(null);
    setPreviewRows([]);
    setPreviewError("");
    setStatementCheckpoints([]);
    setStatementImportMeta({ sourceType: "csv", parserKey: "generic_csv" });
    setUploadStatus(null);
    setIsParsingStatement(false);
    setIsDragActive(false);
    setDismissedOverlapIds([]);
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
        const text = await extractPdfText(file);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseStatementText(text, file.name);
        const parsedCheckpoints = withDetectedStatementAccounts(parsed.checkpoints);

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints(parsedCheckpoints);
        setStatementImportMeta({ sourceType: "pdf", parserKey: parsed.parserKey });
        setCsvText(statementRowsToCsv(parsed.rows));
        if (parsed.checkpoints[0]?.accountName) {
          setDefaultAccountName(parsed.checkpoints[0].accountName);
        }

        setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
        await previewImportRows({
          rows: parsed.rows,
          nextSourceLabel: parsed.sourceLabel,
          nextDefaultAccountName: parsed.checkpoints[0]?.accountName ?? defaultAccountName,
          nextStatementCheckpoints: parsedCheckpoints
        });
        setUploadStatus({
          tone: "success",
          message: parsed.checkpoints.length > 1
            ? messages.imports.uploadStatementReady(parsed.rows.length, parsed.checkpoints.length)
            : messages.imports.uploadReady(parsed.rows.length)
        });
        return;
      }

      if (/\.xls$/i.test(file.name) || file.type === "application/vnd.ms-excel") {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseCurrentTransactionSpreadsheet(await file.arrayBuffer(), file.name);

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints([]);
        setStatementImportMeta({ sourceType: "csv", parserKey: parsed.parserKey });
        setCsvText(statementRowsToCsv(parsed.rows));
        if (parsed.rows[0]?.account) {
          setDefaultAccountName(parsed.rows[0].account);
        }

        setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
        await previewImportRows({
          rows: parsed.rows,
          nextSourceLabel: parsed.sourceLabel,
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          nextStatementCheckpoints: []
        });
        setUploadStatus({ tone: "success", message: messages.imports.uploadReady(parsed.rows.length) });
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

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints([]);
        setStatementImportMeta({ sourceType: "csv", parserKey: parsed.parserKey });
        setCsvText(statementRowsToCsv(parsed.rows));
        if (parsed.rows[0]?.account) {
          setDefaultAccountName(parsed.rows[0].account);
        }

        setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
        await previewImportRows({
          rows: parsed.rows,
          nextSourceLabel: parsed.sourceLabel,
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          nextStatementCheckpoints: []
        });
        setUploadStatus({ tone: "success", message: messages.imports.uploadReady(parsed.rows.length) });
        return;
      }

      if (/\.csv$/i.test(file.name) && canParseOcbcActivityCsv(file.name, activityContext)) {
        setDismissedOverlapIds([]);
        setUploadStatus({ tone: "active", message: messages.imports.uploadParsing(file.name) });
        const parsed = parseOcbcActivityCsv(nextText, file.name, activityContext);

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints([]);
        setStatementImportMeta({ sourceType: "csv", parserKey: parsed.parserKey });
        setCsvText(statementRowsToCsv(parsed.rows));
        if (parsed.rows[0]?.account) {
          setDefaultAccountName(parsed.rows[0].account);
        }

        setUploadStatus({ tone: "active", message: messages.imports.uploadPreviewing(parsed.rows.length) });
        await previewImportRows({
          rows: parsed.rows,
          nextSourceLabel: parsed.sourceLabel,
          nextDefaultAccountName: parsed.rows[0]?.account ?? defaultAccountName,
          nextStatementCheckpoints: []
        });
        setUploadStatus({ tone: "success", message: messages.imports.uploadReady(parsed.rows.length) });
        return;
      }

      setDismissedOverlapIds([]);
      setCsvText(nextText);
      setStatementCheckpoints([]);
      setStatementImportMeta({ sourceType: "csv", parserKey: "generic_csv" });
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
    } catch (error) {
      setPreview(null);
      setPreviewRows([]);
      throw error;
    }
  }

  async function handlePreview() {
    if (!readyForPreview) {
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
      await onRefresh({ refreshShell: true, broadcast: true });
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
      await onRefresh({ refreshShell: true, broadcast: true });
    } finally {
      setIsSubmitting(false);
    }
  }

  function updatePreviewRow(rowId, patch) {
    const duplicateKeyFields = ["date", "description", "amountMinor", "entryType", "transferDirection", "accountId", "accountName"];
    const shouldClearDuplicateMatches = duplicateKeyFields.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    setPreviewRows((current) => current.map((row) => (
      row.rowId === rowId
        ? {
          ...row,
          ...patch,
          duplicateMatches: shouldClearDuplicateMatches ? undefined : row.duplicateMatches,
          statementCertificationTargetTransactionId: shouldClearDuplicateMatches ? undefined : row.statementCertificationTargetTransactionId,
          commitStatus: shouldClearDuplicateMatches ? "included" : (patch.commitStatus ?? row.commitStatus),
          commitStatusReason: shouldClearDuplicateMatches ? undefined : row.commitStatusReason,
          commitStatusExplicit: shouldClearDuplicateMatches ? false : row.commitStatusExplicit
        }
        : row
    )));
  }

  function updatePreviewRowCommitStatus(rowId, commitStatus) {
    const nextRows = previewRows.map((row) => (
      row.rowId === rowId
        ? {
          ...row,
          commitStatus,
          commitStatusReason: getPreviewCommitStatusReason(commitStatus, row.duplicateMatches?.[0]?.matchKind),
          commitStatusExplicit: true
        }
        : row
    ));
    setPreviewRows(nextRows);
    if (statementCheckpoints.length) {
      setUploadStatus({ tone: "active", message: messages.imports.statementReconciliationRefreshing });
      void previewImportRows({ rows: nextRows.map(buildRawImportRowFromPreviewRow) })
        .then(() => {
          setUploadStatus({ tone: "success", message: messages.imports.statementReconciliationRefreshed });
        })
        .catch((error) => {
          setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
          setUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "Import preview failed." });
        });
    }
  }

  function getPreviewAccountOwnerPatch(accountName, row, accountId) {
    if (row.ownershipType !== "direct") {
      return {};
    }

    const nextOwnerName = getImportDirectOwnerForAccount(accounts, people, accountName, row.ownerName ?? ownerName, accountId);
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
    setUploadStatus({ tone: "active", message: messages.imports.accountMappingRefreshing });
    setIsSubmitting(true);
    void previewImportRows({
      rows: nextRows.map(buildRawImportRowFromPreviewRow),
      nextStatementCheckpoints: nextCheckpoints
    })
      .then(() => {
        setUploadStatus({ tone: "success", message: messages.imports.accountMappingRefreshed });
      })
      .catch((error) => {
        setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
        setUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "Import preview failed." });
      })
      .finally(() => setIsSubmitting(false));
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
    setUploadStatus({ tone: "active", message: messages.imports.accountMappingRefreshing });
    setIsSubmitting(true);
    try {
      await previewImportRows({
        rows: nextRows.map(buildRawImportRowFromPreviewRow),
        nextStatementCheckpoints: nextCheckpoints
      });
      setUploadStatus({ tone: "success", message: messages.imports.accountMappingRefreshed });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
      setUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "Import preview failed." });
    } finally {
      setIsSubmitting(false);
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
      openingBalance: formatMinorInput(openingBalanceMinor),
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
        openingBalanceMinor: parseDraftMoneyInput(accountDialog.openingBalance ?? "0"),
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

    setUploadStatus({ tone: "active", message: messages.imports.statementReconciliationRefreshing });
    setIsSubmitting(true);
    void previewImportRows({ rows: previewRows.map(buildRawImportRowFromPreviewRow) })
      .then(() => {
        setUploadStatus({ tone: "success", message: messages.imports.statementReconciliationRefreshed });
      })
      .catch((error) => {
        setPreviewError(error instanceof Error ? error.message : "Import preview failed.");
        setUploadStatus({ tone: "error", message: error instanceof Error ? error.message : "Import preview failed." });
      })
      .finally(() => setIsSubmitting(false));
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

        <ImportSelectFileStage
          currentStage={currentStage}
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
          rollbackPolicy={importsPage.rollbackPolicy}
        />

        {readyForMapping ? (
          <ImportMappingStage
            mappingSectionRef={mappingSectionRef}
            currentStage={currentStage}
            csvInspection={csvInspection}
            unknownCategoryMode={unknownCategoryMode}
            onUnknownCategoryModeChange={setUnknownCategoryMode}
            missingRequiredFields={missingRequiredFields}
            duplicateMappings={duplicateMappings}
            columnMappings={columnMappings}
            onColumnMappingChange={(header, nextValue) => {
              setColumnMappings((current) => ({ ...current, [header]: nextValue }));
            }}
            isSubmitting={isSubmitting}
            isParsingStatement={isParsingStatement}
            readyForPreview={readyForPreview}
            onPreview={handlePreview}
            previewError={previewError}
          />
        ) : null}

        <div ref={previewSectionRef} className={`import-stage-card ${currentStage === 3 ? "is-current" : ""}`}>
          <div className="import-stage-head">
            <div className="section-head">
              <h3>{messages.imports.previewRows}</h3>
              <span className="panel-context">
                {preview ? messages.imports.transactionCount(preview.importedRows) : messages.imports.previewEmpty}
              </span>
            </div>
            <div className="import-stage-head-actions">
              <span className={`import-stage-label ${currentStage === 3 ? "is-current" : ""}`}>
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
            knownAccountNames={knownAccountNames}
            detectedPreviewAccountNames={detectedPreviewAccountNames}
            unknownPreviewAccountNames={unknownPreviewAccountNames}
            unknownCategoryMode={unknownCategoryMode}
            showStatementAccountMapping={showStatementAccountMapping}
            visibleOverlapImports={visibleOverlapImports}
            previewDuplicateRowCount={previewDuplicateRowCount}
            statementCertificationRowCount={statementCertificationRowCount}
            skippedPreviewRowCount={skippedPreviewRowCount}
            needsReviewPreviewRowCount={needsReviewPreviewRowCount}
            statementReconciliations={statementReconciliations}
            hasStatementReconciliationMismatch={hasStatementReconciliationMismatch}
            statementCheckpoints={statementCheckpoints}
            hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
            duplicateCheckpointAccounts={duplicateCheckpointAccounts}
            isSubmitting={isSubmitting}
            onRemapPreviewAccount={remapPreviewAccount}
            onCreateStatementAccount={openCreateStatementAccountDialog}
            onDismissOverlap={(importId) => setDismissedOverlapIds((current) => [...new Set([...current, importId])])}
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
              statementCertificationRowCount={statementCertificationRowCount}
              hasAlreadyCoveredCheckpointRefresh={hasAlreadyCoveredCheckpointRefresh}
              hasEmptyStatementCheckpointOnly={hasEmptyStatementCheckpointOnly}
              isCommitDisabled={isCommitDisabled}
              isSubmitting={isSubmitting}
              commitLabel={commitLabel}
              onCommit={handleCommit}
              onUpdatePreviewRow={updatePreviewRow}
              onUpdatePreviewRowCommitStatus={updatePreviewRowCommitStatus}
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
    return "Exact duplicate already exists in the ledger.";
  }

  if (commitStatus === "skipped" && matchKind === "probable") {
    return "Probable duplicate already exists in the ledger.";
  }

  if (commitStatus === "skipped") {
    return "Skipped by user before commit.";
  }

  if (commitStatus === "needs_review") {
    return "Possible duplicate needs a user decision before commit.";
  }

  return undefined;
}
