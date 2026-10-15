// Imports page copy. It ships with the routes that show it, not with the
// first screen: src/client/copy/en-SG.js holds the copy every page needs.
import { countOf, listOf } from "./wording";

export const importMessages = {
  viewing: (label) => `Viewing imports for ${label}`,
  transactionCount: (count) => countOf(count, "transaction"),
  // An investment statement import that added no rows of its own.
  recentValueSaved: (count) => `${countOf(count, "statement value")} saved`,
  inboxTitle: "Import inbox",
  inboxDetail: "The app plans the bank run. Log into one bank, collect the listed files, then drop them here. No renaming needed.",
  inboxSummaryLabel: "Import inbox status",
  inboxMetricBankSessions: "Bank sessions",
  inboxMetricBankSessionsValue: (count) => `${count} to open`,
  inboxMetricRequiredFiles: "Needed files",
  inboxMetricRequiredFilesValue: (count) => `${count} required`,
  inboxMetricAccounts: "Accounts current",
  inboxMetricAccountsValue: (current, total) => `${current} of ${total}`,
  inboxMetricCleanup: "Cleanup",
  inboxMetricCleanupValue: (count) => count ? countOf(count, "split link") : "Clear",
  inboxGuidance: (fileCount, institutionCount) => `Collect ${fileCount} required file${fileCount === 1 ? "" : "s"} across ${institutionCount} bank login session${institutionCount === 1 ? "" : "s"}. Download order is by bank; review order is handled below.`,
  inboxCurrentGuidance: "Bank files look current. Optional activity exports can still refresh the working ledger.",
  inboxNeedsFiles: (count) => `${count} needed`,
  inboxOptionalFiles: (count) => `${count} optional`,
  inboxAllCurrent: "Current",
  inboxSessionDetail: (requiredCount, optionalCount) => {
    const required = `${requiredCount} required`;
    const optional = optionalCount ? `, ${optionalCount} optional` : "";
    return `${required}${optional}`;
  },
  inboxSessionNeedsFiles: "Need files",
  inboxSessionOptional: "Optional",
  inboxOpenPortal: "Open portal",
  inboxOptionalSection: (count) => `${count} optional activity export${count === 1 ? "" : "s"}`,
  inboxFileDetail: (detail, fileTypes) => `${detail} Supported: ${fileTypes}.`,
  inboxFileOwner: (ownerLabel) => `Owner: ${ownerLabel}`,
  inboxAccountGroupDetail: ({ institution, coveredAccountNames, fileCount, fileTypes }) => {
    const covers = coveredAccountNames.length > 1
      ? `One ${institution} statement covers ${coveredAccountNames.slice(0, -1).join(", ")} and ${coveredAccountNames.at(-1)}. `
      : "";
    const download = fileCount === 1
      ? `Download this PDF statement while signed in to ${institution}.`
      : `Download each month's PDF statement while signed in to ${institution}.`;
    return `${covers}${download} Supported: ${fileTypes}.`;
  },
  inboxUseFile: "Use with import form",
  inboxNotAvailable: "Not available",
  inboxSnoozed: "Paused for a few days because the bank has not published it yet.",
  inboxReviewOrderTitle: "Review order",
  inboxReviewOrderDetail: "After files are dropped, statements should close oldest month first. Optional activity comes after statements.",
  inboxReviewOrderItemBody: (accountName, ownerLabel, priority) => `${accountName} • ${ownerLabel}${priority === "optional" ? " activity" : " statement"}`,
  inboxCleanupTitle: "After bank files",
  inboxCurrentAccounts: (count) => `${count} current bank session${count === 1 ? "" : "s"}`,
  inboxStillMissing: (missingCount, requiredCount) => `Still missing: ${missingCount} of ${requiredCount}`,
  inboxShow: "Show",
  inboxHide: "Hide",
  intakeParsing: (count) => `Reading ${countOf(count, "file")} in this browser. Original files are not stored.`,
  intakeReady: (count) => `${count} file${count === 1 ? "" : "s"} added to the intake queue.`,
  intakeFailed: "Could not add files to the intake queue.",
  intakeTitle: "File intake queue",
  intakeDetail: "Files stay in this browser only. Review them one at a time, in the order shown.",
  intakeEmptyTitle: "Drop all downloaded bank files together.",
  intakeEmptyDetail: "Filename format is not required. The app reads parsed content in this browser, suggests the matching checklist item, flags duplicates, and does not store original files.",
  intakeClear: "Clear queue",
  intakeSummary: ({ total, ready, ambiguous, unexpected, duplicate }) => [
    countOf(total, "file"),
    ready ? `${ready} ${ready === 1 ? "matches a file" : "match files"} you need` : "",
    ambiguous ? `${ambiguous} ${ambiguous === 1 ? "needs" : "need"} the account or month confirmed` : "",
    unexpected ? `${unexpected} not on your checklist` : "",
    duplicate ? `${duplicate} ${duplicate === 1 ? "looks" : "look"} like a copy` : ""
  ].filter(Boolean).join(" · "),
  intakeSourceKind: {
    card_statement: (bank) => `${bank} card statement`,
    account_statement: (bank) => `${bank} account statement`,
    card_activity: (bank) => `${bank} card activity export`,
    account_activity: (bank) => `${bank} account activity export`,
    csv: () => "CSV file"
  },
  intakeRowDetail: ({ sourceKind, month, cardCount, rowCount }) => [
    sourceKind,
    month,
    cardCount > 1 ? countOf(cardCount, "card") : "",
    countOf(rowCount, "row")
  ].filter(Boolean).join(" · "),
  intakeMatched: "Matches a file you need.",
  intakeAmbiguous: "Check which account or month this is during review.",
  intakeUnexpected: "Not on your checklist; you can still review it.",
  intakeUnknown: "You'll match its columns during review.",
  intakeDuplicate: "Looks like a copy of another file in this queue.",
  intakeLoad: "Review",
  intakeReviewFirst: "Review this first: statements before activity, older months first.",
  intakeInReview: "In review below.",
  intakeCoverage: ({ coveredCount, rowCount, statementLabel }) => `${coveredCount} of ${countOf(rowCount, "row")} ${coveredCount === 1 ? "is" : "are"} on ${statementLabel} in this queue.`,
  intakeRemove: "Remove",
  composerTitle: "Import and certify",
  composerDetail: "Paste or upload a CSV, upload a supported PDF statement, or upload a supported current-transaction XLS. PDF statements certify the period like a bank sync; mid-cycle files keep the working ledger current.",
  stepsLabel: "Import steps",
  steps: ["Select file", "Data mapping", "Review"],
  selectFileTitle: "Select file",
  selectFileDetail: "Choose one CSV, supported PDF statement, or supported current-transaction XLS and set the defaults that should apply before row-level review.",
  selectFileNextPaste: "After pasting CSV rows, review the mapping step below.",
  selectFileNextUpload: "PDF statements and supported current-transaction XLS files are converted into reviewable rows. If a supported PDF is image-only, the app runs private in-browser OCR automatically. Pasting CSV works directly in the text box.",
  sourceLabel: "Source label",
  sourceLabelPlaceholder: "October UOB export",
  importNote: "Batch note",
  importNotePlaceholder: "Optional note for this import batch.",
  pasteRowsOrDefaults: "Paste rows or set defaults",
  pageDropHint: "Drop files anywhere on this page",
  csvInput: "CSV content",
  csvScreenedWhileHidden: "Raw source data is screened while money is hidden. You can still paste or drop a file; reveal money only when you need to inspect it.",
  csvPlaceholder: "Paste CSV rows here, or upload a CSV/PDF/XLS below.",
  uploadFile: "Upload CSV, PDF, or XLS",
  dropzoneTitle: "Drop a CSV, PDF, or XLS here",
  dropMoreFiles: "Drop more files, or",
  dropzoneDetail: "Click to browse, or drag a supported statement or current-transaction export onto this area.",
  uploadStatusWorking: "Working",
  uploadStatusReady: "Ready",
  uploadStatusWaiting: "Waiting for review",
  uploadStatusError: "Import needs attention",
  uploadReading: (fileName) => `Reading ${fileName}.`,
  uploadExtracting: (fileName) => `Extracting text from ${fileName}.`,
  uploadOcr: (fileName) => `This PDF is image-only. Running private OCR in this browser for ${fileName}.`,
  uploadOcrProgress: ({ fileName, pageNumber, pageCount, status, progress }) => {
    const pageText = pageNumber && pageCount ? ` Page ${pageNumber} of ${pageCount}.` : "";
    const progressText = typeof progress === "number" && Number.isFinite(progress) ? ` ${Math.round(progress * 100)}%.` : "";
    return `Running private OCR in this browser for ${fileName}.${pageText} ${status ?? "Working"}.${progressText}`;
  },
  uploadParsing: (fileName) => `Parsing import rows from ${fileName}.`,
  uploadPreviewing: (count) => `Preparing preview for ${count} detected row${count === 1 ? "" : "s"}.`,
  uploadReady: (count) => `${count} row${count === 1 ? "" : "s"} ready for review.`,
  uploadStatementReady: (rowCount, accountCount) => `${rowCount} row${rowCount === 1 ? "" : "s"} ready for review across ${accountCount} statement account${accountCount === 1 ? "" : "s"}.`,
  uploadCsvReady: (fileName) => `${fileName} is loaded. Review the mapping below.`,
  defaultAccount: "Default account",
  owner: "Default owner",
  defaultsHint: "These top fields are fallbacks. Rows use the mapped account owner when one exists, and you can still adjust account, owner, type, amount, category, and note per row before commit.",
  trustHint: "Statement imports are only trustworthy when date coverage is complete and overlapping exports are reviewed.",
  mappingTitle: "Data mapping",
  mappingDetail: (count) => `Map the detected headers and review ${count} sample row${count === 1 ? "" : "s"}.`,
  nonExistingCategories: "Non-existing categories",
  categoryFallbackOther: "Categorize as Other",
  categoryFallbackBlock: "Block until mapped",
  missingRequired: (fields) => `Missing required fields: ${fields}`,
  duplicateMappings: (fields) => `Mapped twice: ${fields}`,
  mappingReady: "Mapping ready",
  sampleRows: "Sample rows",
  mappingNext: "When the mappings look right, click Preview import.",
  openErrorDiagnostics: "Open error diagnostics",
  preview: "Preview import",
  commit: "Commit import to ledger",
  // Every row is already in the ledger: the commit only saves each card's
  // statement balance and dates. "Again" when this statement was saved
  // before, which adds nothing but a second import.
  saveStatementBalance: "Save statement balance",
  saveStatementAgain: "Save it again anyway",
  saveEmptyStatementCheckpoint: "Save empty statement checkpoint",
  saveInvestmentValue: "Save statement value",
  certifyMatchedEntries: (count) => `Certify ${countOf(count, "matched entry", "matched entries")}`,
  commitFailed: "Import commit failed. No partial transactions were kept.",
  clearPreview: "Clear preview",
  startOver: "Start over",
  unknownAccounts: "Unknown accounts need mapping before commit.",
  accountMappingTitle: "Statement account mapping",
  accountMappingDetail: "Match each detected statement account to the account that should receive these rows and checkpoints.",
  detectedAccount: (accountName) => `Detected: ${accountName}`,
  chooseAccount: "Choose account",
  createDetectedAccount: "Create account",
  accountMappingRefreshing: "Refreshing preview after account mapping.",
  accountMappingRefreshed: "Preview refreshed with the selected account mapping.",
  accountCreatedFromStatement: (accountName) => `Created ${accountName} and mapped the statement rows.`,
  unknownCategories: "Unknown categories were found in the CSV.",
  categoryFallbackHelp: "Unknown categories will be normalized to Other for preview and commit.",
  categoryFallbackBlocked: "Unknown categories must be mapped or cleaned before this import can be committed.",
  previewEmpty: "No preview yet.",
  previewRows: "Preview rows",
  previewReady: "Preview ready. Matching rows can be reconciled in place before commit instead of creating duplicate ledger entries.",
  largeImportNotice: (count) => `Large import: ${count} rows. The commit saves every row or none of them. If Cloudflare rejects it, nothing is saved; split the file into smaller batches and try again.`,
  reconciliationCandidates: (count) => `${countOf(count, "entry reconciliation match", "entry reconciliation matches")} ${count === 1 ? "needs" : "need"} a decision`,
  reconciledExistingRows: (count, sourceType) => sourceType === "pdf"
    ? `${count} provisional row${count === 1 ? "" : "s"} will be certified by the statement`
    : `${countOf(count, "existing entry", "existing entries")} will be updated by this import`,
  overlappingImports: (count) => `${count} prior import${count === 1 ? "" : "s"} in this account period`,
  exceptionRegisterTitle: "Exceptions to resolve",
  exceptionRegisterDetail: "The app will handle matched statement rows automatically. These are the remaining controls that need attention before the period can close.",
  exceptionKinds: {
    unknown_account: (count) => `${count} account mapping issue${count === 1 ? "" : "s"}`,
    unknown_category: (count) => `${count} category issue${count === 1 ? "" : "s"}`,
    review_rows: (count) => `${count} row decision${count === 1 ? "" : "s"}`,
    statement_mismatch: (count) => `${count} statement mismatch${count === 1 ? "" : "es"}`,
    account_identity: (count) => `${count} account identity proof${count === 1 ? "" : "s"}`,
    entry_reconciliation: (count) => `${count} entry reconciliation exception${count === 1 ? "" : "s"}`,
    prior_import_context: (count) => `${count} prior import context item${count === 1 ? "" : "s"}`,
    statement_chain_gap: (count) => `${count} missing statement chain gap${count === 1 ? "" : "s"}`
  },
  previewGuardrailsLabel: "Import preview checks",
  previewCommitSummaryLabel: "Import commit summary",
  previewCoverage: (start, end) => `Preview coverage ${start} - ${end}`,
  noLongerListedTitle: (count, accountNames) => `${accountNames} no longer lists ${count === 1 ? "1 entry" : `${count} entries`} from an earlier import`,
  noLongerListedDetail: (count) => (count === 1
    ? "This file covers its date but doesn't include it, so the bank dropped it, usually a pending hold it released. Importing removes it; rolling this import back brings it back."
    : "This file covers their dates but doesn't include them, so the bank dropped them, usually pending holds it released. Importing removes them; rolling this import back brings them back."),
  noLongerListedKeptDetail: (count) => (count === 1
    ? "This file covers its date but doesn't include it. You chose to keep it, so importing leaves it as it is."
    : "This file covers their dates but doesn't include them. You chose to keep them, so importing leaves them as they are."),
  noLongerListedListLabel: "Entries the bank no longer lists",
  noLongerListedKeep: (count) => (count === 1 ? "Keep this entry" : "Keep these entries"),
  unlistedEstimateTitle: (originalAmount, walletDescription, accountName) => `Your estimate for ${originalAmount} (${walletDescription}) matched a charge ${accountName} no longer lists`,
  unlistedEstimateDetail: (restoredAmount, hasCandidates) => hasCandidates
    ? `The card's row it was matched to isn't in this file, usually a hold the bank released. Pick the card's final charge for this purchase, or leave it and the estimate goes back to ${restoredAmount}.`
    : `The card's row it was matched to isn't in this file, usually a hold the bank released. Importing puts the estimate back to ${restoredAmount}.`,
  unlistedEstimateSamePurchase: (date, description, amount) => `Same purchase: ${date} · ${description} · ${amount}`,
  unlistedEstimateNotInFile: (restoredAmount) => `Not in this file: put the estimate back to ${restoredAmount}`,
  unlistedEstimateLinkedReason: (originalAmount, fromAmount, toAmount) => `Updates your estimate for ${originalAmount} from ${fromAmount} to the card's ${toAmount}.`,
  willReopenEstimates: (count) => `${countOf(count, "estimate")} will go back to ${count === 1 ? "its" : "their"} saved amount`,
  previewOverlapTitle: "Prior import context",
  previewOverlapScopeAriaLabel: "How overlap checks work",
  previewOverlapScopeTitle: "Scope",
  previewOverlapScopeDetail: "The overlap check is account-aware and import-aware.",
  previewOverlapScopeItems: [
    "It checks against all completed historical imports.",
    "It only checks accounts present in the current preview, after account mapping.",
    "If a PDF contains multiple account sections, it can detect overlaps for any of those mapped accounts.",
    "It does not compare against unrelated accounts.",
    "It ignores draft and rolled-back imports."
  ],
  previewOverlapDetail: "Earlier imports in the same account period can be normal when mid-cycle activity already exists. Statement-certified rows are handled automatically; use this section only for unresolved exceptions.",
  previewOverlapActionTitle: "What to do",
  previewOverlapActions: ({ skippedPreviewRowCount, needsReviewPreviewRowCount, hasStatementReconciliationMismatch, hasStatementReconciliations }) => {
    const actions = [
      "Use the entries below as context for earlier committed ledger rows inside this statement's date range."
    ];
    if (needsReviewPreviewRowCount) {
      actions.push("Resolve rows still marked Needs review before committing.");
    } else if (skippedPreviewRowCount) {
      actions.push("Rows listed as already covered can stay out of the import unless the statement check shows the ledger is missing them.");
    } else {
      actions.push("If there are no unresolved rows, this is context rather than a blocker.");
    }
    if (hasStatementReconciliations) {
      actions.push(hasStatementReconciliationMismatch
        ? "Do not commit yet if the statement certification check is still mismatched. Fix account mapping, missing rows, or row direction first."
        : "When the statement certification check is matched, mark the context Reviewed and commit.");
    } else {
      actions.push("Mark the context Reviewed after the preview rows match what should be added to the ledger.");
    }
    return actions;
  },
  previewOverlapMismatchExplained: (amount) => `The statement difference is exactly ${amount}, which matches the overlapping entries below. That usually means a prior import is on this account but is not part of this statement. Check whether that earlier import belongs to another card account, then roll it back or remap before committing this statement.`,
  previewOverlapEntriesLabel: "Already committed overlapping entries",
  dismissOverlap: "Reviewed",
  statementReconciliationTitle: "Statement certification check",
  statementReconciliationMatchedDetail: "The preview reconciles to the official statement balance. Matching provisional rows will be certified without changing user annotations.",
  statementReconciliationMismatchDetail: "The statement cannot close yet. Check account mapping, missing or extra rows, row direction, or account identity before committing.",
  statementReconciliationRefresh: "Refresh check",
  // Import steps: bring files, review one, see what changed.
  stageStepsLabel: "Import steps",
  stageNumbered: (number, label) => `${number} · ${label}`,
  stageBring: "Bring files",
  stageReview: "Review",
  stageDone: "Done",
  stageDoneMark: "done",
  stageReviewSummary: "Check each card and approve fixes",
  stageDoneSummary: "What changed, with rollback",
  stageBringSummary: (queued) => queued ? `${countOf(queued, "file")} in your queue` : "Choose or drop the files you downloaded",
  stageChangeFiles: "Change",
  stageHideFiles: "Hide files",
  // The import bar: the steps, this batch's files and what blocks a
  // clean commit of the file in review.
  batchBarLabel: "Import progress",
  batchFilesLabel: "Files in this import",
  batchFilesRowLabel: "Your files:",
  batchFileStateReviewing: "reviewing",
  batchFileStateWaiting: "waiting",
  batchFilePosition: (index, total) => `File ${index} of ${total}`,
  batchFileDone: (label) => `${label}, done`,
  batchStatementLabel: (name, month) => `${name} ${month}`,
  batchManyCardsLabel: (bank, month) => `${bank} cards ${month}`,
  batchManyAccountsLabel: (bank, month) => `${bank} accounts ${month}`,
  batchActivityLabel: (bank) => `${bank} activity`,
  batchFileFallback: "File",
  batchSwitchWarning: (label) => `Opening ${label} drops your changes to this file.`,
  batchSwitchConfirm: "Open anyway",
  batchSwitchCancel: "Cancel",
  blockersTitle: "Before you can commit:",
  blockersLabel: "What to fix before committing",
  blockerMapAccounts: (count) => `Map ${countOf(count, "account")}`,
  blockerCardOff: (card, amount) => `${card} off by ${amount}`,
  blockerCardImportFirst: (card, months) => `${card}: import ${months} first`,
  blockerCardNoMatch: (card) => `${card} doesn't match`,
  blockerRowsToCheck: (count) => `${countOf(count, "row")} to check`,
  blockerRowsMatched: (count) => `${countOf(count, "row")} matched`,
  blockerCardAccounts: "Give each card its own account",
  blockerUnknownCategories: (count) => `Map ${countOf(count, "category", "categories")}`,
  blockerRefreshCheck: "Refresh the statement check",
  blockerOcrRecovery: "Make the rows add up to the statement",
  statementRecoveryTitle: "The rows don't add up to the statement yet",
  statementRecoveryPurchases: "Statement purchases",
  statementRecoveryCredits: "Statement payments and credits",
  statementRecoveryFound: "Rows found",
  statementRecoveryDifference: "Difference",
  statementRecoveryLeftover: "Possible missing row",
  statementRecoveryUnread: "Amount not readable",
  statementRecoveryNoDescription: "No readable description",
  statementRecoveryAmountLabel: (description) => `Amount for ${description || "this row"} from the PDF`,
  statementRecoveryAddRow: "Add row",
  statementRecoveryHelp: "Check each row against page 1 of the PDF. If an amount was misread, correct it in Edit rows. Nothing has been saved, and the import stays blocked until the rows add up.",
  statementRecoveryAdding: "Adding the row and checking the statement again.",
  statementRecoveryAdded: "Row added. Check the statement again before you commit.",
  blockerNothingToImport: "Include at least 1 row",
  blockerMapColumn: (field) => field === "amount/expense/income" ? "Map an amount column" : `Map the ${field} column`,
  blockerDuplicateColumn: (field) => `Map ${field} to one column only`,
  blockerThingsLeft: (count) => `${countOf(count, "thing")} left`,
  blockerJumpNext: "Jump to next",
  blockerJumpKeys: "Next: J · Previous: K",
  // Moving through the batch from the commit bar.
  commitAndOpenNext: "Commit and open next",
  saveStatementBalanceAndOpenNext: "Save statement balance and open next",
  saveInvestmentValueAndOpenNext: "Save statement value and open next",
  certifyAndOpenNext: "Certify and open next",
  skipForNow: "Skip for now",
  doneTitle: (title) => `${title} saved`,
  doneAllBalanced: "Every card balanced",
  doneSavedWithDifference: (count) => `${countOf(count, "card")} saved with a difference`,
  doneCardBalance: (balance, balanced) => balanced ? `${balance}, matches the statement` : `${balance} on the statement, saved with a difference`,
  doneOwed: (amount) => `Owed ${amount}`,
  doneCredit: (amount) => `Credit ${amount}`,
  doneBalance: (amount) => `Balance ${amount}`,
  doneCardDetail: ({ added, confirmed, moved, later, removed }) => [
    `${countOf(added, "row")} added`,
    `${countOf(confirmed, "entry", "entries")} confirmed`,
    moved ? `${countOf(moved, "entry", "entries")} moved here` : "",
    removed ? `${countOf(removed, "entry", "entries")} not on the statement removed` : "",
    later ? `${countOf(later, "entry", "entries")} ${later === 1 ? "stays" : "stay"} for the next statement` : ""
  ].filter(Boolean).join(" · "),
  doneRowsDetail: ({ added, confirmed, removed }) => `${countOf(added, "row")} added · ${countOf(confirmed, "entry", "entries")} confirmed${removed ? ` · ${countOf(removed, "entry", "entries")} the bank no longer lists removed` : ""}`,
  // The Done card's plain answer: which file went where, for which period,
  // and whether anything is left to do.
  doneConfirmation: ({ fileName, accountNames, period, isStatement, unbalancedCount }) => {
    const into = accountNames.length ? ` into ${listOf(accountNames)}` : "";
    if (isStatement) {
      const forPeriod = period ? ` for the ${period} statement` : "";
      return unbalancedCount
        ? `The import of ${fileName}${into}${forPeriod} is saved. Check the ${unbalancedCount === 1 ? "card" : "cards"} saved with a difference.`
        : `The import of ${fileName}${into}${forPeriod} is done. No further action needed.`;
    }
    return `The import of ${fileName}${into}${period ? `, covering ${period},` : ""} is done. No further action needed.`;
  },
  // An investment statement saves what the account was worth, and maybe some
  // payments into it; the amount arrives already formatted (or hidden).
  doneInvestmentSaved: (accountName, amount, date) => `Saved ${accountName}'s value: ${amount} on ${date}`,
  doneInvestmentPayments: ({ added, paired }) => {
    if (!added) {
      return "";
    }
    const transfers = (count) => count === 1 ? "a bank transfer" : "bank transfers";
    if (paired === added) {
      return `${countOf(added, "payment")} added and paired with ${transfers(added)}`;
    }
    return `${countOf(added, "payment")} added${paired ? `, ${paired} paired with ${transfers(paired)}` : ""}`;
  },
  donePeriod: (start, end) => `${start} – ${end}`,
  doneRollback: "Roll back this import",
  doneClose: "Close",
  // Nothing waits: the import is saved and the form is empty, so this
  // leaves the summary for Bring files.
  doneImportAnother: "Import another file",
  doneReviewNext: (fileName) => `Review next: ${fileName}`,
  // Statement review: one statement, a section per card.
  statementKindCard: "card statement",
  statementKindAccount: "account statement",
  statementTitle: (bank, kind, month) => `${bank} ${kind} · ${month}`,
  statementReviewSubline: ({ endDate, startDate, cardCount, rowCount }) => [
    endDate ? `Statement date ${endDate}` : "",
    startDate && endDate ? `covers ${startDate} – ${endDate}` : "",
    countOf(cardCount, "card"),
    countOf(rowCount, "row")
  ].filter(Boolean).join(" · "),
  statementAllBalance: (count) => count === 1 ? "The card balances" : count === 2 ? "Both cards balance" : `All ${count} cards balance`,
  statementFixesReady: (count) => `A fix is ready for ${countOf(count, "entry", "entries")}`,
  statementCardsNeedYou: (count) => `${countOf(count, "card")} ${count === 1 ? "needs" : "need"} you`,
  statementCardStatus: {
    resolved: "Resolved",
    fix_ready: "Fix ready",
    partially_resolved: "Partially resolved",
    needs_manual_review: "Needs manual review",
    still_mismatched: "Still mismatched",
    unknown_account: "Choose an account",
    identity_unconfirmed: "Check the account",
    missing_prior_statement: "Earlier statement missing"
  },
  statementChangeAccounts: "Change card accounts",
  statementEditDetails: "Edit statement details",
  statementEditRows: "Edit rows",
  statementHideRowEditor: "Hide row editor",
  statementMoreChecks: "More checks",
  statementHowItAddsUp: "How the difference adds up",
  statementCardDifference: (amount, after) => after ? `difference ${amount} → ${after} after the fix` : `difference ${amount}`,
  statementAlreadyImported: (dateLabel, sourceLabel) => `Already imported on ${dateLabel} from ${sourceLabel}`,
  // Confirmed rows are the ones the ledger already has: a mid-cycle or
  // hand-entered entry this statement certifies, or a row an earlier
  // import of this statement covered.
  statementCardCounts: (added, confirmed) => `${countOf(added, "new row")} · ${confirmed ? confirmed : "none"} already in your ledger`,
  statementCardShow: "Show",
  statementCardHide: "Hide",
  statementCardRowsTitle: (count) => `Rows on this card's statement (${count})`,
  statementInferredAmount: "Amount from statement total",
  statementInferredAmountHint: "The scan couldn't read this amount, so it's the amount the statement total leaves. Check it against the PDF.",
  statementCardMoreRows: (count) => `Show ${countOf(count, "more row", "more rows")}`,
  statementCardFewerRows: "Show fewer rows",
  statementRowChip: {
    added: "New",
    confirms: (description) => description ? `Confirms ${description}` : "Confirms an entry",
    alreadyCovered: "Already in your ledger",
    leftOut: "Left out",
    needsReview: "Needs review"
  },
  // Statement fixes: the statement check's deterministic suggestions. They
  // name the rows and amounts; the import commit applies approved ones.
  statementFixMoveTitle: (count, toName) => `${countOf(count, "entry", "entries")} ${count === 1 ? "belongs" : "belong"} on ${toName}`,
  statementFixMoveDetail: ({ count, fromName, toName, amount, closes }) => amount
    ? `${count === 1 ? "It is" : "They are"} on ${fromName} in your ledger, but this statement lists ${count === 1 ? "it" : "them"} under ${toName}. Moving ${count === 1 ? "it" : "them"} takes ${amount} off ${fromName}'s difference${closes ? " and the statement closes" : ""}.`
    : `${count === 1 ? "It is" : "They are"} on ${fromName} in your ledger, but this statement lists ${count === 1 ? "it" : "them"} under ${toName}. Moving ${count === 1 ? "it" : "them"} stops a second copy being added to ${toName}.`,
  statementFixMoveAction: (count, toName) => count === 1 ? `Move it to ${toName}` : `Move ${count} entries to ${toName}`,
  statementFixMoveConfirmTitle: (count, toName) => `Move ${countOf(count, "entry", "entries")} to ${toName}?`,
  statementFixMoveConfirmDetail: (count, fromName, toName) => `${count === 1 ? "This entry is" : "These entries are"} on ${fromName} now. Moving ${count === 1 ? "it" : "them"} to ${toName} changes the totals of both cards. Nothing is saved until you commit the import, and Undo on the card takes the move back before then.`,
  statementFixMoveConfirm: (count) => count === 1 ? "Move entry" : "Move entries",
  statementFixMoveApplied: (count, toName) => `${countOf(count, "entry", "entries")} will move to ${toName} when you commit.`,
  statementFixDestinationNote: (count, fromName) => `${countOf(count, "row")} here ${count === 1 ? "is" : "are"} already in your ledger on ${fromName}. See the suggested move on ${fromName}.`,
  statementFixDeferTitle: (count) => `${countOf(count, "entry", "entries")} ${count === 1 ? "looks" : "look"} like the next statement's`,
  statementFixDeferDetail: ({ count, endDate, amount, closes }) => `${count === 1 ? "It has" : "They have"} no posted date yet and ${count === 1 ? "isn't" : "aren't"} on this statement, which closed on ${endDate}. Moving ${count === 1 ? "it" : "them"} to the next statement takes ${amount} off the difference${closes ? " and the statement closes" : ""}.`,
  statementFixDeferAction: (count) => count === 1 ? "Move it to the next statement" : `Move ${count} entries to the next statement`,
  statementFixDeferApplied: (count, date) => `${countOf(count, "entry", "entries")} will be marked as posted on ${date} when you commit.`,
  statementFixMoveOne: "Move it",
  statementFixApplyClear: (count) => count === 1 ? "Apply the clear one" : `Apply the ${count} clear ones`,
  statementFixKeep: "Keep as is",
  statementFixAutomatic: "Do this for me next time when the statement proves it",
  statementAutoApplied: (count) => `Fixes for ${countOf(count, "entry", "entries")} were applied for you because this statement proves them. Undo any of them on its card; nothing is saved until you commit.`,
  statementAskFirst: "Ask me first next time",
  statementFixUndo: "Undo",
  statementFixCheckThisOne: "Check this one",
  statementFixRowDates: (transactionDate, postedDate) => postedDate && postedDate !== transactionDate
    ? `Bought ${transactionDate}, posted ${postedDate}`
    : `Bought ${transactionDate}`,
  statementFixAlsoCheck: "Also check",
  statementBalanceOwed: (amount) => `${amount} owed`,
  statementBalanceInCredit: (amount) => `${amount} in credit`,
  statementFixExplanation: {
    duplicate_entry: (description, amount, otherName) => `${description} (${amount}) looks like a second copy of a purchase this statement already matched${otherName ? ` on ${otherName}` : ""}.`,
    amount_differs: (description, amount, statementAmount) => `${description} is ${amount} in your ledger but ${statementAmount} on the statement.`,
    not_on_statement: (description, amount) => `${description} (${amount}) isn't on this statement.`,
    excluded_statement_row: (description, amount) => `${description} (${amount}) is left out of this import.`,
    opening_balance_gap: (amount) => `The balance before this statement is off by ${amount}. An earlier statement may be missing, or an earlier entry is off.`,
    // The months between the last saved statement and this one have no
    // statement, so their rows never reached the ledger.
    opening_balance_missing_statements: (monthsLabel, count, lastStatementLabel, lastBalance, previousBalance) => (
      `Your ${monthsLabel} statement${count === 1 ? " isn't" : "s aren't"} imported yet. `
      + `Your ledger stops at the ${lastStatementLabel} statement${lastBalance ? ` (${lastBalance})` : ""}, and this statement starts from ${previousBalance}. `
      + `Import ${count === 1 ? "it" : "them"} first, then this one.`
    ),
    wrong_account: (description, amount, accountName) => `${description} (${amount}) on ${accountName} may be one of this statement's rows, but it can't be moved for you.`,
    next_statement: (description, amount) => `${description} (${amount}) may belong to the next statement.`
  },
  statementFixUnexplained: (amount) => `${amount} is still unexplained after these fixes.`,
  statementFixLaterEntries: (count) => `${countOf(count, "entry", "entries")} after this statement ${count === 1 ? "stays" : "stay"} provisional for the next one:`,
  // Wrong-card Apple Pay duplicates: an Apple Pay entry this card's file does
  // not list, whose purchase is a bank row on another card. The user decides;
  // nothing is removed until they confirm and commit.
  wrongCardListLabel: "Apple Pay entries that may be on the wrong card",
  wrongCardTitle: (count, accountName) => `${countOf(count, "Apple Pay entry", "Apple Pay entries")} on ${accountName} ${count === 1 ? "looks" : "look"} like ${count === 1 ? "a purchase" : "purchases"} paid with another card`,
  wrongCardDetail: ({ count, entryAccountName, twinAccountName, amount, isEarlierFile, fileDate }) => {
    const it = count === 1 ? "it" : "them";
    const fileClause = isEarlierFile
      ? `The file you imported for ${entryAccountName}${fileDate ? ` on ${fileDate}` : ""} doesn't list ${it}`
      : `This file doesn't list ${it} for ${entryAccountName}`;
    return `${fileClause}, but ${twinAccountName} does, so ${count === 1 ? "the purchase shows" : "the purchases show"} up twice. Removing ${it} takes ${amount} off ${entryAccountName} and leaves ${twinAccountName} as it is.`;
  },
  wrongCardEvidence: ({ twinAccountName, twinDescription, twinDate, isInThisFile, importedDate }) => isInThisFile
    ? `${twinAccountName} has ${twinDescription} on ${twinDate} in this file.`
    : `${twinAccountName} has ${twinDescription} on ${twinDate}${importedDate ? ` (imported ${importedDate})` : ""}.`,
  wrongCardRemoveAction: (accountName) => `Remove from ${accountName}`,
  wrongCardConfirmTitle: (count, accountName) => `Remove ${countOf(count, "entry", "entries")} from ${accountName}?`,
  wrongCardConfirmDetail: ({ count, entryAccountName, twinAccountName, amount }) => `${count === 1 ? "This purchase is" : "These purchases are"} on ${twinAccountName} already. Removing ${count === 1 ? "it" : "them"} takes ${amount} off ${entryAccountName} and leaves ${twinAccountName} as it is. Nothing is saved until you commit the import, Undo on the card takes the removal back before then, and rolling the import back brings ${count === 1 ? "it" : "them"} back.`,
  wrongCardConfirm: (count) => count === 1 ? "Remove entry" : "Remove entries",
  wrongCardApplied: (count, accountName) => `${countOf(count, "entry", "entries")} will be removed from ${accountName} when you commit.`,
  wrongCardCheckThisOne: ({ description, amount, entryAccountName, twinAccountName, twinDescription, twinDate, isLinked }) => `${description} ${amount} on ${entryAccountName} may be the same purchase as ${twinDescription} on ${twinAccountName} (${twinDate}). ${isLinked ? "It is linked to a split or a plan, so it stays until you unlink it." : "We aren't sure enough to offer removing it."}`,
  statementFixRejected: (reason) => `A fix you approved no longer applies, so it was left out: ${reason}`,
  commitStatementMismatchWarning: (accountNames) => `${accountNames} ${accountNames.includes(" and ") ? "don't" : "doesn't"} match the statement yet. Committing now saves the statement with a difference.`,
  commitStatementStaleWarning: "You changed rows after the statement check ran. Refresh the check before committing.",
  commitAnyway: "Commit anyway",
  commitSaveAgainWarning: (sourceLabel, dateLabel) => `This statement is already saved, from ${sourceLabel} on ${dateLabel}. Saving again adds a second import with no new rows.`,
  commitSaveAgain: "Save again",
  commitWarningCancel: "Cancel",
  statementReconciliationRefreshing: "Refreshing statement certification check.",
  statementReconciliationRefreshed: "Statement certification check refreshed.",
  statementReconciliationAccount: (accountName, month) => `${accountName} • ${month}`,
  statementCardEnding: (last4) => `ending ${last4}`,
  // The payment a card statement asks for.
  statementPaymentDue: (amount, dateLabel, minimum) => `Pay ${amount} by ${dateLabel}${minimum ? ` · minimum ${minimum}` : ""}`,
  statementPaymentDueNow: (amount) => `Pay ${amount} now`,
  // The bank's own charges on a statement card, and its notices.
  statementChargesTitle: "Bank charges on this statement",
  statementChargeKinds: {
    late_fee: "Late charge",
    interest: "Interest",
    annual_fee: "Annual fee",
    other_fee: "Other bank fees"
  },
  statementChargesReversed: (list) => `Reversed by the bank: ${list}`,
  statementNotices: {
    past_due: "The statement says this card is past due.",
    penalty_interest: (rate) => `The statement says this card is charged penalty interest of ${rate}% a year.`
  },
  statementReconciliationDelta: (amount) => `Difference ${amount}`,
  statementReconciliationBreakdownTitle: "Why this does not close",
  statementReconciliationMatchedBreakdownTitle: "Why this closes",
  statementReconciliationQuickFixTitle: "What to do first",
  statementReconciliationQuickFixIntroExact: (amount) => `This gap matches ${amount} already in the ledger for this statement period. Start there.`,
  statementReconciliationQuickFixIntroGeneric: "Open the red mismatch rows and compare them with the PDF.",
  statementReconciliationQuickFixStep1Exact: "Open 'Already in ledger during this period'.",
  statementReconciliationQuickFixStep1Generic: "Open the rows highlighted in red.",
  statementReconciliationQuickFixStep2: "Check the card, date, amount, and direction for each row.",
  statementReconciliationQuickFixStep3: "If a row is wrong, delete it, remap it, or change the posted date, then refresh the check.",
  statementReconciliationAuthority: "If the PDF is mapped to the correct card account, treat the PDF as the stronger bank record. The ledger rows listed here are not automatically certified yet; some may still be present on the PDF but need a unique match before committing.",
  statementReconciliationMatchedAuthority: "The PDF is mapped to this account and the projected ledger balance equals the official statement balance. The rows listed here are context: they show which PDF rows will certify existing ledger entries or which PDF-only rows will be added.",
  statementReconciliationResult: ({ projectedBalance, statementBalance, delta }) => (
    `After this preview, the ledger would show ${projectedBalance}. The PDF says ${statementBalance}. That leaves ${delta} to explain.`
  ),
  statementReconciliationMatchedResult: ({ projectedBalance, statementBalance }) => (
    `After this preview, the ledger would show ${projectedBalance}. The PDF also says ${statementBalance}. The statement is ready to close for this account.`
  ),
  statementReconciliationMovementLabels: {
    priorBalance: "Before statement period",
    existingRows: "Already in ledger during this period",
    includedRows: "PDF activity in this preview",
    supersededAdjustment: "Rows the PDF can remove",
    projectedBalance: "Projected ledger after preview"
  },
  statementReconciliationMovementHelp: {
    priorBalance: ({ startDate, endDate, value }) => (
      `This is the account balance before the statement window starts. For this statement, the window is ${startDate} to ${endDate}, so this box means the ledger balance before ${startDate}: ${value}. It is the starting point for the certification math.`
    ),
    existingRows: ({ startDate, endDate, value }) => (
      `These are ledger rows already saved in this account from ${startDate} to ${endDate} before this PDF preview is committed. They matter because they may duplicate, replace, or need to be certified by rows in the official PDF. Their net movement is ${value}.`
    ),
    includedRows: ({ startDate, endDate, value }) => (
      `These are the PDF rows currently included in this preview for ${startDate} to ${endDate}. The box shows the net movement those PDF rows would add to the ledger if committed: ${value}.`
    ),
    supersededAdjustment: ({ startDate, endDate, value }) => (
      `These are provisional ledger rows from ${startDate} to ${endDate} that this official PDF can replace or remove because the final statement does not support them. The box shows the balance effect of removing those provisional rows: ${value}.`
    ),
    projectedBalance: ({ startDate, endDate, value }) => (
      `This is the ledger balance the account would show after applying this preview for ${startDate} to ${endDate}. It should match the PDF statement balance before the statement can be certified. Projected result: ${value}.`
    )
  },
  statementReconciliationCausesTitle: "Recommended next checks",
  statementReconciliationExistingRowsTitle: "Ledger rows not automatically matched to this PDF",
  statementReconciliationExistingRowsDetail: "These were picked because they are already in this account's ledger inside the statement period but this preview has not certified them against a unique PDF row. Repeated same-merchant charges can appear here even when matching rows exist on the PDF. If a ledger row shows a posted date after the statement end, use the row actions to set the exact posted date or defer it to the next statement.",
  statementReconciliationExistingRowsSummary: ({ shown, total, amount }) => (
    shown < total
      ? `Showing ${shown} of ${total} unresolved ledger rows. Together these rows net to ${amount}; the visible rows are only a sample, so they will not add up to the full total.`
      : `Showing all ${total} unresolved ledger row${total === 1 ? "" : "s"}. Together these rows net to ${amount}.`
  ),
  statementReconciliationExistingRowsExactAction: (amount) => (
    `These unresolved ledger rows total ${amount}, which matches the unexplained difference. Correcting these rows should reconcile the statement, but correction does not always mean deletion. For credit cards, negative ledger expenses increase the owed balance; deleting one lowers owed by that amount, while replacing it with a different PDF amount changes owed only by the difference. Open each row in a new tab and compare it with the PDF: if the row is on this card's PDF, it should be matched or certified; if it is absent, duplicated, or on another card, delete it, remap it, or roll back the prior import.`
  ),
  statementReconciliationSkippedRowsTitle: "PDF rows not included yet",
  statementReconciliationSkippedRowsDetail: "These are official PDF rows currently skipped or needing review. Include or match them if they are real statement activity for this account.",
  statementReconciliationSkippedRowsSummary: ({ shown, total, amount }) => (
    shown < total
      ? `Showing ${shown} of ${total} PDF rows not included yet. Together these PDF rows net to ${amount}; the visible rows are only a sample, so they will not add up to the full total.`
      : `Showing all ${total} PDF row${total === 1 ? "" : "s"} not included yet. Together these PDF rows net to ${amount}.`
  ),
  statementReconciliationSkippedRowsExactAction: (amount) => (
    `These skipped PDF rows total ${amount}, which matches the unexplained difference. If they are real activity for this account, including or matching them should reconcile this statement. Compare them against the PDF, then include or match the rows in the preview before committing.`
  ),
  statementReconciliationMatchedRowsTitle: "PDF rows already matching ledger rows",
  statementReconciliationMatchedRowsDetail: "These PDF rows already found matching ledger rows. They do not need action unless you want to audit exactly which existing entries will be certified by this statement.",
  statementReconciliationMatchedRowsCollapsedSummary: ({ total, amount }) => `${total} PDF row${total === 1 ? "" : "s"} already match ledger rows. Net statement movement: ${amount}.`,
  statementReconciliationMatchedRowsSummary: ({ shown, total, amount, isMatched }) => {
    const auditContext = isMatched
      ? "This is audit context only; the statement already closes."
      : "This is context for rows that are already handled while you review the remaining mismatch.";
    return shown < total
      ? `Showing ${shown} of ${total} already-matched PDF rows. Their full net statement movement is ${amount}; the visible rows are only a sample. ${auditContext}`
      : `Showing all ${total} already-matched PDF row${total === 1 ? "" : "s"}. Their net statement movement is ${amount}. ${auditContext}`;
  },
  statementReconciliationLedgerDateDetail: "Date shown: transaction date from the ledger row.",
  statementReconciliationLedgerDualDateDetail: ({ transactionDate, postedDate }) => `Date shown: transaction date ${transactionDate}. Posted date saved on the ledger row: ${postedDate}.`,
  statementReconciliationLedgerPostedAfterCutoffDetail: ({ transactionDate, postedDate, statementEndDate }) => `Date shown: transaction date ${transactionDate}. Posted date saved on the ledger row: ${postedDate}. Because ${postedDate} is after the statement end ${statementEndDate}, this row belongs to the next statement unless the bank shows a different posted date.`,
  statementReconciliationStatementDateDetail: "Date shown: posted date from the PDF statement.",
  statementReconciliationStatementDualDateDetail: ({ postedDate, eventDate }) => `Date shown: posted date ${postedDate}. Event/transaction date found on the PDF row: ${eventDate}.`,
  openDiagnosticEntry: "Open",
  setDiagnosticPostDate: "Set posted date",
  setDiagnosticPostDateTitle: "Set posted date",
  setDiagnosticPostDateDetail: ({ statementEndDate }) => `Use this when the bank app shows a real posted date. The transaction date stays where it is for spending history, but statement checks will use the posted date. If the posted date is after ${statementEndDate}, this row will stop blocking this statement and can be checked against the next statement.`,
  setDiagnosticPostDateField: "Posted date",
  setDiagnosticPostDateConfirm: "Save posted date",
  setDiagnosticPostDateProgress: ({ description, postDate }) => `Saving posted date ${postDate} for ${description || "ledger row"} and refreshing statement check.`,
  setDiagnosticPostDateSuccess: ({ postDate }) => `Posted date ${postDate} saved. Statement check refreshed.`,
  setDiagnosticPostDateUnconfirmed: (message) => `Posted date save could not be confirmed, so the statement check was refreshed. If the row disappeared from this list or the statement now matches, the save probably completed. Original response: ${message}`,
  deferDiagnosticEntry: "Defer",
  deferDiagnosticEntryTitle: "Defer to next statement",
  deferDiagnosticEntryDetail: ({ statementEndDate, deferDate }) => `Use this when the row is legitimate, but the PDF statement ending ${statementEndDate} does not include it and you do not know the exact posted date yet. The app will set a provisional posted date of ${deferDate}, the first day after this statement, so this statement can close without deleting the row. If a later official PDF uniquely matches this row, the PDF will certify it and replace the provisional transaction and posted dates with the bank statement dates.`,
  deferDiagnosticEntryConfirm: "Defer row",
  deferDiagnosticEntryProgress: ({ description, deferDate }) => `Deferring ${description || "ledger row"} to posted date ${deferDate} and refreshing statement check.`,
  deferDiagnosticEntrySuccess: ({ deferDate }) => `Row deferred with posted date ${deferDate}. Statement check refreshed.`,
  deleteDiagnosticEntry: "Delete",
  deleteDiagnosticEntryConfirm: ({ date, description, amount }) => `Delete this ledger row now? ${date} • ${description} • ${amount}. Use this only when the row is absent from the PDF, duplicated, or belongs to another card/account.`,
  deleteDiagnosticEntries: "Delete all",
  deleteDiagnosticEntriesLabel: (count) => `Delete ${countOf(count, "ledger row")}`,
  deleteDiagnosticEntriesConfirm: ({ count, amount }) => count === 1
    ? `Delete the 1 unresolved ledger row shown here now? It nets to ${amount}. Use this only after checking the PDF/account mapping and confirming this row is absent from this card's PDF, duplicated, or belongs to another card/account.`
    : `Delete all ${count} unresolved ledger rows shown here now? Together these rows net to ${amount}. Use this only after checking the PDF/account mapping and confirming these rows are absent from this card's PDF, duplicated, or belong to another card/account.`,
  deleteDiagnosticEntriesProgress: (count) => `Deleting ${countOf(count, "ledger row")} and refreshing statement check.`,
  deleteDiagnosticEntriesSuccess: (count) => `${countOf(count, "ledger row")} deleted. Statement check refreshed.`,
  statementReconciliationSupersededRowsTitle: "This statement doesn't list these entries from earlier imports. Importing removes them.",
  statementReconciliationSupersededRow: (date, description, amount) => `${date} • ${description} • ${amount}`,
  statementReconciliationStatus: {
    matched: "Matched",
    mismatch: "Mismatch",
    unknown_account: "Needs account",
    identity_unconfirmed: "Needs account proof",
    missing_prior_statement: "Needs earlier statement"
  },
  reconciliationMatchesTitle: "Entry reconciliation matches needing decision",
  reconciliationMatchesDetail: "These rows could not be reconciled automatically. Review only these exceptions before commit.",
  certifiedConflictTitle: (count) => count === 1 ? "Certified row conflict" : `Certified row conflicts (${count})`,
  certifiedConflictDetail: "These rows are already certified somewhere in the ledger, but they do not safely reconcile this statement checkpoint. They are blocking accounting conflicts, not rows to include again.",
  certifiedConflictRow: (date, description, amount) => `${date} • ${description} • ${amount}`,
  duplicateMatchKindExact: "Exact match",
  duplicateMatchKindProbable: "Probable match",
  duplicateMatchKindNear: "Near match",
  duplicateRowDetail: (match) => `Already in ledger: ${match}`,
  viewLedgerMatch: "View match",
  duplicateMatchPopoverTitle: "Ledger match",
  duplicateMatchPopoverDetail: "Compare the incoming row with the existing ledger row before deciding.",
  duplicateMatchIncomingLabel: "Incoming row",
  duplicateMatchLedgerLabel: "Ledger row",
  duplicateMatchTransactionDate: "Transaction date",
  duplicateMatchPostedDate: "Posted date",
  duplicateMatchDateUnavailable: "Not available",
  bankCertificationStatusLine: (label) => `Bank certification status: ${label}`,
  bankCertificationStatusIncomingStatement: "Statement certified on commit",
  openLedgerEntry: "Open ledger entry",
  needsReview: "Needs review",
  // The file card at the top of a preview (Lead · Support · Detail).
  howImportingTitle: "How importing works",
  fileCardRowsCaption: (count) => (count === 1 ? "row will import" : "rows will import"),
  fileCardCovers: (start, end) => `Covers ${start} \u2013 ${end}`,
  fileCardAccountMapped: "Account mapped",
  fileCardMapAccounts: (count) => (count === 1 ? "Map 1 account" : `Map ${count} accounts`),
  // Preview rows on a phone: flat rows that open the row sheet.
  previewRowsTapHint: "tap a row to edit",
  editRowTitle: "Edit row",
  editRowDone: "Done",
  rowFieldType: "Type",
  rowFieldCategory: "Category",
  rowFieldAccount: "Account",
  rowFieldOwner: "Owner",
  rowFieldNote: "Note",
  rowFieldNoteEmpty: "Add a note",
  rowFieldChooseCategory: "Choose a category",
  willImportRows: (count) => `${count} row${count === 1 ? "" : "s"} will import`,
  willReconcileExistingRows: (count, sourceType) => sourceType === "pdf"
    ? `${count} existing row${count === 1 ? "" : "s"} will be certified by the statement`
    : `${countOf(count, "existing entry", "existing entries")} will be updated`,
  willSaveStatementCheckpoints: (count) => `${count} statement checkpoint${count === 1 ? "" : "s"} will refresh`,
  willSaveInvestmentValues: (count) => `${count} statement value${count === 1 ? "" : "s"} will be saved`,
  willSkipRows: (count) => `${count} row${count === 1 ? "" : "s"} already covered`,
  willRemoveEntries: (count) => `${countOf(count, "entry", "entries")} will be removed`,
  needsReviewRows: (count) => `${countOf(count, "row")} ${count === 1 ? "needs" : "need"} review`,
  noRowsToImport: "No new ledger rows will be created. You can still refresh statement checkpoints and certification when the checks match.",
  noRowsToImportCoveredStatement: "This statement's rows are already in the ledger, so nothing new will be added. Saving still records the statement's balance and dates.",
  noRowsToImportEmptyStatement: "This statement has no transaction rows. Only the statement checkpoint will be saved.",
  noRowsToImportAllInLedger: (matchedCount, toCertifyCount) => {
    const rows = matchedCount === 1 ? "The 1 row on this statement is" : `All ${matchedCount} rows on this statement are`;
    if (toCertifyCount === 0) {
      return `${rows} already in your ledger and certified, and the balance matches. Nothing new will be added.`;
    }
    const certifies = toCertifyCount === matchedCount
      ? (matchedCount === 1 ? "it" : "them")
      : `the ${toCertifyCount} not certified yet`;
    return `${rows} already in your ledger and the balance matches. Saving certifies ${certifies}.`;
  },
  skipPreviewRow: "Exclude row",
  matchedExistingPreviewRow: "Matched to ledger",
  restorePreviewRow: "Include row",
  restoreExactCoveredRowConfirm: "This row is marked as an exact already-covered match. Including it again can create a duplicate ledger entry. Continue?",
  importPreviewRow: "Include row",
  promoteExistingPreviewRow: "Promote existing row",
  importAsNewPreviewRow: "Import as new row",
  skippedRowsTitle: (count) => `Already covered rows (${count})`,
  // An investment statement (iFAST, StashAway): what it says the account was worth, and
  // which bank payment each contribution is the same money as.
  investmentStatementTitle: "Investment statement",
  investmentStatementWorth: (account, amount, date) => `${account} was worth ${amount} on ${date}, from the statement. It is saved for reference, not as a balance, and is not checked against your entries.`,
  investmentStatementReplaces: (amount, date) => `This replaces the ${amount} saved for that month (statement of ${date}).`,
  investmentStatementStartsAfter: (opening, earlier, earlierDate) => `This statement starts at ${opening}, but the earlier statement ended at ${earlier} on ${earlierDate}. A statement may be missing in between.`,
  investmentStatementPaired:(amount, date, account, bankDate, direction = "in") => `${amount} ${direction === "in" ? "put in" : "taken out"} on ${date} is the ${account} ${direction === "in" ? "payment" : "deposit"} of ${bankDate}. They are saved as one transfer, not two.`,
  investmentStatementUnpaired: (amount, date, direction = "in") => `${amount} ${direction === "in" ? "put in" : "taken out"} on ${date} has no matching bank ${direction === "in" ? "payment" : "deposit"} yet. It is saved on its own. Import the bank statement first to pair them, or link them later in Entries.`,
  statementCheckpointsTitle: (count) => count === 1 ? "Statement checkpoint" : "Statement checkpoints",
  statementCheckpointsDetail: (count) => count === 1
    ? "This statement balance will be saved during commit. Adjust it here before importing."
    : `This PDF contains ${count} account sections, so each account needs its own checkpoint. For card statements, start date is the first included post date found in that account section. Adjust them here before importing.`,
  duplicateCheckpointAccounts: (accounts) => `Each checkpoint needs a different account. Check: ${accounts}`,
  statementCheckpointAccount: "Account",
  statementCheckpointMonth: "Statement month",
  statementCheckpointStart: "Start date",
  statementCheckpointEnd: "End date",
  statementCheckpointBalance: "Ending balance",
  statementCheckpointNote: "Note",
  recentTitle: "Recent imports",
  recentDetail: "Recent import batches with coverage and overlap signals.",
  recentCommitWorking: "Importing...",
  recentCommitSuccess: (fileName, accountNames = []) => `File imported: ${fileName || "Import"}${accountNames.length ? ` into ${listOf(accountNames)}` : ""}. Recent imports have been updated.`,
  recentEarlierTitle: "Imported before it:",
  recentEarlierItem: ({ accountNames, period, sourceLabel }) => [listOf(accountNames), period, sourceLabel].filter(Boolean).join(" · "),
  splitCleanupTitle: (count) => `${count} possible split ${count === 1 ? "link" : "links"} after this import`,
  splitCleanupDetail: "Some imported bank rows may be the official ledger version of split expenses or settle-ups you already entered manually. Review them now, or leave them for the Splits review inbox later.",
  reviewSplitMatchesNow: "Review split matches",
  reviewSplitMatchesLater: "Later",
  recentAccountFilter: "By account",
  recentAllAccounts: "All accounts",
  recentEmpty: "No imports match this account filter.",
  recentRefreshing: "Updating recent imports...",
  recentStatementCertificates: (count) => `${count} statement certificate${count === 1 ? "" : "s"}`,
  recentStatementCertificateException: "certificate exception",
  recentPageSummary: (start, end, total) => `Showing ${start}-${end} of ${countOf(total, "import")}`,
  recentPageCount: (page, pageCount) => `Page ${page} of ${pageCount}`,
  previousPage: "Previous",
  nextPage: "Next",
  importCoverage: (start, end) => `${start} - ${end}`,
  importKindPdfStatement: "PDF statement",
  importKindMidcycle: "Mid-cycle",
  importKindManual: "Manual",
  importKindCsv: "CSV import",
  importOverlap: (count) => `${count} overlapping import${count === 1 ? "" : "s"}`,
  overlapPopoverTitle: "Overlapping imports",
  overlapPopoverDetail: "Completed imports for the same account with a date range that crosses this batch.",
  overlapPopoverEmpty: "No same-account overlaps are attached to this import.",
  rollback: "Rollback import",
  rollbackDetail: (label) => `You are rolling back ${label}. Confirm?`,
  rollbackConfirm: "Confirm rollback",
  statementRollbackLocked: "Statement locked",
  statementRollbackLockedDetail: "PDF statement imports are locked after they certify existing rows or when a later statement exists for the same account.",
  table: {
    row: "Row",
    date: "Date",
    description: "Description",
    amount: "Amount",
    type: "Type",
    account: "Account",
    category: "Category",
    owner: "Owner",
    split: "Split link",
    note: "Note",
    actions: "Actions"
  }
};
