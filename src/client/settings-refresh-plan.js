// The named refresh plans for settings changes (the Settings route's). What
// App does with a plan is in settings-refresh-request.js, which ships with
// the first screen.
export { describeSettingsRefreshPlan, SETTINGS_ROUTE_REQUEST } from "./settings-refresh-request";

const SETTINGS_ONLY_PLAN = Object.freeze({
  refreshShell: false,
  refreshReferenceData: false,
  invalidateEntries: false,
  invalidateImports: false,
  invalidateMonth: false,
  invalidateSplits: false,
  invalidateSummary: false
});

const REFERENCE_DATA_PLAN = Object.freeze({
  refreshShell: false,
  refreshReferenceData: true,
  invalidateEntries: true,
  invalidateImports: false,
  invalidateMonth: true,
  invalidateSplits: true,
  invalidateSummary: true
});

const PERSON_REFERENCE_DATA_PLAN = Object.freeze({
  ...REFERENCE_DATA_PLAN,
  refreshShell: true
});

const CATEGORY_RULE_PLAN = Object.freeze({
  refreshShell: false,
  refreshReferenceData: false,
  invalidateEntries: false,
  invalidateImports: true,
  invalidateMonth: false,
  invalidateSplits: false,
  invalidateSummary: false
});

const DEMO_RESET_PLAN = Object.freeze({
  refreshShell: true,
  refreshReferenceData: true,
  invalidateEntries: true,
  invalidateImports: true,
  invalidateMonth: true,
  invalidateSplits: true,
  invalidateSummary: true
});

const TRANSFER_MUTATION_PLAN = Object.freeze({
  refreshShell: false,
  refreshReferenceData: false,
  invalidateEntries: true,
  invalidateImports: false,
  invalidateMonth: true,
  invalidateSplits: false,
  invalidateSummary: true
});

// Applying a rule to past entries recategorises ledger entries, which moves
// Month, Summary and Entries totals.
const CATEGORY_RULE_BACKFILL_PLAN = Object.freeze({
  ...TRANSFER_MUTATION_PLAN,
  invalidateImports: true
});

// A statement correction moves or removes ledger entries, and an import
// whose entry covers a removed copy can no longer be rolled back.
const STATEMENT_CORRECTION_PLAN = Object.freeze({
  ...TRANSFER_MUTATION_PLAN,
  invalidateImports: true
});

// Settings mutations use named refresh plans so invalidation stays explicit and
// the panel does not decide cache-burst behavior inline.
export function buildSettingsRefreshPlan(kind) {
  if (
    kind === "person_saved"
  ) {
    return PERSON_REFERENCE_DATA_PLAN;
  }

  if (
    kind === "account_saved"
    || kind === "account_archived"
    || kind === "category_saved"
    || kind === "category_deleted"
    || kind === "legacy_ledger_ownership_repaired"
  ) {
    return REFERENCE_DATA_PLAN;
  }

  if (kind === "category_rule_applied_to_past") {
    return CATEGORY_RULE_BACKFILL_PLAN;
  }

  if (
    kind === "category_rule_saved"
    || kind === "category_rule_deleted"
    || kind === "category_rule_suggestion_accepted"
    || kind === "category_rule_suggestion_ignored"
    || kind === "category_rule_issue_ignored"
  ) {
    return CATEGORY_RULE_PLAN;
  }

  if (
    kind === "checkpoint_saved"
    || kind === "checkpoint_deleted"
    || kind === "unresolved_transfer_dismissed"
    || kind === "unresolved_transfer_dismissed_all"
    || kind === "reconciliation_exception_created"
    || kind === "reconciliation_exception_resolved"
    || kind === "statement_compare_linked"
    || kind === "statement_compare_entry_added"
    || kind === "shortcut_settings_saved"
    || kind === "payment_way_saved"
    || kind === "settings_form_draft"
    || kind === "filter-only"
    || kind === "mobile-sheet"
  ) {
    return SETTINGS_ONLY_PLAN;
  }

  if (
    kind === "unresolved_transfer_linked"
    || kind === "unresolved_transfer_settled"
  ) {
    return TRANSFER_MUTATION_PLAN;
  }

  if (kind === "statement_corrected" || kind === "statement_correction_undone") {
    return STATEMENT_CORRECTION_PLAN;
  }

  if (kind === "demo_reseed" || kind === "demo_empty_state") {
    return DEMO_RESET_PLAN;
  }

  throw new Error(`Unknown settings refresh plan: ${kind}`);
}
