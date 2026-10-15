// First, so these rules load before the stylesheets the modules below import.
import "./imports-route.css";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { EmptyState } from "./ui-states";
import { commitImportBatch, previewImportBatch, rollbackImportBatch } from "./import-api";
import { ImportRecentHistorySection } from "./import-history";
import { ImportInboxSection, ImportIntakeQueueSection } from "./import-inbox";
import { buildIntakeQueueItem, summarizeIntakeQueue } from "./import-intake-model";
import { buildEarlierImportLines, buildRecentImportModel, filterRecentImportsByAccount, getRecentImportAccountOptions } from "./import-history-model";
import { classifyImportFile } from "./import-file-classifier";
import { buildImportAccountCreationRefreshPlan } from "./import-refresh-plan";
import { buildImportWorkflowModel } from "./import-workflow-model";
import { buildImportBlockers } from "./import-blockers-model";
import { unmaskedMoney } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { initialSplitCleanupState, splitCleanupReducer } from "./import-split-cleanup-model";
import {
  getStatementPreviewAutoRefreshKey,
  shouldAutoRefreshStatementPreview,
  shouldPreserveStatementPreviewOnRefreshError
} from "./import-preview-auto-refresh";
import { ImportMappingStage } from "./import-mapping-stage";
import { buildImportPreviewModel, countRowsToImport, getImportRowsOwnerName } from "./import-preview-model";
import { ImportFileCard } from "./import-file-card";
import { buildStatementTitle, ImportPreviewReview } from "./import-preview-review";
import { ImportPreviewRowsTable } from "./import-preview-rows-table";
import { ImportCommitBar } from "./import-commit-bar";
import { ImportDoneCard, ImportStepper } from "./import-stages";
import { ImportBatchBar, ImportProgressSheet, useImportStickyBar } from "./import-batch-bar";
import {
  buildImportBatchFiles,
  describeCommitLabel,
  describeImportFileLabel,
  describeIntakeItemLabel,
  findNextIntakeItem,
  skipIntakeItem
} from "./import-batch-model";
import { useImportBlockerKeys } from "./import-blocker-keys";
import { jumpToImportTarget, revealAndFocus } from "./import-jump";
import { buildImportDoneSummary, countRemovedByStatement } from "./import-done-model";
import { isInboxOpenByDefault } from "./import-inbox-model";
import { usePageFileDrop } from "./import-page-drop";
import { useFollowingFold } from "./use-following-fold";
import { useMediaQuery } from "./use-viewport";
import {
  getProvenStatementFixes,
  getStatementFixKey,
  readAutomaticStatementFixes,
  writeAutomaticStatementFixes
} from "./statement-fix-preference";
import { ImportSelectFileStage } from "./import-select-file-stage";
import { ImportStatementRecovery } from "./import-statement-recovery";
import { buildInferredAmountKeys, InferredAmountsContext } from "./import-inferred-amounts";
import { buildRecoveryImportRow, buildStatementRecovery } from "./import-statement-recovery-model";
import { moniesClient } from "./monies-client-service";
import { AccountDialog } from "./account-dialog";
import { formatAccountSelectLabel } from "./account-display";
import { saveAccount } from "./accounts-api";
import { inspectCsv } from "../lib/csv";
import {
  parseCitibankActivityCsv,
  parseCurrentTransactionSpreadsheet,
  parseOcbcActivityCsv,
  canRecognizeCitibankActivityCsv,
  parseStatementText,
  statementRowsToCsv
} from "../lib/statement-import";
import { useRouteWorkReport } from "./use-route-work-status";
import { IMPORT_EXPLAIN_MAX_BYTES, fitStatementText, jsonBodyBytes } from "./input-limits";
import { limitsCopy } from "./copy/limits-copy";

const DEFAULT_SOURCE_LABEL = "Imported CSV";
const DEFAULT_STATEMENT_IMPORT_META = { sourceType: "csv", parserKey: "generic_csv" };
const DEFAULT_UNKNOWN_CATEGORY_MODE = "other";
const { format: formatService, imports: importService } = moniesClient;
// Below this width the import bar scrolls away and the commit bar's count
// opens the import progress sheet (import-review.css uses the same 767 px).
const IMPORT_PHONE_QUERY = "(max-width: 767px)";

// Without the shell's refresh notice (isolated renders), a failed refresh
// is dropped.
function runQuietly(task, _retry) {
  return Promise.resolve().then(task).catch(() => null);
}

function buildImportPreviewError(error, fallbackMessage = "Import preview failed.") {
  if (!(error instanceof Error)) {
    return { message: fallbackMessage };
  }

  const requestError = /** @type {Error & { diagnosticHref?: string, diagnosticId?: string }} */ (error);
  return {
    message: requestError.message || fallbackMessage,
    diagnosticHref: requestError.diagnosticHref,
    diagnosticId: requestError.diagnosticId
  };
}

function filterDeletedDiagnosticLedgerRowsFromPreview(preview, deletedLedgerIds) {
  if (!preview || !deletedLedgerIds?.size || !Array.isArray(preview.statementReconciliations)) {
    return preview;
  }

  return {
    ...preview,
    statementReconciliations: preview.statementReconciliations.map((reconciliation) => ({
      ...reconciliation,
      reconciliationBreakdown: filterDeletedDiagnosticRowsFromBreakdown(
        reconciliation.reconciliationBreakdown,
        deletedLedgerIds
      )
    }))
  };
}

function filterDeletedDiagnosticRowsFromBreakdown(breakdown, deletedLedgerIds) {
  if (!breakdown?.periodExistingLedgerRows?.length) {
    return breakdown;
  }

  const periodExistingLedgerRows = breakdown.periodExistingLedgerRows.filter((row) => !deletedLedgerIds.has(row.id));
  if (periodExistingLedgerRows.length === breakdown.periodExistingLedgerRows.length) {
    return breakdown;
  }

  return {
    ...breakdown,
    periodExistingLedgerRows,
    periodExistingLedgerRowCount: periodExistingLedgerRows.length,
    statementPeriodExistingRowsMinor: periodExistingLedgerRows.reduce(
      (totalMinor, row) => totalMinor + Number(row.signedAmountMinor ?? 0),
      0
    )
  };
}

