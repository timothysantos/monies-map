import * as accountDisplay from "./account-display";
import * as categoryUtils from "./category-utils";
import * as entryHelpers from "./entry-helpers";
import * as formatters from "./formatters";
import * as importHelpers from "./import-helpers";
import * as monthHelpers from "./month-helpers";
import * as splitHelpers from "./split-helpers";

// `moniesClient` is the single public utility surface for client-side
// formatting, selection, and helper workflows. Keep leaf helpers behind this
// module so component code does not need to know where small details live.
export const moniesClient = Object.freeze({
  accounts: Object.freeze({
    describeHealth: accountDisplay.describeAccountHealth,
    formatAuditAction: accountDisplay.formatAuditAction,
    formatDisplayName: accountDisplay.formatAccountDisplayName,
    formatSelectLabel: accountDisplay.formatAccountSelectLabel,
    getSelectOptions: accountDisplay.getAccountSelectOptions
  }),
  categories: Object.freeze({
    buildPatch: categoryUtils.getCategoryPatch,
    get: categoryUtils.getCategory,
    getNameOptions: categoryUtils.getCategoryNameOptions,
    getSelectValue: categoryUtils.getCategorySelectValue,
    getTheme: categoryUtils.getCategoryTheme,
    listForSelect: categoryUtils.getCategoriesForSelect,
    slugify: categoryUtils.slugify
  }),
  entries: Object.freeze({
    applySharedSplit: entryHelpers.applySharedSplit,
    buildDraft: entryHelpers.buildEntryDraft,
    entryMatchesScope: entryHelpers.entryMatchesScope,
    getAmountToneClass: entryHelpers.getAmountToneClass,
    getSignedAmountMinor: entryHelpers.getSignedAmountMinor,
    getTotalAmountMinor: entryHelpers.getTotalAmountMinor,
    getSignedTotalAmountMinor: entryHelpers.getSignedTotalAmountMinor,
    getTransferMatchCandidates: entryHelpers.getTransferMatchCandidates,
    getTransferWallets: entryHelpers.getTransferWallets,
    getVisibleAmountMinor: entryHelpers.getVisibleAmountMinor,
    getVisibleSplitIndex: entryHelpers.getVisibleSplitIndex,
    getVisibleSplitPercent: entryHelpers.getVisibleSplitPercent,
    groupByDate: entryHelpers.groupEntriesByDate,
    normalize: entryHelpers.normalizeEntryShape,
    uniqueValues: entryHelpers.uniqueValues
  }),
  format: Object.freeze({
    buildCheckpointExportHref: formatters.buildCheckpointExportHref,
    decimalStringToMinor: formatters.decimalStringToMinor,
    formatCheckpointCoverage: formatters.formatCheckpointCoverage,
    formatCheckpointHistoryBalanceLine: formatters.formatCheckpointHistoryBalanceLine,
    formatCheckpointStatementInputMinor: formatters.formatCheckpointStatementInputMinor,
    formatDate: formatters.formatDate,
    formatDateOnly: formatters.formatDateOnly,
    formatEditableMinorInput: formatters.formatEditableMinorInput,
    formatMinorInput: formatters.formatMinorInput,
    formatMonthLabel: formatters.formatMonthLabel,
    formatStatementReconciliationLine: formatters.formatStatementReconciliationLine,
    getContentDispositionFilename: formatters.getContentDispositionFilename,
    minorToDecimalString: formatters.minorToDecimalString,
    money: formatters.money,
    parseDraftMoneyInput: formatters.parseDraftMoneyInput,
    parseMoneyInput: formatters.parseMoneyInput
  }),
  imports: Object.freeze({
    buildMappedRows: importHelpers.buildMappedImportRows,
    buildRawRowFromPreviewRow: importHelpers.buildRawImportRowFromPreviewRow,
    extractPdfText: importHelpers.extractPdfText,
    getDirectOwnerForAccount: importHelpers.getImportDirectOwnerForAccount,
    inferMapping: importHelpers.inferImportMapping,
    selectParsedStatementForCompare: importHelpers.selectParsedStatementForCompare
  }),
  months: Object.freeze({
    buildMetricCards: monthHelpers.buildMonthMetricCards,
    buildPlanLinkCandidates: monthHelpers.buildPlanLinkCandidates,
    getDefaultSectionOpen: monthHelpers.getDefaultMonthSectionOpen,
    getPlanRowById: monthHelpers.getPlanRowById,
    getSectionTotals: monthHelpers.getMonthSectionTotals,
    getVisibleAccounts: monthHelpers.getVisibleMonthAccounts
  }),
  splits: Object.freeze({
    formatArchiveDate: splitHelpers.formatArchiveDate,
    getArchivedBatchSummary: splitHelpers.getArchivedBatchSummary,
    groupActivityByBatch: splitHelpers.groupSplitActivityByBatch,
    groupActivityByDate: splitHelpers.groupSplitActivityByDate
  })
});
