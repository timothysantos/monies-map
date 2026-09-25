# Docs Index

One line per doc. Current reference docs are kept up to date; files under
[`archive/`](archive/) are historical and are not updated. Add, move, or archive
a doc here in the same change.

## Start here

- [`../AGENTS.md`](../AGENTS.md): always-read engineering rules and guardrails.
- [`../README.md`](../README.md): product overview, local setup, and deploys.
- [`git.md`](git.md): short product workflow guide for imports, reconciliation,
  and splits.
- [`faq.md`](faq.md): user-facing FAQ, also rendered in the app's FAQ panel.
- [`../DOMAIN.md`](../DOMAIN.md): canonical domain vocabulary.

## Architecture and rules

- [`architecture.md`](architecture.md): human-readable architecture plan.
- [`code-spec.md`](code-spec.md): compact implementation spec, query budgets,
  and invalidation contracts.
- [`../design.md`](../design.md): client-side boundaries and helper services.
- [`macro-performance-plan.md`](macro-performance-plan.md): macro architecture
  and performance plan, budgets, and task sequence.
- [`macro-performance-implementation.md`](macro-performance-implementation.md):
  detailed per-task handoff for the macro plan.
- [`implementation-order.md`](implementation-order.md): current task order;
  Stage 4 sequence kept as context.
- [`refactor-decisions.md`](refactor-decisions.md): settled answers on shell
  shape, helpers, money editing, and invalidation.
- [`refactor-status.md`](refactor-status.md): Stage 4 checkpoint of complete,
  partial, and open work.
- [`existing-behavior-guardrails.md`](existing-behavior-guardrails.md): learned
  behaviors that must not regress.
- [`interaction-guidelines.md`](interaction-guidelines.md): button, action, and
  mutation feedback semantics.
- [`responsive-behavior.md`](responsive-behavior.md): desktop and mobile
  behavior contracts.
- [`query-map.md`](query-map.md): TanStack Query keys and API shapes.
- [`tanstack-query-language.md`](tanstack-query-language.md): query design
  language.
- [`import-summary-code-glossary.md`](import-summary-code-glossary.md): reading
  aid for import and summary page code.
- [`scenario-catalog.md`](scenario-catalog.md): TDD scenario map.
- [`slice-inventory.md`](slice-inventory.md): vertical-slice inventory.
- [`known-coupling-targets.md`](known-coupling-targets.md): audit findings that
  must stay on the test plan.
- [`preimplementation-checklist.md`](preimplementation-checklist.md): pre-change
  audit checklist and stop conditions.
- [`implementation-prompt-template.md`](implementation-prompt-template.md):
  template for new slice and bug-fix prompts.
- [`stage4-close-checklist.md`](stage4-close-checklist.md): criteria for calling
  Stage 4 closed.

## Flows

- [`stage4-flow-index.md`](stage4-flow-index.md): entry point for route, state,
  and data flow docs.
- [`route-data-code-flow.md`](route-data-code-flow.md): route vs data vs code
  rendering flow.
- [`app-shell-flow.md`](app-shell-flow.md): first-load and follow-up query flow
  after the shell.
- [`flows/stage4-parent-flow.md`](flows/stage4-parent-flow.md): parent flow for
  the page flows.
- [`flows/summary-flow.md`](flows/summary-flow.md): Summary page.
- [`flows/month-flow.md`](flows/month-flow.md): Month page.
- [`flows/entries-flow.md`](flows/entries-flow.md): Entries page.
- [`flows/imports-flow.md`](flows/imports-flow.md): Imports page.
- [`flows/splits-flow.md`](flows/splits-flow.md): Splits page.
- [`flows/settings-flow.md`](flows/settings-flow.md): Settings page.

## Audits and evidence

- [`delete-confirmation-audit.md`](delete-confirmation-audit.md): delete
  confirmation coverage.
- [`import-exact-match-certification-audit.md`](import-exact-match-certification-audit.md):
  exact-match import certification.
- [`import-inbox-audit-report.md`](import-inbox-audit-report.md): import inbox
  audit.
- [`import-inbox-task-list.md`](import-inbox-task-list.md): import inbox goals
  and remaining task.
- [`audits/macro-loading-baseline.md`](audits/macro-loading-baseline.md): macro
  loading baseline evidence (H00, H01).
- [`audits/route-assets-baseline.json`](audits/route-assets-baseline.json): route
  asset size baseline.
- [`audits/ai-assistance-slice-audit.md`](audits/ai-assistance-slice-audit.md):
  optional AI assistance slice.
- [`audits/app-shell-reference-data-split-audit.md`](audits/app-shell-reference-data-split-audit.md):
  app shell reference data split.
- [`audits/apple-pay-api-hardening-audit.md`](audits/apple-pay-api-hardening-audit.md):
  Apple Pay API hardening.
- [`audits/category-match-rule-duplicates-surface-audit.md`](audits/category-match-rule-duplicates-surface-audit.md):
  category rule duplicate surface.
- [`audits/category-match-suggestion-duplicate-rule-audit.md`](audits/category-match-suggestion-duplicate-rule-audit.md):
  category suggestion duplicate rules.
- [`audits/category-rule-overlap-ignore-audit.md`](audits/category-rule-overlap-ignore-audit.md):
  category rule overlap ignore.
- [`audits/donut-category-interaction-audit.md`](audits/donut-category-interaction-audit.md):
  donut category interaction.
- [`audits/donut-category-visibility-audit.md`](audits/donut-category-visibility-audit.md):
  donut category visibility.
- [`audits/entries-splits-search-audit.md`](audits/entries-splits-search-audit.md):
  entries and splits search.