// Read alongside docs/import-summary-code-glossary.md.
// This component is intentionally the import workflow "orchestrator":
// - stage 1 collects source rows and default import ownership/account choices
// - stage 2 maps CSV columns into the app's import schema
// - stage 3 reviews the server-built preview before commit
export function ImportsPanel({ importsPage, viewId, viewLabel, accounts, categories, people, onRefresh, runBackgroundRefresh = runQuietly }) {
  // Imports can mount while the route payload is still hydrating, so keep a
  // minimal local shape instead of assuming the page slice is already present.
  const safeImportsPage = importsPage ?? {
    recentImports: [],
    importInbox: null,
    pendingSplitMatchCount: 0,
    rollbackPolicy: ""
  };
  const navigate = useNavigate();
  const { areTotalsVisible } = useMoneyPrivacy();
  // Draft metadata chosen by the user before preview.
  const [sourceLabel, setSourceLabel] = useState(DEFAULT_SOURCE_LABEL);
  const [importNote, setImportNote] = useState("");
  const [csvText, setCsvText] = useState("");
  const [defaultAccountName, setDefaultAccountName] = useState(accounts[0]?.name ?? "");
  const [ownershipType, setOwnershipType] = useState("direct");
  const [ownerName, setOwnerName] = useState(people[0]?.name ?? "");
  const [unknownCategoryMode, setUnknownCategoryMode] = useState(DEFAULT_UNKNOWN_CATEGORY_MODE);
  const [columnMappings, setColumnMappings] = useState({});

  // Preview payload returned by the server after entry reconciliation, category
  // matching, and account resolution.
  const [preview, setPreview] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewError, setPreviewError] = useState(/** @type {string | { message: string, diagnosticHref?: string, diagnosticId?: string }} */ (""));
  const [aiMismatchExplanations, setAiMismatchExplanations] = useState([]);
  const [isExplainingMismatch, setIsExplainingMismatch] = useState(false);
  const [aiDuplicateScores, setAiDuplicateScores] = useState([]);
  const [isRankingDuplicates, setIsRankingDuplicates] = useState(false);
  const [statementCheckpoints, setStatementCheckpoints] = useState([]);
  const [statementImportMeta, setStatementImportMeta] = useState(DEFAULT_STATEMENT_IMPORT_META);
  const [statementWarnings, setStatementWarnings] = useState([]);
  // Printed totals and evidence for a statement whose readable rows did not
  // add up (ParsedStatementImport.reconciliation); null otherwise.
  const [statementReconciliation, setStatementReconciliation] = useState(null);
  // Amounts OCR could not read, taken from the statement's total; the rows
  // that still carry them are marked for the user to check.
  const [inferredAmounts, setInferredAmounts] = useState([]);
  const inferredAmountKeys = useMemo(() => buildInferredAmountKeys(inferredAmounts), [inferredAmounts]);
  const [allowAiStatementFallback, setAllowAiStatementFallback] = useState(false);

  // UI-only workflow state: upload progress, modal dialogs, and navigation aids.
  const [uploadStatus, setUploadStatus] = useState(null);
  const [isParsingStatement, setIsParsingStatement] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountDialog, setAccountDialog] = useState(null);
  const [accountDialogError, setAccountDialogError] = useState("");
  const [pendingStatementAccountName, setPendingStatementAccountName] = useState("");
  // Recent imports starts closed: it is audit context, not the next step.
  const [recentImportsOpen, setRecentImportsOpen] = useState(false);
  const [recentImportPage, setRecentImportPage] = useState(1);
  const [recentImportAccountFilter, setRecentImportAccountFilter] = useState("");
  const [recentImportStatus, setRecentImportStatus] = useState(null);
  const [isRecentImportsRefreshing, setIsRecentImportsRefreshing] = useState(false);
  const [optimisticRecentImport, setOptimisticRecentImport] = useState(null);
  const [postImportSplitMatchCount, setPostImportSplitMatchCount] = useState(null);
  const [postImportSplitMatchMonth, setPostImportSplitMatchMonth] = useState("");
  const [splitCleanup, dispatchSplitCleanup] = useReducer(splitCleanupReducer, initialSplitCleanupState);
  const splitCleanupCommitCountRef = useRef(0);
  const [dismissedOverlapIds, setDismissedOverlapIds] = useState([]);
  // The suggestions the user chose to keep as they are. The approved fixes
  // themselves live in statementFixesRef and the preview's appliedFixes.
  const [dismissedStatementFindingIds, setDismissedStatementFindingIds] = useState([]);
  const [keepsNoLongerListedEntries, setKeepsNoLongerListedEntries] = useState(false);
  // A statement's rows are read-only in its card sections; this opens the
  // full row editor.
  const [isEditingStatementRows, setIsEditingStatementRows] = useState(false);
  // The queued file in review, what the last commit did (the Done step), and
  // whether Bring files is open while a parsed file is in review.
  const [activeIntakeItemId, setActiveIntakeItemId] = useState(null);
  const [lastCommitSummary, setLastCommitSummary] = useState(null);
  const [isBringFilesOpen, setIsBringFilesOpen] = useState(false);
  // "Fix it for me", and which fixes it already applied in this review (so an
  // Undo is not re-applied on the next refresh).
  const [isAutomaticStatementFixes, setIsAutomaticStatementFixes] = useState(readAutomaticStatementFixes);
  const [autoAppliedStatementFixCount, setAutoAppliedStatementFixCount] = useState(0);
  const autoAppliedStatementFixKeysRef = useRef(new Set());
  const [intakeQueue, setIntakeQueue] = useState([]);
  // This session's batch: the files committed so far (the done file
  // chips), how many changes the file in review has that switching files
  // would drop, and a blocker jump waiting for its section to open.
  const [committedBatchFiles, setCommittedBatchFiles] = useState([]);
  // Whether the user typed the source label (or took one from the inbox).
  const isSourceLabelChosenRef = useRef(false);
  const [reviewChangeCount, setReviewChangeCount] = useState(0);
  const [pendingJumpTarget, setPendingJumpTarget] = useState(null);
  const panelRef = useRef(null);
  const batchBarRef = useRef(null);
  // Moving through the batch: the file a commit opens next (opened once the
  // commit's reset has rendered), the phone's progress sheet and what to do
  // once it has closed, the order of the blocker last jumped to (J and K
  // carry on from it), and the file in review as it was read, so "Skip for
  // now" can queue a file that was not dropped with others.
  const [pendingNextItemId, setPendingNextItemId] = useState(null);
  const [isProgressSheetOpen, setIsProgressSheetOpen] = useState(false);
  const [afterProgressSheet, setAfterProgressSheet] = useState(null);
  const blockerCursorRef = useRef(null);
  const currentImportSourceRef = useRef(null);
  const isPhoneLayout = useMediaQuery(IMPORT_PHONE_QUERY);
  const [jumpToSkippedRowsRequestKey, setJumpToSkippedRowsRequestKey] = useState(0);
  const fileInputRef = useRef(null);
  const mappingSectionRef = useRef(null);
  const previewSectionRef = useRef(null);
  const hasAutoScrolledMappingRef = useRef(false);
  const hasAutoScrolledPreviewRef = useRef(false);
  const lastPreviewHydratedAtRef = useRef(0);
  const lastStatementPreviewAutoRefreshRef = useRef({ key: "", at: 0 });
  const lastStatementPreviewSnapshotRef = useRef("");
  const lastImportActionRef = useRef("");
  const lastAutoPreviewCitibankSignatureRef = useRef("");
  const deletedDiagnosticLedgerIdsRef = useRef(new Set());
  // Mapping several statement account labels can fire back-to-back preview
  // requests. Keep an immediate source of truth for the mapping handlers and
  // ignore any response superseded by a newer preview request.
  const previewRowsRef = useRef(previewRows);
  const statementCheckpointsRef = useRef(statementCheckpoints);
  // Statement fixes the user approved: sent with every preview so the check
  // shows their result; the commit sends the preview's appliedFixes.
  const statementFixesRef = useRef([]);
  const previewRequestSequenceRef = useRef(0);
  const pendingSplitMatchCount = Number(postImportSplitMatchCount ?? safeImportsPage.pendingSplitMatchCount ?? 0);
  const showSplitCleanupNotice = pendingSplitMatchCount > 0 && !splitCleanup.dismissed;
  const intakeQueueSummary = useMemo(() => summarizeIntakeQueue(intakeQueue), [intakeQueue]);

  const csvInspection = useMemo(() => inspectCsv(csvText), [csvText]);
  const headerSignature = csvInspection.headers.join("|");
  const defaultAccount = useMemo(
    () => accounts.find((account) => account.name === defaultAccountName || account.accountName === defaultAccountName),
    [accounts, defaultAccountName]
  );
  const defaultAccountDirectOwnerName = useMemo(
    () => importService.getDirectOwnerForAccount(accounts, people, defaultAccountName, undefined),
    [accounts, defaultAccountName, people]
  );

  function findAccountByName(accountName) {
    return accounts.find((account) => (
      account.name === accountName
      || account.accountName === accountName
      || account.id === accountName
      || account.accountId === accountName
    ));
  }

  function buildActivityContext(context = {}) {
    const account = context.account ?? findAccountByName(context.accountName ?? defaultAccountName) ?? defaultAccount;
    return {
      accountName: context.accountName ?? account?.name ?? account?.accountName ?? defaultAccountName,
      accountKind: context.accountKind ?? account?.kind ?? account?.accountKind,
      institution: context.institution ?? account?.institution ?? account?.institutionName
    };
  }

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
    if (!pendingSplitMatchCount) {
      dispatchSplitCleanup({ type: "noPendingMatches" });
      setPostImportSplitMatchCount(null);
    }
  }, [pendingSplitMatchCount]);

  useEffect(() => {
    setColumnMappings((current) => {
      const next = {};
      for (const header of csvInspection.headers) {
        next[header] = current[header] ?? importService.inferMapping(header);
      }
      return next;
    });
  }, [headerSignature, csvInspection.headers]);

  const importPreviewModel = useMemo(
    () => buildImportPreviewModel({
      accounts,
      preview,
      previewRows,
      statementCheckpoints,
      statementImportMeta,
      dismissedOverlapIds,
      unknownCategoryMode,
      keepsNoLongerListedEntries
    }),
    [accounts, dismissedOverlapIds, keepsNoLongerListedEntries, preview, previewRows, statementCheckpoints, statementImportMeta, unknownCategoryMode]
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
      csvRows: csvInspection.rows,
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
      csvInspection.rows,
      columnMappings
    ]
  );
  const importDraftExists = importWorkflowModel.hasDraft;
  // A plain CSV (no bank parser) needs its columns mapped, and the defaults
  // that fill what its columns do not say. A parsed file needs neither.
  const isMappingNeeded = importWorkflowModel.readyForMapping
    && statementImportMeta.parserKey === DEFAULT_STATEMENT_IMPORT_META.parserKey;
  const [isPasteDefaultsOpen, setIsPasteDefaultsOpen] = useFollowingFold(isMappingNeeded, { followClose: false });
  // A file dropped anywhere on the page goes where the drop zone sends it.
  const isPageDragActive = usePageFileDrop((files) => void processImportFiles(files));
  // Recomputed from the current rows, so it clears only when they add up.
  const statementRecovery = useMemo(
    () => buildStatementRecovery({ reconciliation: statementReconciliation, previewRows }),
    [statementReconciliation, previewRows]
  );
  const hasUnbalancedStatement = Boolean(statementRecovery && !statementRecovery.isBalanced);
  // What blocks a clean commit: the bar's chips, the commit bar's count
  // and the commit rules all read this one list.
  const importBlockers = useMemo(
    () => buildImportBlockers({
      previewModel: preview ? importPreviewModel : null,
      hasPreview: Boolean(preview),
      sourceType: statementImportMeta.sourceType,
      statementCheckpointCount: statementCheckpoints.length,
      unknownCategoryCount: preview?.unknownCategories?.length ?? 0,
      isPreviewDirty: importWorkflowModel.isPreviewDirty,
      isSubmitting,
      isParsingStatement,
      columnMapping: {
        readyForMapping: importWorkflowModel.readyForMapping,
        missingRequiredFields: importWorkflowModel.missingRequiredFields,
        duplicateMappings: importWorkflowModel.duplicateMappings
      },
      hasOcrRecovery: hasUnbalancedStatement,
      areTotalsVisible,
      formatMoney: unmaskedMoney
    }),
    [
      areTotalsVisible,
      hasUnbalancedStatement,
      importPreviewModel,
      importWorkflowModel.duplicateMappings,
      importWorkflowModel.isPreviewDirty,
      importWorkflowModel.missingRequiredFields,
      importWorkflowModel.readyForMapping,
      isParsingStatement,
      isSubmitting,
      preview,
      statementCheckpoints.length,
      statementImportMeta.sourceType
    ]
  );
  const { isCommitDisabled } = importBlockers;
  const commitQuestion = importBlockers.commitQuestion;
  const commitWarning = commitQuestion
    ? {
      message: commitQuestion.message,
      confirmLabel: commitQuestion.confirmLabel,
      onConfirm: commitQuestion.kind === "stale_check"
        ? () => handleRefreshStatementReconciliation()
        : () => handleCommit()
    }
    : undefined;
  // Any import draft, preview edit or write in flight is protected work.
  useRouteWorkReport({
    busy: importDraftExists
      || importWorkflowModel.isWorkflowLocked
      || isParsingStatement
      || isSubmitting
      || isRecentImportsRefreshing
      || isExplainingMismatch
      || isRankingDuplicates
      || Boolean(accountDialog)
      || intakeQueue.length > 0
  });

  useEffect(() => {
    if (!csvText || isSubmitting || isParsingStatement || importWorkflowModel.isWorkflowLocked) {
      return;
    }
    void maybeAutoPreviewCitibankActivityCsv(csvText);
  }, [
    csvText,
    defaultAccountName,
    importWorkflowModel.isWorkflowLocked,
    isParsingStatement,
    isSubmitting,
    ownerName,
    ownershipType
  ]);

  const {
    accountMappingAccountNames,
    detectedPreviewAccountNames,
    certifiedConflictRows,
    duplicateCheckpointAccounts,
    hasAlreadyCoveredCheckpointRefresh,
    hasDuplicateCheckpointAccounts,
    hasEmptyStatementCheckpointOnly,
    hasStatementReconciliationMismatch,
    ledgerMatchedStatement,
    commitKind,
    commitLabel,
    knownAccountNames,
    previewReconciliationRowCount,
    reconciledExistingRowCount,
    skippedPreviewRowCount,
    needsReviewPreviewRowCount,
    showStatementAccountMapping,
    needsStatementAccountMapping,
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
    setRecentImportPage(1);
  }, [recentImportAccountFilter]);

  useEffect(() => {
    previewRowsRef.current = previewRows;
  }, [previewRows]);

  useEffect(() => {
    statementCheckpointsRef.current = statementCheckpoints;
  }, [statementCheckpoints]);

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
    setReviewChangeCount(0);
    setStatementCheckpoints([]);
    setStatementImportMeta(DEFAULT_STATEMENT_IMPORT_META);
    setStatementWarnings([]);
    setStatementReconciliation(null);
    setInferredAmounts([]);
    setAllowAiStatementFallback(false);
    setPreview(null);
    setPreviewRows([]);
    setPreviewError("");
    setUploadStatus(null);
    lastAutoPreviewCitibankSignatureRef.current = "";
    void maybeAutoPreviewCitibankActivityCsv(nextText, {
      ...buildActivityContext(),
      ownerName
    });
  }

  function handleDefaultAccountChange(nextAccountName) {
    setDefaultAccountName(nextAccountName);
    const nextOwnerName = importService.getDirectOwnerForAccount(accounts, people, nextAccountName, undefined);
    if (ownershipType === "direct" && nextOwnerName) {
      setOwnerName(nextOwnerName);
    }
    const nextAccount = findAccountByName(nextAccountName);
    void maybeAutoPreviewCitibankActivityCsv(csvText, {
      ...buildActivityContext({
        account: nextAccount,
        accountName: nextAccount?.name ?? nextAccount?.accountName ?? nextAccountName
      }),
      ownerName: ownershipType === "direct" && nextOwnerName ? nextOwnerName : ownerName
    });
  }

  function handleSourceLabelChange(nextSourceLabel) {
    isSourceLabelChosenRef.current = true;
    setSourceLabel(nextSourceLabel);
  }

  function handleOwnerNameChange(nextOwnerName) {
    setOwnerName(nextOwnerName);
    void maybeAutoPreviewCitibankActivityCsv(csvText, {
      ...buildActivityContext(),
      ownerName: nextOwnerName
    });
  }

  function handleSelectExpectedFile(file) {
    // A statement covering several cards defaults to its first card.
    const accountName = file.coveredAccounts?.[0]?.accountName ?? file.accountName;
    setDefaultAccountName(accountName);
    const nextOwnerName = importService.getDirectOwnerForAccount(accounts, people, accountName, undefined);
    if (ownershipType === "direct" && nextOwnerName) {
      setOwnerName(nextOwnerName);
    }
    setSourceLabel(file.label);
    isSourceLabelChosenRef.current = true;
    setImportNote(file.detail);
    // Show the defaults it just filled.
    setIsPasteDefaultsOpen(true);
    fileInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Opening a file of the batch keeps the last commit's summary (and its
  // rollback) above the new review.
  async function handleLoadIntakeItem(item) {
    setActiveIntakeItemId(item.id);
    setDefaultAccountName(item.parsed?.checkpoints?.[0]?.accountName ?? item.parsed?.rows?.[0]?.accountName ?? defaultAccountName);
    if (item.parsed) {
      await loadParsedImport({
        parsed: item.parsed,
        sourceType: item.sourceType,
        fileName: item.fileName
      }, { keepCommitSummary: true });
    } else {
      await loadParsedImport({
        parsed: null,
        sourceType: item.sourceType,
        csvText: item.csvText,
        fileName: item.fileName
      }, { keepCommitSummary: true });
    }
  }

  function handleRemoveIntakeItem(itemId) {
    setIntakeQueue((current) => current.filter((item) => item.id !== itemId));
    if (itemId === activeIntakeItemId) {
      setActiveIntakeItemId(null);
    }
  }

  function handleClearIntakeQueue() {
    setIntakeQueue([]);
    setActiveIntakeItemId(null);
  }

  function resetImportForm({ preserveRecentImportStatus = false } = {}) {
    setReviewChangeCount(0);
    setIsProgressSheetOpen(false);
    blockerCursorRef.current = null;
    currentImportSourceRef.current = null;
    isSourceLabelChosenRef.current = false;
    setSourceLabel(DEFAULT_SOURCE_LABEL);
    setImportNote("");
    setCsvText("");
    setDefaultAccountName(accounts[0]?.name ?? "");
    setOwnershipType("direct");
    setOwnerName(people[0]?.name ?? "");
    setUnknownCategoryMode(DEFAULT_UNKNOWN_CATEGORY_MODE);
    setColumnMappings({});
    setPreview(null);
    setPreviewRows([]);
    setPreviewError("");
    setStatementCheckpoints([]);
    setStatementImportMeta(DEFAULT_STATEMENT_IMPORT_META);
    setStatementWarnings([]);
    setStatementReconciliation(null);
    setInferredAmounts([]);
    setUploadStatus(null);
    setIsParsingStatement(false);
    setIsDragActive(false);
    setDismissedOverlapIds([]);
    clearStatementFixes();
    // The rest of a multi-file drop stays queued; only the file in review is
    // let go.
    setActiveIntakeItemId(null);
    setLastCommitSummary(null);
    setIsBringFilesOpen(false);
    setIsPasteDefaultsOpen(false);
    setJumpToSkippedRowsRequestKey(0);
    deletedDiagnosticLedgerIdsRef.current = new Set();
    if (!preserveRecentImportStatus) {
      setRecentImportStatus(null);
    }
    hasAutoScrolledMappingRef.current = false;
    hasAutoScrolledPreviewRef.current = false;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleUploadImportFile(event) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    await processImportFiles(files);
    event.target.value = "";
  }

  async function previewParsedImport({
    parsed,
    sourceType,
    nextStatementCheckpoints,
    successMessage,
    keepCommitSummary = false
  }) {
    setSourceLabel(parsed.sourceLabel);
    clearStatementFixes();
    if (!keepCommitSummary) {
      setLastCommitSummary(null);
    }
    setIsBringFilesOpen(false);
    setStatementCheckpoints(nextStatementCheckpoints);
    statementCheckpointsRef.current = nextStatementCheckpoints;
    setStatementImportMeta({ sourceType, parserKey: parsed.parserKey });
    setStatementWarnings(parsed.warnings ?? []);
    setStatementReconciliation(parsed.reconciliation ?? null);
    setInferredAmounts(parsed.ocrReview?.inferredAmounts ?? []);
    setCsvText(statementRowsToCsv(parsed.rows));

    setUploadStatus({ tone: "active", message: importMessages.uploadPreviewing(parsed.rows.length) });
    await previewImportRows({
      rows: parsed.rows,
      nextSourceLabel: parsed.sourceLabel,
      nextSourceType: sourceType,
      nextStatementCheckpoints
    });
    setUploadStatus({ tone: "success", message: successMessage });
  }

  // Adds a statement row the user confirmed against the PDF. The recovery
  // check then re-reads the refreshed rows; nothing is unblocked here.
  function handleAddRecoveryRow(candidate, amountMinor) {
    const row = buildRecoveryImportRow(candidate, amountMinor);
    return refreshPreviewFromRows({
      rows: [...previewRowsRef.current.map(importService.buildRawRowFromPreviewRow), row],
      activeMessage: importMessages.statementRecoveryAdding,
      successMessage: importMessages.statementRecoveryAdded
    });
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
    nextStatementFixes = statementFixesRef.current,
    nextSourceType = statementImportMeta.sourceType,
    activeMessage,
    successMessage,
    silent = false,
    isAutoRefresh = false
  }) {
    markPreviewRefreshStarted(silent ? undefined : activeMessage);

    return previewImportRows({
      rows,
      nextSourceType,
      nextStatementCheckpoints,
      nextStatementFixes,
      preservePreviewOnError: shouldPreserveStatementPreviewOnRefreshError({
        isAutoRefresh,
        hasPreview: Boolean(preview)
      })
    })
      .then(() => {
        if (!silent && successMessage) {
          setUploadStatus({ tone: "success", message: successMessage });
        }
      })
      .catch((error) => {
        const previewErrorDetail = buildImportPreviewError(error);
        setPreviewError(previewErrorDetail);
        setUploadStatus({
          tone: "error",
          message: silent
            ? `Could not refresh the statement check. Keeping the current preview. ${previewErrorDetail.message}`
            : previewErrorDetail.message
        });
      })
      .finally(() => setIsSubmitting(false));
  }

  async function processImportFiles(files) {
    startBatchIfIdle();
    if (files.length === 1) {
      await processImportFile(files[0]);
      return;
    }

    setPreviewError("");
    setUploadStatus({ tone: "active", message: importMessages.intakeParsing(files.length) });
    setIsParsingStatement(true);
    const nextItems = [];
    const existingFingerprints = new Set(intakeQueue.map((item) => item.fingerprint));
    try {
      for (const file of files) {
        const parsedImport = await parseImportFileForIntake(file);
        const item = buildIntakeQueueItem({
          id: `${Date.now()}-${nextItems.length}-${file.name}`,
          fileName: file.name,
          parsed: parsedImport.parsed,
          sourceType: parsedImport.sourceType,
          csvText: parsedImport.csvText,
          inbox: safeImportsPage.importInbox,
          existingFingerprints
        });
        existingFingerprints.add(item.fingerprint);
        nextItems.push(item);
      }
      setIntakeQueue((current) => [...current, ...nextItems]);
      // Queued, not done: they wait for review.
      setUploadStatus({ tone: "waiting", message: importMessages.intakeReady(nextItems.length) });
    } catch (error) {
      const previewErrorDetail = buildImportPreviewError(error, importMessages.intakeFailed);
      setPreviewError(previewErrorDetail);
      setUploadStatus({ tone: "error", message: previewErrorDetail.message });
    } finally {
      setIsParsingStatement(false);
    }
  }

  async function processImportFile(file) {
    startBatchIfIdle();
    // The dropped file is now the one in review; a queued file that was open
    // waits in the queue again.
    setActiveIntakeItemId(null);
    setPreviewError("");
    setUploadStatus({ tone: "active", message: importMessages.uploadReading(file.name) });
    setPreview(null);
    setPreviewRows([]);
    setStatementReconciliation(null);
    setInferredAmounts([]);
    setIsParsingStatement(true);
    try {
      const parsedImport = await parseImportFileForIntake(file);
      // A parsed statement does not carry its file's name; the Done card
      // and the commit notice name it.
      await loadParsedImport({ ...parsedImport, fileName: parsedImport.fileName ?? file.name });
    } catch (error) {
      setPreview(null);
      setPreviewRows([]);
      const previewErrorDetail = buildImportPreviewError(error, "Statement import failed.");
      setPreviewError(previewErrorDetail);
      setUploadStatus({ tone: "error", message: previewErrorDetail.message });
    } finally {
      setIsParsingStatement(false);
    }
  }

  async function parseImportFileForIntake(file) {
    const activityContext = buildActivityContext();
    const fileKind = classifyImportFile({
      fileName: file.name,
      fileType: file.type,
      text: "",
      activityContext
    });

    if (fileKind === "ocr-statement") {
      setUploadStatus({ tone: "active", message: importMessages.uploadParsing(file.name) });
      const parsed = parseStatementText(await file.text(), file.name);
      return { parsed: { ...parsed, checkpoints: withDetectedStatementAccounts(parsed.checkpoints) }, sourceType: "pdf" };
    }

    if (fileKind === "pdf") {
      setUploadStatus({ tone: "active", message: importMessages.uploadExtracting(file.name) });
      const text = await importService.extractPdfText(file);
      setUploadStatus({ tone: "active", message: importMessages.uploadParsing(file.name) });
      let parsed;
      try {
        parsed = parseStatementText(text, file.name);
      } catch (error) {
        if (!importService.isExtractedPdfTextEmpty?.(text)) {
          parsed = await tryAiStatementTextFallback(text, file.name, error);
          return { parsed: { ...parsed, checkpoints: withDetectedStatementAccounts(parsed.checkpoints) }, sourceType: "pdf" };
        }
        setUploadStatus({ tone: "active", message: importMessages.uploadOcr(file.name) });
        const onOcrProgress = ({ pageNumber = undefined, pageCount = undefined, status = undefined, progress = undefined } = {}) => {
          setUploadStatus({
            tone: "active",
            message: importMessages.uploadOcrProgress({
              fileName: file.name,
              pageNumber,
              pageCount,
              status,
              progress
            })
          });
        };
        const ocrText = await importService.extractPdfOcrText(file, onOcrProgress);
        setUploadStatus({ tone: "active", message: importMessages.uploadParsing(file.name) });
        try {
          parsed = await importService.parseImageStatement({
            file,
            firstPass: ocrText,
            parse: (text) => parseStatementText(text, file.name),
            onProgress: onOcrProgress
          });
        } catch (error) {
          // The optional AI fallback only ever sees the first pass's text.
          parsed = await tryAiStatementTextFallback(ocrText, file.name, error);
        }
      }
      return { parsed: { ...parsed, checkpoints: withDetectedStatementAccounts(parsed.checkpoints) }, sourceType: "pdf" };
    }

    if (fileKind === "xls") {
      setUploadStatus({ tone: "active", message: importMessages.uploadParsing(file.name) });
      return {
        parsed: parseCurrentTransactionSpreadsheet(await file.arrayBuffer(), file.name),
        sourceType: "csv"
      };
    }

    const nextText = await file.text();
    const csvKind = classifyImportFile({
      fileName: file.name,
      fileType: file.type,
      text: nextText,
      activityContext
    });

    if (csvKind === "citibank-activity-csv") {
      setUploadStatus({ tone: "active", message: importMessages.uploadParsing(file.name) });
      return {
        parsed: parseCitibankActivityCsv(nextText, file.name, activityContext),
        sourceType: "csv"
      };
    }

    if (csvKind === "ocbc-activity-csv") {
      setUploadStatus({ tone: "active", message: importMessages.uploadParsing(file.name) });
      return {
        parsed: parseOcbcActivityCsv(nextText, file.name, activityContext),
        sourceType: "csv"
      };
    }

    return {
      parsed: null,
      sourceType: "csv",
      csvText: nextText,
      fileName: file.name
    };
  }

  async function tryAiStatementTextFallback(text, fileName, parseError) {
    if (!allowAiStatementFallback) {
      throw parseError;
    }
    setUploadStatus({ tone: "active", message: "Preparing optional review rows from extracted statement text..." });
    // The reader looks only at the start of the text, so a statement past
    // the route's cap is cut to fit rather than refused.
    const fitted = fitStatementText(fileName, text);
    const response = await fetch("/api/ai-assist/statement-text-fallback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, text: fitted.text })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.available || !Array.isArray(data.rows)) {
      throw new Error(data.reason ?? parseError?.message ?? "The optional statement fallback could not extract review rows.");
    }
    return {
      parserKey: data.parserKey,
      sourceLabel: data.sourceLabel,
      rows: data.rows,
      checkpoints: data.checkpoints ?? [],
      warnings: data.warnings ?? []
    };
  }

  async function loadParsedImport(parsedImport, { keepCommitSummary = false } = {}) {
    setDismissedOverlapIds([]);
    setReviewChangeCount(0);
    currentImportSourceRef.current = parsedImport;
    blockerCursorRef.current = null;
    if (!parsedImport.parsed) {
      // A plain CSV carries no label of its own: name it by its file, so its
      // summary does not read "Imported CSV saved". A label the user set
      // stays.
      if (!isSourceLabelChosenRef.current) {
        setSourceLabel(parsedImport.fileName || DEFAULT_SOURCE_LABEL);
      }
      setCsvText(parsedImport.csvText ?? "");
      setStatementCheckpoints([]);
      setStatementImportMeta(DEFAULT_STATEMENT_IMPORT_META);
      setStatementWarnings([]);
      setUploadStatus({ tone: "success", message: importMessages.uploadCsvReady(parsedImport.fileName ?? "CSV") });
      return;
    }

    await previewParsedImport({
      parsed: parsedImport.parsed,
      sourceType: parsedImport.sourceType,
      nextStatementCheckpoints: parsedImport.sourceType === "pdf" ? parsedImport.parsed.checkpoints : [],
      successMessage: parsedImport.sourceType === "pdf" && parsedImport.parsed.checkpoints.length > 1
        ? importMessages.uploadStatementReady(parsedImport.parsed.rows.length, parsedImport.parsed.checkpoints.length)
        : importMessages.uploadReady(parsedImport.parsed.rows.length),
      keepCommitSummary
    });
  }

  async function previewImportRows({
    rows,
    nextSourceLabel = sourceLabel,
    nextSourceType = statementImportMeta.sourceType,
    nextStatementCheckpoints = statementCheckpoints,
    nextStatementFixes = statementFixesRef.current,
    preservePreviewOnError = false
  }) {
    // All source formats eventually converge here so the server only has one
    // preview path to reason about.
    const requestSequence = previewRequestSequenceRef.current + 1;
    previewRequestSequenceRef.current = requestSequence;
    setPreviewError("");
    const currentAction = `Preview import: ${nextSourceLabel || DEFAULT_SOURCE_LABEL} (${rows.length} rows, ${nextSourceType})`;
    const previousAction = lastImportActionRef.current;
    try {
      const data = await previewImportBatch({
        sourceLabel: nextSourceLabel,
        sourceType: nextSourceType,
        rows,
        defaultAccountName,
        ownerName,
        statementCheckpoints: nextStatementCheckpoints,
        statementFixes: nextStatementFixes,
        diagnosticContext: {
          source: "import_preview",
          action: currentAction,
          previousAction,
          requestContext: {
            sourceLabel: nextSourceLabel,
            sourceType: nextSourceType,
            rowCount: rows.length,
            checkpointCount: nextStatementCheckpoints.length,
            defaultAccountName,
            ownershipType,
            ownerName
          }
        }
      });
      if (requestSequence !== previewRequestSequenceRef.current) {
        return;
      }
      setDismissedOverlapIds((current) => current.filter((id) => data.preview?.overlapImports?.some((item) => item.id === id)));
      // Keep only the fixes the server applied; one it refused is reported in
      // the statement check and dropped.
      const appliedStatementFixes = data.preview?.statementDiagnosis?.appliedFixes ?? [];
      statementFixesRef.current = appliedStatementFixes;
      // A statement card matched by its card's last four digits takes that
      // account, as if the user had mapped it.
      const matchedCheckpoints = applyStatementAccountMatches(nextStatementCheckpoints, data.preview?.statementAccountMatches);
      if (matchedCheckpoints !== nextStatementCheckpoints) {
        nextStatementCheckpoints = matchedCheckpoints;
        statementCheckpointsRef.current = matchedCheckpoints;
        setStatementCheckpoints(matchedCheckpoints);
      }
      const filteredPreview = filterDeletedDiagnosticLedgerRowsFromPreview(data.preview, deletedDiagnosticLedgerIdsRef.current);
      setPreview(filteredPreview);
      setPreviewRows(filteredPreview?.previewRows ?? []);
      previewRowsRef.current = filteredPreview?.previewRows ?? [];
      lastPreviewHydratedAtRef.current = Date.now();
      lastStatementPreviewSnapshotRef.current = buildStatementPreviewSnapshot(
        filteredPreview?.previewRows ?? [],
        nextStatementCheckpoints
      );
      if (nextSourceType === "pdf") {
        const appliedContext = { nextSourceType, nextStatementCheckpoints };
        queueMicrotask(() => applyProvenStatementFixes(filteredPreview, readAutomaticStatementFixes(), appliedContext));
      }
    } catch (error) {
      if (requestSequence !== previewRequestSequenceRef.current) {
        return;
      }
      if (!preservePreviewOnError) {
        setPreview(null);
        setPreviewRows([]);
        previewRowsRef.current = [];
      }
      throw error;
    } finally {
      lastImportActionRef.current = currentAction;
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
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed,
        silent: true,
        isAutoRefresh: true
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
    setReviewChangeCount(0);

    const activityContext = buildActivityContext();
    if (canRecognizeCitibankActivityCsv(csvText, undefined, activityContext)) {
      const parsed = parseCitibankActivityCsv(csvText, undefined, activityContext);
      setIsSubmitting(true);
      try {
        await previewParsedImport({
          parsed,
          sourceType: "csv",
          nextStatementCheckpoints: [],
          successMessage: importMessages.uploadReady(parsed.rows.length)
        });
      } catch (error) {
        setPreviewError(buildImportPreviewError(error));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      await previewImportRows({ rows: importWorkflowModel.mappedRows });
    } catch (error) {
      setPreviewError(buildImportPreviewError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function maybeAutoPreviewCitibankActivityCsv(nextText, context) {
    const activityContext = buildActivityContext(context);
    const signature = `${activityContext.accountName ?? ""}::${activityContext.accountKind ?? ""}::${activityContext.institution ?? ""}::${nextText}`;

    if (isSubmitting || isParsingStatement || importWorkflowModel.isWorkflowLocked || !nextText || !canRecognizeCitibankActivityCsv(nextText, undefined, activityContext)) {
      lastAutoPreviewCitibankSignatureRef.current = "";
      return;
    }

    if (lastAutoPreviewCitibankSignatureRef.current === signature) {
      return;
    }

    lastAutoPreviewCitibankSignatureRef.current = signature;
    const parsed = parseCitibankActivityCsv(nextText, undefined, activityContext);
    setIsSubmitting(true);
    try {
      await previewParsedImport({
        parsed,
        sourceType: "csv",
        nextStatementCheckpoints: [],
        successMessage: importMessages.uploadReady(parsed.rows.length)
      });
    } catch (error) {
      setPreviewError(buildImportPreviewError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDropImportFile(event) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      void processImportFiles(files);
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
    const noLongerListedEntries = importPreviewModel.noLongerListedEntriesToRemove;
    const reopenedEstimates = importPreviewModel.reopenedEstimates;
    if (!rowsToCommit.length && !statementCheckpoints.length && !noLongerListedEntries.length && !reopenedEstimates.length) {
      return;
    }

    setIsSubmitting(true);
    setRecentImportStatus({ tone: "active", message: importMessages.recentCommitWorking });
    setIsRecentImportsRefreshing(true);
    const committedSourceLabel = preview?.sourceLabel ?? sourceLabel;
    let commitResult;
    try {
      commitResult = await commitImportBatch({
        sourceLabel: committedSourceLabel,
        sourceType: statementImportMeta.sourceType,
        parserKey: statementImportMeta.parserKey,
        note: importNote,
        statementCheckpoints,
        statementControlRows: statementImportMeta.sourceType === "pdf" ? previewRows : undefined,
        statementReconciliations: statementImportMeta.sourceType === "pdf" ? statementReconciliations : undefined,
        statementFixes: statementImportMeta.sourceType === "pdf" ? preview?.statementDiagnosis?.appliedFixes ?? [] : [],
        noLongerListedEntries,
        reopenedEstimates,
        rows: rowsToCommit,
        diagnosticContext: {
          source: "import_commit",
          action: `Commit import: ${committedSourceLabel || DEFAULT_SOURCE_LABEL} (${rowsToCommit.length} rows, ${statementImportMeta.sourceType})`,
          previousAction: lastImportActionRef.current,
          requestContext: {
            sourceLabel: committedSourceLabel,
            sourceType: statementImportMeta.sourceType,
            parserKey: statementImportMeta.parserKey,
            rowCount: rowsToCommit.length,
            checkpointCount: statementCheckpoints.length,
            statementControlRowCount: statementImportMeta.sourceType === "pdf" ? previewRows.length : 0,
            statementReconciliationCount: statementImportMeta.sourceType === "pdf" ? statementReconciliations.length : 0
          }
        }
      });
    } catch (error) {
      // A failed commit keeps the review as it is and opens nothing.
      const commitErrorDetail = buildImportPreviewError(error, importMessages.commitFailed);
      setRecentImportStatus({
        tone: "error",
        message: commitErrorDetail.message,
        diagnosticHref: commitErrorDetail.diagnosticHref,
        diagnosticId: commitErrorDetail.diagnosticId
      });
      setPreviewError(commitErrorDetail);
      setOptimisticRecentImport(null);
      setIsSubmitting(false);
      setIsRecentImportsRefreshing(false);
      return;
    }

    splitCleanupCommitCountRef.current += 1;
    const splitCleanupCommitKey = splitCleanupCommitCountRef.current;
    dispatchSplitCleanup({ type: "commitSaved", commitKey: splitCleanupCommitKey });
    setOptimisticRecentImport(buildOptimisticRecentImportBatch({
      commitResult,
      committedSourceLabel,
      importNote,
      rowsToCommit,
      statementCheckpoints,
      statementImportMeta,
      previewRows,
      accounts
    }));
    setRecentImportStatus(null);
    // The file as the user picked it; pasted rows have none.
    const committedFileName = intakeQueue.find((item) => item.id === activeIntakeItemId)?.fileName
      ?? currentImportSourceRef.current?.fileName
      ?? "";
    const doneSummary = buildImportDoneSummary({
      importId: commitResult.importId,
      fileName: committedFileName,
      accounts,
      title: isStatementReview
        ? buildStatementTitle({ parserKey: statementImportMeta.parserKey, statementReconciliations, sourceLabel: committedSourceLabel })
        : committedSourceLabel || DEFAULT_SOURCE_LABEL,
      sourceLabel: committedSourceLabel || DEFAULT_SOURCE_LABEL,
      preview,
      previewRows,
      statementReconciliations,
      isStatement: isStatementReview,
      removedEntryCount: isStatementReview ? 0 : noLongerListedEntries.length
    });
    const committedIntakeItemId = activeIntakeItemId;
    if (currentBatchFile) {
      setCommittedBatchFiles((current) => [
        ...current,
        { ...currentBatchFile, id: committedIntakeItemId ?? `import-${commitResult.importId}`, importId: commitResult.importId }
      ]);
    }
    resetImportForm({ preserveRecentImportStatus: true });
    setLastCommitSummary(doneSummary);
    if (committedIntakeItemId) {
      setIntakeQueue((current) => current.filter((item) => item.id !== committedIntakeItemId));
    }
    // The commit is saved: the next file waiting opens now (once the reset
    // above has rendered), while the rest of the page catches up.
    setIsSubmitting(false);
    if (nextIntakeItem) {
      setPendingNextItemId(nextIntakeItem.id);
    }
    const committedImportId = commitResult.importId;
    const refreshAfterCommit = () => refreshRecentImportsUntilVisible({
      committedImportId,
      refreshOptions: { broadcast: true, invalidateImports: true }
    }).then((latestPage) => {
      setPostImportSplitMatchCount(Number(latestPage?.importsPage?.pendingSplitMatchCount ?? 0));
      const commitMonths = rowsToCommit
        .map((row) => row.date?.slice(0, 7))
        .filter(Boolean)
        .sort();
      setPostImportSplitMatchMonth(commitMonths[commitMonths.length - 1] ?? "");
      dispatchSplitCleanup({ type: "commitRefreshed", commitKey: splitCleanupCommitKey });
      // The saved batch names its accounts with their owners.
      const committedBatch = latestPage?.importsPage?.recentImports?.find((item) => item.id === committedImportId);
      setRecentImportStatus({
        tone: "success",
        message: importMessages.recentCommitSuccess(
          committedFileName || committedSourceLabel || DEFAULT_SOURCE_LABEL,
          committedBatch?.accountNames ?? []
        ),
        earlierImports: buildEarlierImportLines(latestPage?.importsPage?.recentImports ?? [], committedImportId)
      });
      return true;
    });
    // A failed refresh keeps the commit on screen and raises the shell's
    // refresh notice, whose retry runs it again; a superseded one is silent.
    await runBackgroundRefresh(refreshAfterCommit);
    setIsRecentImportsRefreshing(false);
  }

  async function handleExplainMismatch() {
    if (!preview || isExplainingMismatch) {
      return;
    }
    // Past the explanation route's cap: say so instead of sending it.
    if (jsonBodyBytes({ preview }) > IMPORT_EXPLAIN_MAX_BYTES) {
      setPreviewError({ message: limitsCopy.explainTooBig });
      return;
    }
    setIsExplainingMismatch(true);
    try {
      const response = await fetch("/api/ai-assist/import-explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Could not explain the statement mismatch.");
      }
      setAiMismatchExplanations(data.explanations ?? []);
    } catch (error) {
      setPreviewError(buildImportPreviewError(error, "Could not explain the statement mismatch."));
    } finally {
      setIsExplainingMismatch(false);
    }
  }

  async function handleRankDuplicateCandidates() {
    if (isRankingDuplicates) {
      return;
    }
    const pairs = previewRows.flatMap((row) => (row.reconciliationMatches ?? []).map((match) => ({
      rowId: row.rowId,
      existingTransactionId: match.existingTransactionId,
      incomingDescription: row.description,
      existingDescription: match.description
    }))).filter((pair) => pair.existingTransactionId).slice(0, 12);
    if (!pairs.length) {
      return;
    }
    setIsRankingDuplicates(true);
    try {
      const response = await fetch("/api/ai-assist/import-match-ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Could not rank duplicate candidates.");
      }
      setAiDuplicateScores(data.scores ?? []);
      if (data.reason) {
        setPreviewError({ message: data.reason });
      }
    } catch (error) {
      setPreviewError(buildImportPreviewError(error, "Could not rank duplicate candidates."));
    } finally {
      setIsRankingDuplicates(false);
    }
  }

  async function refreshRecentImportsUntilVisible({
    committedImportId,
    refreshOptions
  }) {
    const maxAttempts = 20;
    let latestPage = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      latestPage = await onRefresh(refreshOptions);
      if (!committedImportId || latestPage?.importsPage?.recentImports?.some((item) => item.id === committedImportId)) {
        return latestPage;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }

    return latestPage;
  }

  async function handleRollback(importId) {
    setIsSubmitting(true);
    setIsRecentImportsRefreshing(true);
    try {
      await rollbackImportBatch(importId);
      setCommittedBatchFiles((current) => current.filter((file) => file.importId !== importId));
      await onRefresh({
        broadcast: true,
        invalidateEntries: true,
        invalidateImports: true,
        invalidateMonth: true,
        invalidateSummary: true,
        invalidateSplits: true
      });
    } finally {
      setIsSubmitting(false);
      setIsRecentImportsRefreshing(false);
    }
  }

  function clearStatementFixes() {
    statementFixesRef.current = [];
    autoAppliedStatementFixKeysRef.current = new Set();
    setAutoAppliedStatementFixCount(0);
    setDismissedStatementFindingIds([]);
    setIsEditingStatementRows(false);
    setKeepsNoLongerListedEntries(false);
  }

  // `context` carries the file's source type and checkpoints when this runs
  // right after a first preview, before the panel state has caught up.
  function refreshWithStatementFixes(nextStatementFixes, context = {}) {
    statementFixesRef.current = nextStatementFixes;
    return refreshPreviewFromRows({
      rows: previewRowsRef.current.map(importService.buildRawRowFromPreviewRow),
      nextStatementFixes,
      nextSourceType: context.nextSourceType ?? statementImportMeta.sourceType,
      nextStatementCheckpoints: context.nextStatementCheckpoints ?? statementCheckpointsRef.current,
      activeMessage: importMessages.statementReconciliationRefreshing,
      successMessage: importMessages.statementReconciliationRefreshed
    });
  }

  function applyStatementFixes(fixes, context) {
    const keys = new Set(statementFixesRef.current.map(getStatementFixKey));
    return refreshWithStatementFixes([
      ...statementFixesRef.current,
      ...fixes.filter((fix) => !keys.has(getStatementFixKey(fix)))
    ], context);
  }

  function undoStatementFixes(fixes) {
    const keys = new Set(fixes.map(getStatementFixKey));
    return refreshWithStatementFixes(statementFixesRef.current.filter((fix) => !keys.has(getStatementFixKey(fix))));
  }

  function changeAutomaticStatementFixes(isAutomatic) {
    writeAutomaticStatementFixes(isAutomatic);
    setIsAutomaticStatementFixes(isAutomatic);
  }

  // With "Fix it for me" on, the fixes a statement proves are applied once,
  // as if the user had approved them; they stay undoable until the commit.
  function applyProvenStatementFixes(nextPreview, isAutomatic, context) {
    if (!isAutomatic || nextPreview?.statementReconciliations?.length === 0) {
      return;
    }
    const proven = getProvenStatementFixes(nextPreview?.statementDiagnosis, autoAppliedStatementFixKeysRef.current);
    if (!proven.length) {
      return;
    }
    for (const fix of proven) {
      autoAppliedStatementFixKeysRef.current.add(getStatementFixKey(fix));
    }
    setAutoAppliedStatementFixCount((current) => current + proven.length);
    void applyStatementFixes(proven, context);
  }

  function dismissStatementFindings(findingIds) {
    setDismissedStatementFindingIds((current) => Array.from(new Set([...current, ...findingIds])));
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

  function openSplitMatchReview() {
    const params = new URLSearchParams({
      view: viewId || "household",
      month: postImportSplitMatchMonth || previewRows[0]?.date?.slice(0, 7) || safeImportsPage.recentImports[0]?.endDate?.slice(0, 7) || "",
      split_mode: "matches"
    });
    if (!params.get("month")) {
      params.delete("month");
    }
    navigate({
      pathname: "/splits",
      search: `?${params.toString()}`
    });
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
      activeMessage: importMessages.accountMappingRefreshing,
      successMessage: importMessages.accountMappingRefreshed
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
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed
      });
    }
  }

  const displayedRecentImports = useMemo(() => {
    if (!optimisticRecentImport) {
      return safeImportsPage.recentImports;
    }

    return [
      optimisticRecentImport,
      ...safeImportsPage.recentImports.filter((item) => item.id !== optimisticRecentImport.id)
    ];
  }, [optimisticRecentImport, safeImportsPage.recentImports]);

  const recentImportAccountOptions = useMemo(
    () => getRecentImportAccountOptions(displayedRecentImports, accounts),
    [accounts, displayedRecentImports]
  );
  const filteredRecentImports = useMemo(
    () => filterRecentImportsByAccount(displayedRecentImports, recentImportAccountFilter),
    [displayedRecentImports, recentImportAccountFilter]
  );
  const recentImportModel = useMemo(
    () => buildRecentImportModel(filteredRecentImports, recentImportPage),
    [filteredRecentImports, recentImportPage]
  );

  useEffect(() => {
    setRecentImportPage((current) => Math.min(Math.max(current, 1), recentImportModel.pageCount));
  }, [recentImportModel.pageCount]);

  useEffect(() => {
    if (optimisticRecentImport && safeImportsPage.recentImports.some((item) => item.id === optimisticRecentImport.id)) {
      setOptimisticRecentImport(null);
    }
  }, [optimisticRecentImport, safeImportsPage.recentImports]);

  // Links an estimate whose bank row is gone to the row of this file the
  // user picked as its final charge (rowId null: none); a row linked before
  // goes back to how the preview had it.
  function linkUnlistedEstimate(estimate, rowId) {
    setPreviewRows((currentRows) => currentRows.map((row) => {
      if (row.rowId === rowId) {
        return {
          ...row,
          reconciliationTargetTransactionId: estimate.transactionId,
          commitStatus: "included",
          commitStatusReason: importMessages.unlistedEstimateLinkedReason(
            estimate.originalAmount,
            formatService.money(estimate.amountMinor),
            formatService.money(row.amountMinor)
          ),
          commitStatusExplicit: true
        };
      }
      if (row.reconciliationTargetTransactionId === estimate.transactionId) {
        const original = preview?.previewRows?.find((item) => item.rowId === row.rowId);
        return {
          ...row,
          reconciliationTargetTransactionId: original?.reconciliationTargetTransactionId,
          commitStatus: original?.commitStatus ?? "included",
          commitStatusReason: original?.commitStatusReason,
          commitStatusExplicit: false
        };
      }
      return row;
    }));
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
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed
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
    const nextRows = previewRowsRef.current.map((row) => (
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
    const nextCheckpoints = statementCheckpointsRef.current.map((checkpoint) => (
      getCheckpointDetectedAccountName(checkpoint) === fromAccountName
        ? { ...checkpoint, detectedAccountName: fromAccountName, accountId: nextAccount.id, accountName: nextAccount.name }
        : checkpoint
    ));
    setPreviewRows(nextRows);
    setStatementCheckpoints(nextCheckpoints);
    previewRowsRef.current = nextRows;
    statementCheckpointsRef.current = nextCheckpoints;
    void refreshPreviewFromRows({
      rows: nextRows.map(importService.buildRawRowFromPreviewRow),
      nextStatementCheckpoints: nextCheckpoints,
      activeMessage: importMessages.accountMappingRefreshing,
      successMessage: importMessages.accountMappingRefreshed
    });
  }

  async function applyStatementAccountMapping(fromAccountName, nextAccount) {
    const nextRows = previewRowsRef.current.map((row) => (
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
    const nextCheckpoints = statementCheckpointsRef.current.map((checkpoint) => (
      getCheckpointDetectedAccountName(checkpoint) === fromAccountName
        ? { ...checkpoint, detectedAccountName: fromAccountName, accountId: nextAccount.id, accountName: nextAccount.name }
        : checkpoint
    ));

    setPreviewRows(nextRows);
    setStatementCheckpoints(nextCheckpoints);
    previewRowsRef.current = nextRows;
    statementCheckpointsRef.current = nextCheckpoints;
    try {
      await refreshPreviewFromRows({
        rows: nextRows.map(importService.buildRawRowFromPreviewRow),
        nextStatementCheckpoints: nextCheckpoints,
        activeMessage: importMessages.accountMappingRefreshing,
        successMessage: importMessages.accountMappingRefreshed
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
      const data = await saveAccount({
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
      await onRefresh(buildImportAccountCreationRefreshPlan());
      await applyStatementAccountMapping(detectedAccountName, createdAccount);
      setReviewChangeCount((count) => count + 1);
      setUploadStatus({ tone: "success", message: importMessages.accountCreatedFromStatement(createdAccount.name) });
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
      activeMessage: importMessages.statementReconciliationRefreshing,
      successMessage: importMessages.statementReconciliationRefreshed
    });
  }

  async function handleDeleteDiagnosticLedgerRow(row) {
    if (!row?.id) {
      throw new Error("Missing ledger row id.");
    }

    setUploadStatus({ tone: "active", message: `Deleting ${row.description || "ledger row"} and refreshing statement check.` });
    setIsSubmitting(true);
    try {
      await deleteDiagnosticLedgerEntry(row);
      deletedDiagnosticLedgerIdsRef.current.add(row.id);
      setPreview((currentPreview) => filterDeletedDiagnosticLedgerRowsFromPreview(
        currentPreview,
        deletedDiagnosticLedgerIdsRef.current
      ));
      await refreshPreviewFromRows({
        rows: previewRows.map(importService.buildRawRowFromPreviewRow),
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed,
        silent: true
      });
      setUploadStatus({ tone: "success", message: "Ledger row deleted. Statement check refreshed." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete ledger row.";
      setUploadStatus({ tone: "error", message });
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteDiagnosticLedgerRows(rows) {
    const ledgerRows = rows.filter((row) => row?.id);
    if (!ledgerRows.length) {
      throw new Error("No ledger rows were available to delete.");
    }

    setUploadStatus({
      tone: "active",
      message: importMessages.deleteDiagnosticEntriesProgress(ledgerRows.length)
    });
    setIsSubmitting(true);
    try {
      for (const row of ledgerRows) {
        await deleteDiagnosticLedgerEntry(row);
        deletedDiagnosticLedgerIdsRef.current.add(row.id);
      }
      setPreview((currentPreview) => filterDeletedDiagnosticLedgerRowsFromPreview(
        currentPreview,
        deletedDiagnosticLedgerIdsRef.current
      ));
      await refreshPreviewFromRows({
        rows: previewRows.map(importService.buildRawRowFromPreviewRow),
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed,
        silent: true
      });
      setUploadStatus({
        tone: "success",
        message: importMessages.deleteDiagnosticEntriesSuccess(ledgerRows.length)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete ledger rows.";
      setUploadStatus({ tone: "error", message });
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSetDiagnosticLedgerPostDate(row, postDate, options = {}) {
    if (!row?.id) {
      throw new Error("Missing ledger row id.");
    }
    if (!postDate) {
      throw new Error("Missing posted date.");
    }

    const formattedPostDate = options.label ?? postDate;
    const activeMessage = options.mode === "defer"
      ? importMessages.deferDiagnosticEntryProgress({ description: row.description, deferDate: formattedPostDate })
      : importMessages.setDiagnosticPostDateProgress({ description: row.description, postDate: formattedPostDate });
    const successMessage = options.mode === "defer"
      ? importMessages.deferDiagnosticEntrySuccess({ deferDate: formattedPostDate })
      : importMessages.setDiagnosticPostDateSuccess({ postDate: formattedPostDate });

    setUploadStatus({ tone: "active", message: activeMessage });
    setIsSubmitting(true);
    try {
      await updateDiagnosticLedgerPostDate(row, postDate);
      await refreshPreviewFromRows({
        rows: previewRows.map(importService.buildRawRowFromPreviewRow),
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed,
        silent: true
      });
      setUploadStatus({ tone: "success", message: successMessage });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update posted date.";
      await refreshPreviewFromRows({
        rows: previewRows.map(importService.buildRawRowFromPreviewRow),
        activeMessage: importMessages.statementReconciliationRefreshing,
        successMessage: importMessages.statementReconciliationRefreshed,
        silent: true
      });
      setUploadStatus({
        tone: "error",
        message: importMessages.setDiagnosticPostDateUnconfirmed(message)
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteDiagnosticLedgerEntry(row) {
    const response = await fetch("/api/entries/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ entryId: row.id })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error ?? `Failed to delete ${row.description || "ledger row"}.`);
    }
  }

  async function updateDiagnosticLedgerPostDate(row, postDate) {
    const response = await fetch("/api/entries/update-post-date", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ entryId: row.id, postDate })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error ?? `Failed to update posted date for ${row.description || "ledger row"}.`);
    }
  }

  // Counts a change to the file in review that opening another file would
  // drop.
  function trackReviewChange(handler) {
    return (...args) => {
      setReviewChangeCount((count) => count + 1);
      return handler(...args);
    };
  }

  // A new drop after the last batch finished starts a new list of files.
  function startBatchIfIdle() {
    if (!isBatchInProgress) {
      setCommittedBatchFiles([]);
    }
  }

  // Scrolls to the control that fixes a blocker. Rows to check are decided
  // in the row editor, which a statement opens on request.
  // A blocker (or a bare target) to jump to; J and K carry on from a
  // blocker jumped to by any means.
  function jumpToBlocker(blockerOrTarget) {
    const target = blockerOrTarget.target ?? blockerOrTarget;
    if (typeof blockerOrTarget.order === "number") {
      blockerCursorRef.current = blockerOrTarget.order;
    }
    if (target.kind === "review-rows" && isStatementReview && !isEditingStatementRows) {
      setIsEditingStatementRows(true);
      setPendingJumpTarget(target);
      return;
    }
    jumpToImportTarget(target, panelRef.current ?? document);
  }

  // "Skip for now": the file in review goes to the end of the queue, still
  // parsed, and the next file opens. A file that was dropped on its own (or
  // pasted) joins the queue first. Nothing is saved.
  function handleSkipForNow() {
    const nextItem = nextIntakeItem;
    if (!nextItem) {
      return;
    }
    // Pasted CSV text has no file; it queues as text under its source label.
    const source = currentImportSourceRef.current ?? (csvText ? { parsed: null, sourceType: "csv", csvText, fileName: sourceLabel } : null);
    if (activeIntakeItem) {
      setIntakeQueue((current) => skipIntakeItem(current, activeIntakeItem.id));
    } else if (source) {
      const item = buildIntakeQueueItem({
        id: `${Date.now()}-skipped-${source.fileName ?? source.parsed?.sourceLabel ?? sourceLabel}`,
        fileName: source.fileName ?? source.parsed?.sourceLabel ?? sourceLabel,
        parsed: source.parsed,
        sourceType: source.sourceType,
        csvText: source.csvText,
        inbox: safeImportsPage.importInbox,
        existingFingerprints: new Set(intakeQueue.map((queued) => queued.fingerprint))
      });
      setIntakeQueue((current) => skipIntakeItem([...current, item], item.id));
    }
    void handleLoadIntakeItem(nextItem);
  }

  // A chip in the phone sheet closes the sheet first; its action runs once
  // focus has come back from the sheet, so a jump keeps the focus it moves.
  function afterClosingProgressSheet(action) {
    return (...args) => {
      setIsProgressSheetOpen(false);
      setAfterProgressSheet(() => () => action(...args));
    };
  }

  function showCurrentFile() {
    const section = preview ? previewSectionRef.current : mappingSectionRef.current ?? previewSectionRef.current;
    if (section) {
      revealAndFocus(section);
    }
  }

  function showDoneFile() {
    const heading = panelRef.current?.querySelector(".import-done-card h3");
    if (heading instanceof HTMLElement) {
      revealAndFocus(heading);
    }
  }

  // An official statement is reviewed card by card (ImportPreviewReview);
  // its optional AI checks then sit under "More checks".
  const isStatementReview = statementImportMeta.sourceType === "pdf" && statementReconciliations.length > 0;
  // Any file in review folds Bring files to one line ("Change" opens it
  // again). A plain CSV keeps its column mapping beside its preview.
  // With a commit just made and no other file open, the step is Done; a
  // file opened after it (a CSV waits for its preview in Bring files) shows
  // the commit's summary in short above it instead.
  const isFileOpen = Boolean(preview || activeIntakeItemId);
  const importStage = preview ? "review" : lastCommitSummary && !activeIntakeItemId ? "done" : "bring";
  const canCollapseBringFiles = Boolean(preview);
  const isBringFilesShown = !canCollapseBringFiles || isBringFilesOpen;
  const isMappingShown = importWorkflowModel.readyForMapping && (isBringFilesShown || isMappingNeeded);
  // With files queued, or Bring files opened again over a file in review,
  // the drop zone is one slim line so the queue starts on the first screen.
  const isDropZoneSlim = intakeQueue.length > 0 || (canCollapseBringFiles && isBringFilesOpen);
  const nextIntakeItem = findNextIntakeItem(intakeQueue, activeIntakeItemId);
  // A batch is in progress while a file is queued, in review, or just
  // committed; the import bar then sticks to the top (desktop and tablet).
  const isBatchInProgress = Boolean(preview || lastCommitSummary || activeIntakeItemId) || intakeQueue.length > 0;
  const activeIntakeItem = activeIntakeItemId ? intakeQueue.find((item) => item.id === activeIntakeItemId) : undefined;
  const currentBatchFile = activeIntakeItem
    ? { id: activeIntakeItem.id, label: describeIntakeItemLabel(activeIntakeItem), title: activeIntakeItem.fileName }
    : preview
      ? {
        id: "current",
        label: describeImportFileLabel({
          fileName: preview.sourceLabel ?? sourceLabel,
          sourceType: statementImportMeta.sourceType,
          parserKey: statementImportMeta.parserKey,
          checkpoints: statementCheckpoints
        }),
        title: preview.sourceLabel ?? sourceLabel
      }
      : null;
  // The card names the account itself only when no Account row does.
  const previewAccountNames = [...new Set(previewRows.map((row) => row.accountName).filter(Boolean))];
  const singlePreviewAccountName = previewAccountNames.length === 1 ? previewAccountNames[0] : undefined;
  const importBatch = isBatchInProgress
    ? buildImportBatchFiles({ committedFiles: committedBatchFiles, currentFile: currentBatchFile, queue: intakeQueue, activeItemId: activeIntakeItemId })
    : { files: [], index: 0, total: 0 };
  // Opening another file drops what the user changed in this one: row
  // edits, mappings and the statement fixes they approved.
  const hasUnsavedReviewWork = Boolean(preview) && reviewChangeCount > 0;
  const showImportBlockers = Boolean(preview) || importBlockers.blockers.length > 0;
  const isBatchBarStuck = useImportStickyBar(panelRef, batchBarRef, isBatchInProgress);
  useImportBlockerKeys({ hasPreview: Boolean(preview), blockers: importBlockers.blockers, cursorRef: blockerCursorRef, onJump: jumpToBlocker });
  // The file a commit opens next, opened from this render so it starts from
  // the reset form rather than the committed file's choices.
  useEffect(() => {
    if (!pendingNextItemId) {
      return;
    }
    setPendingNextItemId(null);
    const item = intakeQueue.find((queued) => queued.id === pendingNextItemId);
    if (item) {
      void handleLoadIntakeItem(item);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per commit; handleLoadIntakeItem is this render's
  }, [pendingNextItemId]);
  // A phone sheet chip's action, once the sheet has closed. The sheet hands
  // focus back to its opener in a timeout of its own (Radix FocusScope),
  // queued before this one, so the action's focus is the one that stays.
  useEffect(() => {
    if (isProgressSheetOpen || !afterProgressSheet) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setAfterProgressSheet(null);
      afterProgressSheet();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [afterProgressSheet, isProgressSheetOpen]);
  // A jump that had to open the row editor first lands once it is shown.
  useEffect(() => {
    if (!pendingJumpTarget || !isEditingStatementRows) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      jumpToImportTarget(pendingJumpTarget, panelRef.current ?? document);
      setPendingJumpTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isEditingStatementRows, pendingJumpTarget]);
  const optionalAiChecks = (
    <>
  {hasStatementReconciliationMismatch ? (
              <section className="import-warning import-warning-attention" aria-live="polite">
                <strong>Plain-language check</strong>
                <p className="lede compact">This is optional guidance. The exact ledger rows and statement controls above remain the source of truth.</p>
                {aiMismatchExplanations.length ? (
                  <div className="stack compact-stack">
                    {aiMismatchExplanations.map((item) => <p key={item.accountName}><strong>{item.accountName}:</strong> {item.message}</p>)}
                  </div>
                ) : (
                  <button type="button" className="subtle-action" onClick={() => void handleExplainMismatch()} disabled={isExplainingMismatch}>
                    {isExplainingMismatch ? "Explaining..." : "Explain what to check"}
                  </button>
                )}
              </section>
            ) : null}

            {previewReconciliationRowCount ? (
              <section className="import-warning import-warning-attention" aria-live="polite">
                <strong>Possible duplicate rows</strong>
                <p className="lede compact">These are already constrained by account, amount, and date. Optional ranking only compares merchant descriptions and never changes a skip or certification decision.</p>
                {aiDuplicateScores.length ? (
                  <p className="lede compact">Top optional description similarity: {aiDuplicateScores[0].similarity}% for a row already shown in the reconciliation review.</p>
                ) : (
                  <button type="button" className="subtle-action" onClick={() => void handleRankDuplicateCandidates()} disabled={isRankingDuplicates}>
                    {isRankingDuplicates ? "Ranking..." : "Rank descriptions"}
                  </button>
                )}
              </section>
            ) : null}
    </>
  );

  return (
    <article ref={panelRef} className={`panel import-panel${isBatchInProgress ? " has-sticky-bar" : ""}`}>
      {isPageDragActive ? (
        <div className="import-page-drop-hint" role="status">{importMessages.pageDropHint}</div>
      ) : null}
      <div className="panel-head">
        <div>
          <h2>{messages.tabs.imports}</h2>
          <span className="panel-context">{importMessages.viewing(viewLabel)}</span>
        </div>
      </div>
      <ImportBatchBar
        barRef={batchBarRef}
        isSticky={isBatchInProgress}
        isStuck={isBatchBarStuck}
        stepper={(
          <ImportStepper
            stage={importStage}
            bringSummary={canCollapseBringFiles
              ? uploadStatus?.message ?? preview?.sourceLabel ?? sourceLabel
              : importMessages.stageBringSummary(intakeQueue.length)}
            isBringAlert={canCollapseBringFiles && uploadStatus?.tone === "error"}
            isBringOpen={isBringFilesOpen}
            canCollapseBring={canCollapseBringFiles}
            onToggleBring={() => setIsBringFilesOpen((current) => !current)}
          />
        )}
        batch={importBatch}
        doneImportId={lastCommitSummary?.importId}
        hasUnsavedReviewWork={hasUnsavedReviewWork}
        blockers={importBlockers}
        showBlockers={showImportBlockers}
        onOpenFile={(item) => void handleLoadIntakeItem(item)}
        onShowCurrentFile={showCurrentFile}
        onShowDoneFile={showDoneFile}
        onJump={jumpToBlocker}
      />
      {lastCommitSummary && isFileOpen ? (
        <ImportDoneCard
          compact
          summary={lastCommitSummary}
          onRollback={async () => {
            await handleRollback(lastCommitSummary.importId);
            setLastCommitSummary(null);
          }}
        />
      ) : null}
      {importStage === "done" ? (
        <ImportDoneCard
          summary={lastCommitSummary}
          nextItem={nextIntakeItem}
          onReviewNext={() => nextIntakeItem && void handleLoadIntakeItem(nextIntakeItem)}
          onRollback={async () => {
            await handleRollback(lastCommitSummary.importId);
            setLastCommitSummary(null);
          }}
          onClose={() => setLastCommitSummary(null)}
        />
      ) : null}
      {isBringFilesShown ? (
        <>
          {/* Stage 1: the drop zone first, then the queue, then the inbox. */}
          <section className="panel-subsection import-workflow">
            <div className="import-header">
              <h3>{importMessages.composerTitle}</h3>
              {importDraftExists ? (
                <button type="button" className="subtle-action" onClick={() => resetImportForm()} disabled={isSubmitting}>
                  {importMessages.startOver}
                </button>
              ) : null}
            </div>
            <ImportSelectFileStage
              currentStage={importWorkflowModel.currentStage}
              sourceLabel={sourceLabel}
              onSourceLabelChange={handleSourceLabelChange}
              defaultAccountName={defaultAccountName}
              onDefaultAccountChange={handleDefaultAccountChange}
              accounts={accounts}
              ownerName={ownerName}
              onOwnerNameChange={handleOwnerNameChange}
              people={people}
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
              allowAiStatementFallback={allowAiStatementFallback}
              onAllowAiStatementFallbackChange={setAllowAiStatementFallback}
              rollbackPolicy={safeImportsPage.rollbackPolicy}
              isPasteDefaultsOpen={isPasteDefaultsOpen}
              onTogglePasteDefaults={() => setIsPasteDefaultsOpen((current) => !current)}
              isSlim={isDropZoneSlim}
              intro={importMessages.composerDetail}
              hasWaitingFiles={Boolean(nextIntakeItem)}
              onShowQueue={() => jumpToImportTarget({ kind: "intake-queue" }, panelRef.current ?? document)}
            />
          </section>
          <ImportIntakeQueueSection
            items={intakeQueue}
            summary={intakeQueueSummary}
            activeItemId={activeIntakeItemId}
            hasUnsavedReviewWork={hasUnsavedReviewWork}
            onLoadItem={handleLoadIntakeItem}
            onRemoveItem={handleRemoveIntakeItem}
            onClear={handleClearIntakeQueue}
            onChooseFiles={() => fileInputRef.current?.click()}
          />
          <ImportInboxSection
            inbox={safeImportsPage.importInbox}
            intakeQueue={intakeQueue}
            defaultOpen={isInboxOpenByDefault({ queuedCount: intakeQueue.length, isFileInReview: Boolean(preview) || isMappingNeeded })}
            onSelectExpectedFile={handleSelectExpectedFile}
          />
        </>
      ) : null}
      {isMappingShown || preview || statementWarnings.length ? (
      <section className="panel-subsection import-workflow">
        {/* Stage 2: map source columns into the app's import schema. */}
        {isMappingShown ? (
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

        {/* Stage 3: review the normalized preview and commit only safe rows.
            Nothing shows here until a preview (or its warnings) exists. A
            file dropped on the file in review does not start an intake. */}
        {preview || statementWarnings.length ? (
        <div
          ref={previewSectionRef}
          data-import-target="preview-rows"
          className={`import-stage-card ${importWorkflowModel.currentStage === 3 ? "is-current" : ""}`}
          data-page-drop={preview ? "off" : undefined}
        >
          {preview && !isStatementReview ? (
            <ImportFileCard
              title={currentBatchFile?.label ?? preview.sourceLabel ?? sourceLabel}
              subtitle={showStatementAccountMapping ? undefined : singlePreviewAccountName}
              rowCount={countRowsToImport(previewRows)}
              coverage={preview.startDate && preview.endDate
                ? importMessages.fileCardCovers(formatService.formatDateOnly(preview.startDate), formatService.formatDateOnly(preview.endDate))
                : undefined}
              showAccountState={showStatementAccountMapping}
              // The same count the "Map N accounts" blocker on the import bar says.
              unknownAccountCount={importPreviewModel.hasUnmappedAccounts ? Math.max(1, importPreviewModel.unmappedCommitAccountNames?.length ?? 1) : 0}
              ownerName={getImportRowsOwnerName(previewRows)}
            />
          ) : null}
          {isStatementReview ? null : (
          <div className="import-stage-head">
            <div className="section-head">
              <h3>{importMessages.previewRows}</h3>
              <span className="panel-context">
                {preview ? importMessages.transactionCount(preview.importedRows) : importMessages.previewEmpty}
              </span>
            </div>
            <div className="import-stage-head-actions">
              <span className={`import-stage-label ${importWorkflowModel.currentStage === 3 ? "is-current" : ""}`}>
                {importMessages.steps[2]}
              </span>
              {preview ? (
                <button
                  type="button"
                  className="subtle-action"
                  onClick={() => resetImportForm()}
                >
                  {importMessages.startOver}
                </button>
              ) : null}
            </div>
          </div>
          )}
          {preview && !isStatementReview ? <p className="import-stage-note">{importMessages.previewReady}</p> : null}
          {previewRows.length > 100 ? (
            <p className="import-stage-note">{importMessages.largeImportNotice(previewRows.length)}</p>
          ) : null}
          {statementWarnings.length ? (
            <section className="import-warning import-warning-attention" aria-live="polite">
              <strong>Review before importing</strong>
              {statementWarnings.map((warning) => <p key={warning} className="lede compact">{warning}</p>)}
            </section>
          ) : null}
          {hasUnbalancedStatement ? (
            <ImportStatementRecovery
              recovery={statementRecovery}
              isSubmitting={isSubmitting}
              onAddRow={handleAddRecoveryRow}
            />
          ) : null}

          <InferredAmountsContext.Provider value={inferredAmountKeys}>
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
            viewId={viewId}
            hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
            duplicateCheckpointAccounts={duplicateCheckpointAccounts}
            isSubmitting={isSubmitting}
            canJumpToSkippedRows={skippedPreviewRowCount > 0}
            onRemapPreviewAccount={trackReviewChange(remapPreviewAccount)}
            onCreateStatementAccount={openCreateStatementAccountDialog}
            onDismissOverlap={(importId) => setDismissedOverlapIds((current) => [...new Set([...current, importId])])}
            onUpdatePreviewRowCommitStatus={trackReviewChange(updatePreviewRowCommitStatus)}
            onJumpToSkippedRows={() => setJumpToSkippedRowsRequestKey((current) => current + 1)}
            onRefreshStatementReconciliation={handleRefreshStatementReconciliation}
            onDeleteDiagnosticLedgerRow={handleDeleteDiagnosticLedgerRow}
            onDeleteDiagnosticLedgerRows={handleDeleteDiagnosticLedgerRows}
            onSetDiagnosticLedgerPostDate={handleSetDiagnosticLedgerPostDate}
            onUpdateStatementCheckpoint={trackReviewChange(updateStatementCheckpoint)}
            dismissedStatementFindingIds={dismissedStatementFindingIds}
            onApplyStatementFixes={trackReviewChange(applyStatementFixes)}
            onUndoStatementFixes={trackReviewChange(undoStatementFixes)}
            onDismissStatementFindings={trackReviewChange(dismissStatementFindings)}
            needsStatementAccountMapping={needsStatementAccountMapping}
            statementImportMeta={statementImportMeta}
            isEditingRows={isEditingStatementRows}
            onToggleEditRows={() => setIsEditingStatementRows((current) => !current)}
            moreChecks={isStatementReview ? optionalAiChecks : null}
            isAutomaticStatementFixes={isAutomaticStatementFixes}
            autoAppliedStatementFixCount={autoAppliedStatementFixCount}
            onAutomaticStatementFixesChange={changeAutomaticStatementFixes}
            keepsNoLongerListedEntries={keepsNoLongerListedEntries}
            onKeepsNoLongerListedEntriesChange={trackReviewChange(setKeepsNoLongerListedEntries)}
            onLinkUnlistedEstimate={trackReviewChange(linkUnlistedEstimate)}
          />

          {isStatementReview ? null : optionalAiChecks}

          {preview && (!isStatementReview || isEditingStatementRows) ? (
            <ImportPreviewRowsTable
              previewRows={previewRows}
              accounts={accounts}
              categories={categories}
              people={people}
              knownAccountNames={knownAccountNames}
              statementImportSourceType={statementImportMeta.sourceType}
              hasAlreadyCoveredCheckpointRefresh={hasAlreadyCoveredCheckpointRefresh}
              hasEmptyStatementCheckpointOnly={hasEmptyStatementCheckpointOnly}
              ledgerMatchedStatement={ledgerMatchedStatement}
              jumpToSkippedRowsRequestKey={jumpToSkippedRowsRequestKey}
              onUpdatePreviewRow={trackReviewChange(updatePreviewRow)}
              onUpdatePreviewRowAccount={trackReviewChange(updatePreviewRowAccount)}
              onUpdatePreviewRowCommitStatus={trackReviewChange(updatePreviewRowCommitStatus)}
              onPromotePreviewRowReconciliationTarget={trackReviewChange(promotePreviewRowReconciliationTarget)}
              getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
              isPhoneLayout={isPhoneLayout}
            />
          ) : null}
          </InferredAmountsContext.Provider>
          {preview ? (
            <ImportCommitBar
              previewRows={previewRows}
              statementCheckpointCount={statementCheckpoints.length}
              ledgerMatchedStatement={ledgerMatchedStatement}
              reconciledExistingRowCount={reconciledExistingRowCount}
              removedEntryCount={statementImportMeta.sourceType === "pdf"
                ? statementReconciliations.reduce((total, reconciliation) => total + countRemovedByStatement(reconciliation), 0)
                : importPreviewModel.noLongerListedEntriesToRemove.length}
              reopenedEstimateCount={importPreviewModel.reopenedEstimates.length}
              statementImportSourceType={statementImportMeta.sourceType}
              isCommitDisabled={isCommitDisabled}
              isSubmitting={isSubmitting}
              commitLabel={describeCommitLabel({ commitKind, commitLabel, nextItem: nextIntakeItem })}
              commitWarning={commitWarning}
              remainingCount={importBlockers.remainingCount}
              onJumpToNext={importBlockers.blockers.length ? () => jumpToBlocker(importBlockers.blockers[0]) : undefined}
              onShowRemaining={isPhoneLayout ? () => setIsProgressSheetOpen(true) : undefined}
              skip={nextIntakeItem ? {
                question: hasUnsavedReviewWork ? importMessages.batchSwitchWarning(nextIntakeItem.fileName) : null,
                onSkip: handleSkipForNow
              } : undefined}
              onCommit={handleCommit}
              onStartOver={() => resetImportForm()}
              isStatementSavedBefore={commitKind === "saved_again"}
            />
          ) : (
            <EmptyState>{importMessages.previewEmpty}</EmptyState>
          )}
        </div>
        ) : null}
      </section>
      ) : null}

      {showSplitCleanupNotice ? (
        <section className="import-post-cleanup-card">
          <div>
            <h3>{importMessages.splitCleanupTitle(pendingSplitMatchCount)}</h3>
            <p>{importMessages.splitCleanupDetail}</p>
          </div>
          <div className="import-post-cleanup-actions">
            <button type="button" className="dialog-primary" onClick={openSplitMatchReview}>
              {importMessages.reviewSplitMatchesNow}
            </button>
            <button type="button" className="subtle-action" onClick={() => dispatchSplitCleanup({ type: "later" })}>
              {importMessages.reviewSplitMatchesLater}
            </button>
          </div>
        </section>
      ) : null}

      <ImportRecentHistorySection
        recentImports={filteredRecentImports}
        recentImportAccountFilter={recentImportAccountFilter}
        recentImportAccountOptions={recentImportAccountOptions}
        recentImportGroups={recentImportModel.groups}
        recentImportsOpen={recentImportsOpen}
        recentImportStatus={recentImportStatus}
        hasOptimisticRecentImport={Boolean(optimisticRecentImport)}
        recentImportPage={recentImportPage}
        recentImportPageCount={recentImportModel.pageCount}
        recentImportStart={recentImportModel.start}
        recentImportEnd={recentImportModel.end}
        onToggleOpen={() => setRecentImportsOpen((current) => !current)}
        onAccountFilterChange={setRecentImportAccountFilter}
        onPreviousPage={() => setRecentImportPage((current) => Math.max(1, current - 1))}
        onNextPage={() => setRecentImportPage((current) => Math.min(recentImportModel.pageCount, current + 1))}
        onRollback={handleRollback}
        isRefreshing={isRecentImportsRefreshing}
      />
      {isProgressSheetOpen && preview && isPhoneLayout ? (
        <ImportProgressSheet
          batch={importBatch}
          doneImportId={lastCommitSummary?.importId}
          hasUnsavedReviewWork={hasUnsavedReviewWork}
          blockers={importBlockers}
          onClose={() => setIsProgressSheetOpen(false)}
          onOpenFile={afterClosingProgressSheet((item) => void handleLoadIntakeItem(item))}
          onShowCurrentFile={afterClosingProgressSheet(showCurrentFile)}
          onShowDoneFile={afterClosingProgressSheet(showDoneFile)}
          onJump={afterClosingProgressSheet(jumpToBlocker)}
        />
      ) : null}
      <AccountDialog
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

function buildOptimisticRecentImportBatch({
  commitResult,
  committedSourceLabel,
  importNote,
  rowsToCommit,
  statementCheckpoints,
  statementImportMeta,
  previewRows,
  accounts
}) {
  // Same "Account - Owner" label the server gives the saved batch, so the
  // Recent imports account filter keeps this row until the server one lands.
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const labelFor = (item) => {
    const account = item.accountId ? accountsById.get(item.accountId) : null;
    return account ? formatAccountSelectLabel(account) : item.accountName;
  };
  const accountNames = Array.from(new Set([
    ...previewRows.map(labelFor).filter(Boolean),
    ...statementCheckpoints.map(labelFor).filter(Boolean)
  ])).sort();
  const dateValues = rowsToCommit
    .map((row) => row.date)
    .filter((date) => typeof date === "string" && date.length >= 10)
    .sort();
  const startDate = dateValues[0] ?? undefined;
  const endDate = dateValues[dateValues.length - 1] ?? undefined;

  return {
    id: commitResult.importId,
    sourceLabel: committedSourceLabel,
    sourceType: statementImportMeta.sourceType,
    parserKey: statementImportMeta.parserKey,
    importedAt: new Date().toISOString(),
    status: "completed",
    transactionCount: commitResult.importedRows ?? rowsToCommit.length,
    startDate,
    endDate,
    accountNames,
    overlapImportCount: 0,
    overlapImports: [],
    statementCertificateCount: statementCheckpoints.length,
    statementCertificateStatus: statementCheckpoints.length ? "certified" : undefined,
    rollbackProtected: false,
    note: importNote?.trim() || undefined
  };
}

function inferStatementAccountKind(accountName, parserKey) {
  return /credit_card|cashback|rewards|miles|card/i.test(parserKey) || /card|cashback|rewards|miles/i.test(accountName)
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

  if (checkpoint.previousBalanceMinor != null) {
    return Number(checkpoint.previousBalanceMinor);
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
      Number(checkpoint.statementBalanceMinor ?? 0),
      Number(checkpoint.previousBalanceMinor ?? 0)
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

function applyStatementAccountMatches(statementCheckpoints, matches) {
  if (!matches?.length) {
    return statementCheckpoints;
  }
  let changed = false;
  const next = statementCheckpoints.map((checkpoint) => {
    const detectedAccountName = checkpoint.detectedAccountName ?? checkpoint.accountName;
    const match = !checkpoint.accountId && matches.find((item) => item.detectedAccountName === detectedAccountName);
    if (!match) {
      return checkpoint;
    }
    changed = true;
    return { ...checkpoint, detectedAccountName, accountId: match.accountId, accountName: match.accountName };
  });
  return changed ? next : statementCheckpoints;
}
