import { useEffect, useMemo, useRef, useState } from "react";

import { messages } from "./copy/en-SG";
import {
  ImportRecentHistorySection,
  RECENT_IMPORTS_PAGE_SIZE
} from "./import-history";
import { ImportPreviewReview } from "./import-preview-review";
import {
  ImportMappingStage,
  ImportPreviewRowsTable,
  ImportSelectFileStage
} from "./import-stages";
import {
  buildMappedImportRows,
  buildRawImportRowFromPreviewRow,
  extractPdfText,
  getImportDirectOwnerForAccount,
  inferImportMapping
} from "./import-helpers";
import { inspectCsv } from "../lib/csv";
import { parseCurrentTransactionSpreadsheet, parseStatementText, statementRowsToCsv } from "../lib/statement-import";

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
  const [recentImportsOpen, setRecentImportsOpen] = useState(false);
  const [recentImportPage, setRecentImportPage] = useState(1);
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
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(preview?.unknownCategories?.length);
  const knownAccountNames = useMemo(() => new Set(accounts.map((account) => account.name)), [accounts]);
  const detectedPreviewAccountNames = useMemo(
    () => Array.from(new Set(previewRows.map((row) => row.accountName).filter(Boolean))).sort(),
    [previewRows]
  );
  const unknownPreviewAccountNames = useMemo(
    () => detectedPreviewAccountNames.filter((accountName) => !knownAccountNames.has(accountName)),
    [detectedPreviewAccountNames, knownAccountNames]
  );
  const showStatementAccountMapping = preview && detectedPreviewAccountNames.length > 0 && (
    statementImportMeta.sourceType === "pdf" || unknownPreviewAccountNames.length > 0
  );
  const hasUnmappedAccounts = previewRows.some((row) => !row.accountName || !knownAccountNames.has(row.accountName));
  const duplicateCheckpointAccounts = useMemo(() => {
    const counts = new Map();
    for (const checkpoint of statementCheckpoints) {
      if (!checkpoint.accountName) {
        continue;
      }
      counts.set(checkpoint.accountName, (counts.get(checkpoint.accountName) ?? 0) + 1);
    }
    return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([accountName]) => accountName);
  }, [statementCheckpoints]);
  const hasDuplicateCheckpointAccounts = duplicateCheckpointAccounts.length > 0;
  const visibleOverlapImports = useMemo(
    () => (preview?.overlapImports ?? []).filter((item) => !dismissedOverlapIds.includes(item.id)),
    [dismissedOverlapIds, preview?.overlapImports]
  );
  const previewDuplicateRowCount = previewRows.filter((row) => row.duplicateMatches?.length).length;
  const statementReconciliations = preview?.statementReconciliations ?? [];
  const hasStatementReconciliationMismatch = statementReconciliations.some((item) => item.status !== "matched");
  const isCommitDisabled = isSubmitting
    || isParsingStatement
    || !previewRows.length
    || hasUnmappedAccounts
    || hasBlockingCategoryPolicy
    || hasDuplicateCheckpointAccounts;
  const hasImportDraft = Boolean(
    preview
    || previewRows.length
    || csvText
    || importNote
    || statementCheckpoints.length
    || uploadStatus
    || previewError
    || sourceLabel !== "Imported CSV"
  );
  const recentImportPageCount = Math.max(1, Math.ceil(importsPage.recentImports.length / RECENT_IMPORTS_PAGE_SIZE));
  const paginatedRecentImports = useMemo(() => {
    const startIndex = (recentImportPage - 1) * RECENT_IMPORTS_PAGE_SIZE;
    return importsPage.recentImports.slice(startIndex, startIndex + RECENT_IMPORTS_PAGE_SIZE);
  }, [importsPage.recentImports, recentImportPage]);
  const recentImportStart = importsPage.recentImports.length
    ? ((recentImportPage - 1) * RECENT_IMPORTS_PAGE_SIZE) + 1
    : 0;
  const recentImportEnd = Math.min(recentImportPage * RECENT_IMPORTS_PAGE_SIZE, importsPage.recentImports.length);
  const recentImportGroups = useMemo(() => {
    const grouped = new Map();
    for (const item of paginatedRecentImports) {
      const dateKey = item.importedAt.slice(0, 10);
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey).push(item);
    }
    return Array.from(grouped.entries()).map(([date, items]) => ({ date, items }));
  }, [paginatedRecentImports]);

  useEffect(() => {
    setRecentImportPage((current) => Math.min(Math.max(current, 1), recentImportPageCount));
  }, [recentImportPageCount]);

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

        setSourceLabel(parsed.sourceLabel);
        setStatementCheckpoints(parsed.checkpoints);
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
          nextStatementCheckpoints: parsed.checkpoints
        });
        setUploadStatus({ tone: "success", message: messages.imports.uploadReady(parsed.rows.length) });
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
    const response = await fetch("/api/imports/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceLabel: nextSourceLabel,
        rows,
        defaultAccountName: nextDefaultAccountName,
        ownershipType,
        ownerName,
        splitBasisPoints: Math.round(Number(splitPercent || "50") * 100),
        statementCheckpoints: nextStatementCheckpoints.map((checkpoint) => ({
          ...checkpoint,
          statementBalanceMinor: Number(checkpoint.statementBalanceMinor ?? 0)
        }))
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setPreview(null);
      setPreviewRows([]);
      throw new Error(data.error ?? "Import preview failed.");
    }
    setDismissedOverlapIds((current) => current.filter((id) => data.preview?.overlapImports?.some((item) => item.id === id)));
    setPreview(data.preview);
    setPreviewRows(data.preview?.previewRows ?? []);
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
    if (!previewRows.length) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/imports/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceLabel: preview?.sourceLabel ?? sourceLabel,
          sourceType: statementImportMeta.sourceType,
          parserKey: statementImportMeta.parserKey,
          note: importNote,
          statementCheckpoints: statementCheckpoints.map((checkpoint) => ({
            ...checkpoint,
            statementBalanceMinor: Number(checkpoint.statementBalanceMinor ?? 0)
          })),
          rows: previewRows.map((row) => ({
            ...row,
            splitBasisPoints: Number(row.splitBasisPoints ?? 10000)
          }))
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPreviewError(data.error ?? messages.imports.commitFailed);
        return;
      }
      resetImportForm();
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRollback(importId) {
    setIsSubmitting(true);
    try {
      await fetch("/api/imports/rollback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ importId })
      });
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function updatePreviewRow(rowId, patch) {
    const duplicateKeyFields = ["date", "description", "amountMinor", "entryType", "transferDirection", "accountName"];
    const shouldClearDuplicateMatches = duplicateKeyFields.some((field) => Object.prototype.hasOwnProperty.call(patch, field));
    setPreviewRows((current) => current.map((row) => (
      row.rowId === rowId
        ? { ...row, ...patch, duplicateMatches: shouldClearDuplicateMatches ? undefined : row.duplicateMatches }
        : row
    )));
  }

  function removePreviewRow(rowId) {
    setPreviewRows((current) => current
      .filter((row) => row.rowId !== rowId)
      .map((row, index) => ({ ...row, rowIndex: index + 1 })));
  }

  function getPreviewAccountOwnerPatch(accountName, row) {
    if (row.ownershipType !== "direct") {
      return {};
    }

    const nextOwnerName = getImportDirectOwnerForAccount(accounts, people, accountName, row.ownerName ?? ownerName);
    return nextOwnerName ? { ownerName: nextOwnerName } : {};
  }

  function updateStatementCheckpoint(index, patch) {
    setStatementCheckpoints((current) => current.map((checkpoint, checkpointIndex) => (
      checkpointIndex === index ? { ...checkpoint, ...patch } : checkpoint
    )));
  }

  function remapPreviewAccount(fromAccountName, toAccountName) {
    if (!toAccountName) {
      return;
    }

    const nextRows = previewRows.map((row) => (
      row.accountName === fromAccountName
        ? { ...row, accountName: toAccountName, ...getPreviewAccountOwnerPatch(toAccountName, row) }
        : row
    ));
    const nextCheckpoints = statementCheckpoints.map((checkpoint) => (
      checkpoint.accountName === fromAccountName ? { ...checkpoint, accountName: toAccountName } : checkpoint
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
          {hasImportDraft ? (
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
            accounts={accounts}
            knownAccountNames={knownAccountNames}
            detectedPreviewAccountNames={detectedPreviewAccountNames}
            unknownPreviewAccountNames={unknownPreviewAccountNames}
            unknownCategoryMode={unknownCategoryMode}
            showStatementAccountMapping={showStatementAccountMapping}
            visibleOverlapImports={visibleOverlapImports}
            previewDuplicateRowCount={previewDuplicateRowCount}
            statementReconciliations={statementReconciliations}
            hasStatementReconciliationMismatch={hasStatementReconciliationMismatch}
            statementCheckpoints={statementCheckpoints}
            hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
            duplicateCheckpointAccounts={duplicateCheckpointAccounts}
            isSubmitting={isSubmitting}
            onRemapPreviewAccount={remapPreviewAccount}
            onDismissOverlap={(importId) => setDismissedOverlapIds((current) => [...new Set([...current, importId])])}
            onRefreshStatementReconciliation={handleRefreshStatementReconciliation}
            onUpdateStatementCheckpoint={updateStatementCheckpoint}
          />

          {previewRows.length ? (
            <ImportPreviewRowsTable
              previewRows={previewRows}
              accounts={accounts}
              categories={categories}
              people={people}
              knownAccountNames={knownAccountNames}
              isCommitDisabled={isCommitDisabled}
              onCommit={handleCommit}
              onUpdatePreviewRow={updatePreviewRow}
              onRemovePreviewRow={removePreviewRow}
              getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
            />
          ) : (
            <p className="lede compact">{messages.imports.previewEmpty}</p>
          )}
        </div>
      </section>

      <ImportRecentHistorySection
        recentImports={importsPage.recentImports}
        recentImportGroups={recentImportGroups}
        recentImportsOpen={recentImportsOpen}
        recentImportPage={recentImportPage}
        recentImportPageCount={recentImportPageCount}
        recentImportStart={recentImportStart}
        recentImportEnd={recentImportEnd}
        onToggleOpen={() => setRecentImportsOpen((current) => !current)}
        onPreviousPage={() => setRecentImportPage((current) => Math.max(1, current - 1))}
        onNextPage={() => setRecentImportPage((current) => Math.min(recentImportPageCount, current + 1))}
        onRollback={handleRollback}
      />
    </article>
  );
}