- [`audits/fourteenth-slice-audit.md`](audits/fourteenth-slice-audit.md):
  fourteenth slice closure.
- [`audits/hsbc-image-pdf-import-audit.md`](audits/hsbc-image-pdf-import-audit.md):
  HSBC image PDF import.
- [`audits/import-quality-transfer-review-audit.md`](audits/import-quality-transfer-review-audit.md):
  import quality and transfer review.
- [`audits/ledger-split-ownership-audit.md`](audits/ledger-split-ownership-audit.md):
  ledger and split ownership.
- [`audits/legacy-ledger-storage-removal-audit.md`](audits/legacy-ledger-storage-removal-audit.md):
  legacy ledger storage removal.
- [`audits/money-field-editability-audit.md`](audits/money-field-editability-audit.md):
  money field editability.
- [`audits/ocbc-360-current-activity-csv-regression.md`](audits/ocbc-360-current-activity-csv-regression.md):
  OCBC 360 current-activity CSV regression.
- [`audits/ocbc-360-statement-then-activity-reconciliation-audit.md`](audits/ocbc-360-statement-then-activity-reconciliation-audit.md):
  OCBC 360 statement-then-activity reconciliation.
- [`audits/reference-data-timeout-hot-path-audit.md`](audits/reference-data-timeout-hot-path-audit.md):
  reference data timeout hot path.
- [`audits/settings-transfer-and-rule-review-audit.md`](audits/settings-transfer-and-rule-review-audit.md):
  settings transfer and rule review.
- [`audits/shortcut-api-settings-audit.md`](audits/shortcut-api-settings-audit.md):
  Shortcut API settings.
- [`audits/shortcut-default-params-audit.md`](audits/shortcut-default-params-audit.md):
  Shortcut default params.
- [`audits/shortcut-main-access-migration-audit.md`](audits/shortcut-main-access-migration-audit.md):
  main worker Shortcut Access migration.
- [`audits/smoke-stabilization-audit.md`](audits/smoke-stabilization-audit.md):
  smoke stabilization.
- [`audits/split-existing-ledger-linking-audit.md`](audits/split-existing-ledger-linking-audit.md):
  split linking to existing ledger rows.
- [`audits/split-settlement-checkpoint-audit.md`](audits/split-settlement-checkpoint-audit.md):
  split settlement checkpoints.
- [`audits/splits-activity-history-audit.md`](audits/splits-activity-history-audit.md):
  splits activity history.
- [`audits/stage4-closure-commit-report.md`](audits/stage4-closure-commit-report.md):
  Stage 4 closure commits.
- [`audits/stage4-closure-documentation-alignment-audit.md`](audits/stage4-closure-documentation-alignment-audit.md):
  Stage 4 documentation alignment.
- [`audits/travel-multicurrency-splits-audit.md`](audits/travel-multicurrency-splits-audit.md):
  travel and multi-currency splits.
- [`audits/two-tab-entry-split-refresh-audit.md`](audits/two-tab-entry-split-refresh-audit.md):
  two-tab entry and splits refresh.
- [`audits/uob-may-2026-import-reconciliation-audit.md`](audits/uob-may-2026-import-reconciliation-audit.md):
  UOB May 2026 import reconciliation.

## Runbooks

- [`production-debugging-runbook.md`](production-debugging-runbook.md):
  diagnosing production issues.
- [`../README.md#cloudflare-deploy`](../README.md#cloudflare-deploy): deploy,
  Access auth, first-time setup, and demo deploy steps.

## Archive

Historical records of finished work. Do not update them.

- [`archive/first-slice-prompt.md`](archive/first-slice-prompt.md) through
  [`archive/sixteenth-slice-prompt.md`](archive/sixteenth-slice-prompt.md):
  finished slice prompts, one file per slice:
  [second](archive/second-slice-prompt.md),
  [third](archive/third-slice-prompt.md),
  [fourth](archive/fourth-slice-prompt.md),
  [fifth](archive/fifth-slice-prompt.md),
  [sixth](archive/sixth-slice-prompt.md),
  [seventh](archive/seventh-slice-prompt.md),
  [eighth](archive/eighth-slice-prompt.md),
  [ninth](archive/ninth-slice-prompt.md),
  [tenth](archive/tenth-slice-prompt.md),
  [eleventh](archive/eleventh-slice-prompt.md),
  [twelfth](archive/twelfth-slice-prompt.md),
  [thirteenth](archive/thirteenth-slice-prompt.md),
  [fourteenth](archive/fourteenth-slice-prompt.md),
  [fifteenth](archive/fifteenth-slice-prompt.md).
- [`archive/stage4-closure-audit-documentation-alignment-prompt.md`](archive/stage4-closure-audit-documentation-alignment-prompt.md):
  Stage 4 closure audit prompt.
- [`archive/eleventh-slice-closure-reply.md`](archive/eleventh-slice-closure-reply.md):
  eleventh slice closure check reply.
- [`archive/fifteenth-slice-audit-report.md`](archive/fifteenth-slice-audit-report.md):
  mutation-interaction hardening after the fifteenth slice.
- [`archive/sixteenth-slice-audit-report.md`](archive/sixteenth-slice-audit-report.md):
  sixteenth slice follow-up audit
  ([plain-text copy](archive/sixteenth-slice-audit-report.txt)).
- [`archive/apple-pay-api-hardening-task-list.md`](archive/apple-pay-api-hardening-task-list.md):
  completed Apple Pay API hardening tasks.
- [`archive/import-quality-transfer-review-task-list.md`](archive/import-quality-transfer-review-task-list.md):
  completed import quality and transfer review tasks.
- [`archive/route-data-code-flow.pdf`](archive/route-data-code-flow.pdf): PDF
  render of `route-data-code-flow.md`.
