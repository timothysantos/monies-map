const SETTINGS_ONLY_PLAN = Object.freeze({
  refreshShell: false,
  invalidateEntries: false,
  invalidateImports: false,
  invalidateMonth: false,
  invalidateSplits: false,
  invalidateSummary: false
});

const REFERENCE_DATA_PLAN = Object.freeze({
  refreshShell: true,
  invalidateEntries: true,
  invalidateImports: false,
  invalidateMonth: true,
  invalidateSplits: true,
  invalidateSummary: true
});

const CATEGORY_RULE_PLAN = Object.freeze({
  refreshShell: false,
  invalidateEntries: false,
  invalidateImports: true,
  invalidateMonth: false,
  invalidateSplits: false,
  invalidateSummary: false
});

const DEMO_RESET_PLAN = Object.freeze({
  refreshShell: true,
  invalidateEntries: true,
  invalidateImports: true,
  invalidateMonth: true,
  invalidateSplits: true,
  invalidateSummary: true
});

// Settings mutations use named refresh plans so invalidation stays explicit and
// the panel does not decide cache-burst behavior inline.
export function buildSettingsRefreshPlan(kind) {
  if (
    kind === "person_saved"
    || kind === "account_saved"
    || kind === "account_archived"
    || kind === "category_saved"
    || kind === "category_deleted"
  ) {
    return REFERENCE_DATA_PLAN;
  }

  if (
    kind === "category_rule_saved"
    || kind === "category_rule_deleted"
    || kind === "category_rule_suggestion_accepted"
    || kind === "category_rule_suggestion_ignored"
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
  ) {
    return SETTINGS_ONLY_PLAN;
  }

  if (kind === "demo_reseed" || kind === "demo_empty_state") {
    return DEMO_RESET_PLAN;
  }

  throw new Error(`Unknown settings refresh plan: ${kind}`);
}
