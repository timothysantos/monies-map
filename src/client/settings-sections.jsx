import { ArrowDown, ArrowUp, ChevronRight, ExternalLink, Eye, EyeOff, GripVertical, Receipt, RefreshCw, ShieldCheck, Smartphone, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { buildClaudeCreditLine } from "./claude-credit-model";
import { ClaudeCreditActions, ClaudeTopUpForm } from "./claude-credit-notice";
import { claudeCreditCopy } from "./copy/claude-credit-copy";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { humanizeEnum } from "./enum-labels";
import { settingsMessages } from "./copy/en-SG-settings";
import { useMoneyPrivacy } from "./money-privacy";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { EmptyState } from "./ui-states";
import { moniesClient } from "./monies-client-service";
import { describeAccountLine } from "./settings-account-line";
import { AddRow } from "./settings-add-row";
import { SettingsSection } from "./settings-section";
import { describeAskAi } from "./settings-summary-model";
import { buildSettingsTransferReviewModel, SETTINGS_TRANSFER_PAGE_SIZE } from "./settings-transfer-review-model";
import { buildPaymentWayAccountOptions, findDuplicateCategoryMatchRules } from "./settings-workflow";
import { DeleteRowButton } from "./delete-row-button";
import { CategoryGlyph, DetailRow, DetailRows, LeadCard, MetaChip, MoreDetails } from "./ui-components";
import { useRouteWorkBusy } from "./use-route-work-status";
import { paletteColour } from "./palette-colour";

const { accounts: accountService, format: formatService } = moniesClient;
const APPLE_PAY_SHORTCUT_URL = "/shortcuts/monies-map-apple-pay-api.shortcut";

function groupCategoryMatchRules(rules, categories) {
  const categoriesByName = new Map(categories.map((category) => [category.name, category]));
  const groupsByCategory = rules.reduce((groups, rule) => {
    const categoryName = rule.categoryName || messages.common.emptyValue;
    const group = groups.get(categoryName) ?? [];
    group.push(rule);
    groups.set(categoryName, group);
    return groups;
  }, new Map());

  return Array.from(groupsByCategory.entries())
    .map(([categoryName, groupRules]) => ({
      categoryName,
      category: categoriesByName.get(categoryName) ?? null,
      rules: [...groupRules].sort((first, second) => (
        first.priority - second.priority
        || first.pattern.localeCompare(second.pattern)
      ))
    }))
    .sort((first, second) => first.categoryName.localeCompare(second.categoryName));
}

// A row that opens an editor on its main part and keeps a second control (a
// delete) at its end, so neither button sits inside the other.
function SplitRow({ className = "", children, trailing = null }) {
  return (
    <div className={`lsd-row settings-split-row${className ? ` ${className}` : ""}`}>
      {children}
      {trailing}
    </div>
  );
}

export function SettingsPeopleSection({ people, isOpen, summary, onToggle, onEditPerson }) {
  return (
    <SettingsSection title={settingsMessages.peopleTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      <DetailRows>
        {people.map((person) => (
          <DetailRow
            key={person.id}
            label={<strong className="settings-row-name">{person.name}</strong>}
            value={settingsMessages.editPerson}
            aria-label={`${settingsMessages.editPerson} ${person.name}`}
            onClick={() => onEditPerson(person)}
          />
        ))}
      </DetailRows>
      <p className="settings-hint">{settingsMessages.personUsageHint}</p>
    </SettingsSection>
  );
}

export function SettingsShortcutApiSection({
  accounts,
  draft,
  error,
  isOpen,
  isSubmitting,
  shortcutSettings,
  connections = [],
  selectedConnection = null,
  onPersonChange,
  onRevoke,
  status,
  summary,
  onApiKeyChange,
  onDefaultParamsChange,
  onGenerateApiKey,
  onInstallShortcut,
  onMoveAccount,
  onForeignCurrencyAccountChange,
  onToggle,
  onSave
}) {
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isPriorityOpen, setIsPriorityOpen] = useState(false);
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  useRouteWorkBusy(isInstalling);
  // With two or more people each phone has its own connection; the row and
  // the person's name on the buttons only appear then.
  const hasSeveralPhones = connections.length > 1;
  const phoneName = selectedConnection?.personName ?? "";
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const orderedAccounts = draft.defaultAccountPriorityIds
    .map((accountId) => accountsById.get(accountId))
    .filter(Boolean);
  const endpoint = new URL(shortcutSettings.endpointPath, window.location.origin).toString();
  const isSetUp = Boolean(draft.apiKey?.trim());
  const setupSteps = [
    settingsMessages.shortcutInstallStep,
    settingsMessages.shortcutPasteStep,
    settingsMessages.shortcutAutomationStep,
    settingsMessages.shortcutAutomationRunStep
  ];
  const foreignCurrencyAccount = draft.foreignCurrencyAccountId ? accountsById.get(draft.foreignCurrencyAccountId) : null;

  async function handleInstallShortcut() {
    const shortcutUrl = new URL(APPLE_PAY_SHORTCUT_URL, window.location.origin).toString();
    const installWindow = window.open("about:blank", "_blank");
    if (installWindow) {
      installWindow.opener = null;
    }
    setIsInstalling(true);
    try {
      await onInstallShortcut();
      if (installWindow) {
        installWindow.location.replace(shortcutUrl);
      } else {
        window.location.assign(shortcutUrl);
      }
    } catch {
      installWindow?.close();
    } finally {
      setIsInstalling(false);
    }
  }

  return (
    <SettingsSection
      title={settingsMessages.shortcutApiTitle}
      value={summary?.text}
      valueTone={summary?.tone}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {status ? <p className="settings-shortcut-status" role="status" aria-live="polite">{status}</p> : null}
      <LeadCard
        className="settings-lead"
        accentColor="var(--accent-strong)"
        category={{ icon: Smartphone }}
        title={settingsMessages.shortcutLeadTitle}
        subtitle={isSetUp ? settingsMessages.shortcutLeadSetUp : settingsMessages.shortcutLeadNotSetUp}
        chips={(
          <>
            <MetaChip tone="mint" icon={ShieldCheck}>{settingsMessages.shortcutChipSigned}</MetaChip>
            <MetaChip icon={Receipt}>{settingsMessages.shortcutChipOpensEntry}</MetaChip>
          </>
        )}
      />
      <DetailRows>
        {hasSeveralPhones ? (
          <DetailRow label={settingsMessages.shortcutPhoneRowLabel} value={phoneName}>
            <select
              className="lsd-row-native"
              aria-label={settingsMessages.shortcutPhoneSelectLabel}
              value={selectedConnection?.personId ?? ""}
              disabled={isSubmitting}
              onChange={(event) => onPersonChange(event.target.value)}
            >
              {connections.map((connection) => (
                <option key={connection.personId} value={connection.personId}>{connection.personName}</option>
              ))}
            </select>
          </DetailRow>
        ) : null}
        <DetailRow
          label={settingsMessages.shortcutDefaultAccountLabel}
          value={orderedAccounts[0]?.name}
          emptyLabel={settingsMessages.shortcutDefaultAccountNone}
          aria-expanded={isPriorityOpen}
          onClick={() => setIsPriorityOpen((current) => !current)}
        />
        {isPriorityOpen ? (
          <div className="settings-detail-block settings-shortcut-priority">
            <p className="settings-hint">{settingsMessages.shortcutDefaultAccountsDetail}</p>
            <div className="settings-shortcut-account-list">
              {orderedAccounts.map((account, index) => (
                <div
                  key={account.id}
                  className="settings-account-row settings-shortcut-account-row"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void onMoveAccount(Number(event.dataTransfer.getData("text/plain")), index);
                  }}
                >
                  <GripVertical size={16} aria-hidden="true" />
                  <div className="settings-account-main">
                    <strong>{account.name}</strong>
                    <p>{describeAccountLine(account)}</p>
                  </div>
                  <div className="settings-account-actions">
                    <button
                      type="button"
                      className="icon-action settings-row-icon"
                      aria-label={settingsMessages.shortcutMoveAccountUp(account.name)}
                      disabled={isSubmitting || index === 0}
                      onClick={() => void onMoveAccount(index, index - 1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-action settings-row-icon"
                      aria-label={settingsMessages.shortcutMoveAccountDown(account.name)}
                      disabled={isSubmitting || index === orderedAccounts.length - 1}
                      onClick={() => void onMoveAccount(index, index + 1)}
                    >
                      <ArrowDown size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <DetailRow
          label={settingsMessages.shortcutForeignCurrencyRowLabel}
          value={foreignCurrencyAccount?.name ?? settingsMessages.shortcutForeignCurrencySame}
        >
          <select
            className="lsd-row-native"
            aria-label={settingsMessages.shortcutForeignCurrencyLabel}
            value={draft.foreignCurrencyAccountId}
            disabled={isSubmitting}
            onChange={(event) => void onForeignCurrencyAccountChange(event.target.value)}
          >
            <option value="">{settingsMessages.shortcutForeignCurrencySame}</option>
            {orderedAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </DetailRow>
        <MoreDetails
          label={settingsMessages.shortcutStepsTitle}
          openLabel={settingsMessages.shortcutStepsTitle}
          summary={settingsMessages.shortcutStepsCount(setupSteps.length)}
        >
          <div className="settings-detail-block">
            <ol className="settings-shortcut-steps">
              {setupSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </MoreDetails>
        <MoreDetails label={settingsMessages.shortcutAdvancedTitle} openLabel={settingsMessages.shortcutAdvancedTitle}>
          <div className="settings-detail-block settings-shortcut-advanced-content">
            <p className="settings-hint">{settingsMessages.shortcutForeignCurrencyDetail}</p>
            <label className="table-edit-field settings-form-wide">
              <span>{settingsMessages.shortcutEndpoint}</span>
              <input className="table-edit-input" value={endpoint} readOnly />
            </label>
            <div className="table-edit-field settings-form-wide">
              <label htmlFor="shortcut-api-key">{settingsMessages.shortcutApiKey}</label>
              <div className="settings-shortcut-secret-input">
                <input
                  id="shortcut-api-key"
                  className="table-edit-input"
                  type={isApiKeyVisible ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                />
                <button
                  type="button"
                  className="icon-action settings-row-icon"
                  aria-label={isApiKeyVisible ? settingsMessages.shortcutHideApiKey : settingsMessages.shortcutShowApiKey}
                  title={isApiKeyVisible ? settingsMessages.shortcutHideApiKey : settingsMessages.shortcutShowApiKey}
                  onClick={() => setIsApiKeyVisible((current) => !current)}
                >
                  {isApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <small className="field-help">{settingsMessages.shortcutApiKeyHelp(shortcutSettings.apiKeySource)}</small>
            </div>
            <label className="table-edit-field settings-form-wide">
              <span>{settingsMessages.shortcutDefaultParams}</span>
              <textarea
                className="table-edit-input settings-shortcut-params-input"
                value={draft.defaultParams}
                onChange={(event) => onDefaultParamsChange(event.target.value)}
                placeholder={settingsMessages.shortcutDefaultParamsPlaceholder}
                rows={2}
              />
              <small className="field-help">{settingsMessages.shortcutDefaultParamsHelp}</small>
            </label>
            <div className="settings-shortcut-reference">
              <div>
                <strong>{settingsMessages.shortcutUrlParamsTitle}</strong>
                <p>{settingsMessages.shortcutUrlParamsList}</p>
              </div>
              <div>
                <strong>{settingsMessages.shortcutApiParamsTitle}</strong>
                <p>{settingsMessages.shortcutApiParamsList}</p>
              </div>
              <div>
                <strong>{settingsMessages.shortcutSystemDefaultsTitle}</strong>
                <p>{settingsMessages.shortcutSystemDefaultsDetail}</p>
              </div>
            </div>
            <div className="settings-actions">
              <button type="button" className="subtle-action" onClick={onGenerateApiKey} disabled={isSubmitting}>
                {settingsMessages.shortcutGenerateApiKey}
              </button>
              {hasSeveralPhones ? (
                <button type="button" className="subtle-action" onClick={() => setIsRevokeOpen(true)} disabled={isSubmitting || !isSetUp}>
                  {settingsMessages.shortcutRevoke}
                </button>
              ) : null}
              <button type="button" className="subtle-action" onClick={onSave} disabled={isSubmitting || !draft.apiKey.trim() || orderedAccounts.length === 0}>
                {isSubmitting ? messages.common.saving : settingsMessages.shortcutSave}
              </button>
            </div>
          </div>
        </MoreDetails>
      </DetailRows>
      {hasSeveralPhones
        ? <p className="settings-hint">{settingsMessages.shortcutPhoneHint(phoneName)}</p>
        : null}
      {isPriorityOpen ? null : <p className="settings-hint">{settingsMessages.shortcutFallbackHint}</p>}
      <button
        type="button"
        className="lsd-primary settings-shortcut-install-button"
        disabled={isSubmitting || isInstalling || orderedAccounts.length === 0}
        onClick={() => void handleInstallShortcut()}
      >
        <ExternalLink size={16} aria-hidden="true" />
        {isInstalling
          ? settingsMessages.shortcutInstalling
          : hasSeveralPhones ? settingsMessages.shortcutInstallFor(phoneName) : settingsMessages.shortcutInstall}
      </button>
      {isRevokeOpen ? (
        <SheetDialog
          tone="danger"
          className="settings-account-dialog"
          title={settingsMessages.shortcutRevokeTitle(phoneName)}
          description={settingsMessages.shortcutRevokeDetail(phoneName)}
          descriptionHidden
          closeLabel={settingsMessages.shortcutRevokeTitle(phoneName)}
          lead={(
            <ConfirmLead icon={Smartphone} title={settingsMessages.shortcutRevokeTitle(phoneName)}>
              <p className="lsd-note">{settingsMessages.shortcutRevokeDetail(phoneName)}</p>
            </ConfirmLead>
          )}
          primaryLabel={isSubmitting ? messages.common.working : settingsMessages.shortcutRevokeConfirm}
          primaryDisabled={isSubmitting}
          isSubmitting={isSubmitting}
          onSubmit={async () => {
            try {
              await onRevoke();
              setIsRevokeOpen(false);
            } catch {
              // The section shows the error; the dialog stays for another try.
            }
          }}
          onClose={() => setIsRevokeOpen(false)}
        />
      ) : null}
    </SettingsSection>
  );
}

// Settings -> Payment ways (DOMAIN.md "Payment Way"): per person, the account
// a typed "paynow" or "cash" means. Each select saves straight away.
export function SettingsPaymentWaysSection({
  accounts,
  draft,
  error,
  isOpen,
  isSubmitting,
  status,
  summary,
  onChange,
  onToggle
}) {
  return (
    <SettingsSection title={settingsMessages.paymentWaysTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      <div className="settings-payment-ways">
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {status ? <p className="settings-shortcut-status" role="status" aria-live="polite">{status}</p> : null}
        {draft.map((way) => {
          const options = buildPaymentWayAccountOptions(accounts, way.personId);
          const bankId = `payment-way-bank-${way.personId}`;
          const cashId = `payment-way-cash-${way.personId}`;
          const bankAccount = options.bankTransfer.find((account) => account.id === way.bankTransferAccountId);
          const cashAccount = options.cash.find((account) => account.id === way.cashAccountId);
          const hasNoCashAccounts = options.cash.length === 0;
          return (
            <fieldset key={way.personId} className="settings-payment-way-person">
              <legend><MetaChip person={way.personName}>{way.personName}</MetaChip></legend>
              <DetailRows>
                <DetailRow
                  label={settingsMessages.paymentWaysBankLabel}
                  value={bankAccount ? settingsMessages.paymentWaysAccountOption(bankAccount.name, bankAccount.ownerLabel) : null}
                  emptyLabel={settingsMessages.paymentWaysChoose}
                >
                  <select
                    id={bankId}
                    className="lsd-row-native"
                    aria-label={settingsMessages.paymentWaysBankLabel}
                    value={way.bankTransferAccountId}
                    disabled={isSubmitting}
                    onChange={(event) => void onChange(way.personId, { bankTransferAccountId: event.target.value })}
                  >
                    <option value="">{settingsMessages.paymentWaysNone}</option>
                    {options.bankTransfer.map((account) => (
                      <option key={account.id} value={account.id}>
                        {settingsMessages.paymentWaysAccountOption(account.name, account.ownerLabel)}
                      </option>
                    ))}
                  </select>
                </DetailRow>
                <DetailRow
                  label={settingsMessages.paymentWaysCashLabel}
                  value={cashAccount ? settingsMessages.paymentWaysAccountOption(cashAccount.name, cashAccount.ownerLabel) : null}
                  emptyLabel={hasNoCashAccounts ? settingsMessages.paymentWaysNoAccount : settingsMessages.paymentWaysChoose}
                >
                  <select
                    id={cashId}
                    className="lsd-row-native"
                    aria-label={settingsMessages.paymentWaysCashLabel}
                    value={way.cashAccountId}
                    disabled={isSubmitting || hasNoCashAccounts}
                    aria-describedby={hasNoCashAccounts ? `${cashId}-help` : undefined}
                    onChange={(event) => void onChange(way.personId, { cashAccountId: event.target.value })}
                  >
                    <option value="">{settingsMessages.paymentWaysNone}</option>
                    {options.cash.map((account) => (
                      <option key={account.id} value={account.id}>
                        {settingsMessages.paymentWaysAccountOption(account.name, account.ownerLabel)}
                      </option>
                    ))}
                  </select>
                </DetailRow>
              </DetailRows>
              {hasNoCashAccounts ? (
                <small id={`${cashId}-help`} className="settings-hint">{settingsMessages.paymentWaysNoCashAccounts}</small>
              ) : null}
            </fieldset>
          );
        })}
      </div>
    </SettingsSection>
  );
}

export function SettingsCategoriesSection({
  categories,
  isOpen,
  summary,
  onToggle,
  onCreateCategory,
  onEditCategory,
  onDeleteCategory
}) {
  return (
    <SettingsSection title={settingsMessages.categoriesTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      <DetailRows>
        {categories.map((category) => (
          <SplitRow
            key={category.id}
            className="settings-category-row"
            trailing={(
              <DeleteRowButton
                label={category.name}
                triggerLabel={settingsMessages.deleteCategory}
                confirmLabel={settingsMessages.deleteCategory}
                destructive={false}
                buttonClassName="settings-row-icon"
                prompt={settingsMessages.deleteCategoryDetail(category.name)}
                onConfirm={() => onDeleteCategory(category)}
              />
            )}
          >
            <button
              type="button"
              className="settings-row-main"
              aria-label={`${settingsMessages.editCategory} ${category.name}`}
              onClick={() => onEditCategory(category)}
            >
              <span
                className="category-icon category-icon-static settings-category-icon"
                style={{ "--category-color": paletteColour(category.colorHex) }}
              >
                <CategoryGlyph iconKey={category.iconKey} />
              </span>
              <span className="settings-row-name">{category.name}</span>
              <ChevronRight size={16} aria-hidden="true" className="lsd-row-chevron" />
            </button>
          </SplitRow>
        ))}
        <AddRow onClick={onCreateCategory}>{settingsMessages.addCategory}</AddRow>
      </DetailRows>
    </SettingsSection>
  );
}

// One category rule: the merchant text opens the editor; a delete sits at the
// end. Inactive rules are muted.
function RuleRow({ rule, onEditRule, onDeleteRule, detail, className = "" }) {
  return (
    <SplitRow
      className={`settings-rule-row${rule.isActive === false ? " is-muted" : ""}${className ? ` ${className}` : ""}`}
      trailing={(
        <DeleteRowButton
          label={rule.pattern}
          triggerLabel={settingsMessages.deleteCategoryRule}
          confirmLabel={settingsMessages.deleteCategoryRule}
          destructive={false}
          buttonClassName="settings-row-icon"
          prompt={settingsMessages.deleteCategoryRuleDetail(rule.pattern)}
          onConfirm={() => onDeleteRule(rule)}
        />
      )}
    >
      <button type="button" className="settings-row-main" aria-label={`${settingsMessages.editCategoryRule} ${rule.pattern}`} onClick={() => onEditRule(rule)}>
        <span className="settings-row-text">
          <strong>{rule.pattern}</strong>
          <small>{detail}</small>
        </span>
        <ChevronRight size={16} aria-hidden="true" className="lsd-row-chevron" />
      </button>
    </SplitRow>
  );
}

export function SettingsCategoryMatchRulesSection({
  id,
  rules,
  categories,
  suggestions,
  backfills = [],
  ignoredIssueIds = [],
  isOpen,
  summary,
  onToggle,
  onCreateRule,
  onEditRule,
  onDeleteRule,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion,
  onIgnoreIssue,
  onApplyBackfill,
  aiStatus = "",
  isAiWorking = false,
  onRequestAiSuggestions
}) {
  const ruleGroups = useMemo(() => groupCategoryMatchRules(rules, categories), [categories, rules]);
  const duplicateRuleIssues = useMemo(() => findDuplicateCategoryMatchRules(rules, ignoredIssueIds), [ignoredIssueIds, rules]);
  // Groups start folded: the page showed every rule of every category at
  // once. "Expand all" opens them.
  const [areRuleGroupsExpanded, setAreRuleGroupsExpanded] = useState(false);

  return (
    <SettingsSection id={id} title={settingsMessages.categoryRulesTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      {duplicateRuleIssues.length ? (
        <section className="settings-attention-panel settings-duplicate-rule-panel">
          <div className="settings-panel-head">
            <strong>{settingsMessages.categoryRuleDuplicatesTitle}</strong>
            <MetaChip tone="butter">{settingsMessages.categoryRuleDuplicatesCount(duplicateRuleIssues.length)}</MetaChip>
          </div>
          <p className="settings-hint">{settingsMessages.categoryRuleDuplicatesDetail}</p>
          <div className="settings-duplicate-rule-list">
            {duplicateRuleIssues.map((issue) => (
              <div key={issue.id} className={`settings-duplicate-rule-issue is-${issue.kind}`}>
                <div className="settings-duplicate-rule-summary">
                  <strong>{settingsMessages.categoryRuleDuplicateKind(issue.kind)}</strong>
                  <p>{settingsMessages.categoryRuleDuplicateDetail(issue.rules[0], issue.rules[1])}</p>
                  <button type="button" className="subtle-action" onClick={() => onIgnoreIssue(issue)}>
                    {settingsMessages.ignoreCategoryRuleIssue}
                  </button>
                </div>
                <DetailRows>
                  {issue.rules.map((rule) => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      className="settings-duplicate-rule-row"
                      detail={messages.common.triplet(rule.categoryName, settingsMessages.categoryRulePriorityValue(rule.priority), rule.note || messages.common.emptyValue)}
                      onEditRule={onEditRule}
                      onDeleteRule={onDeleteRule}
                    />
                  ))}
                </DetailRows>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {backfills.length ? (
        <section className="settings-attention-panel settings-rule-backfill-panel" aria-label={settingsMessages.categoryRuleBackfillsTitle}>
          <div className="settings-panel-head">
            <strong>{settingsMessages.categoryRuleBackfillsTitle}</strong>
            <MetaChip tone="sky">{settingsMessages.categoryRuleBackfillsCount(backfills.length)}</MetaChip>
          </div>
          <p className="settings-hint">{settingsMessages.categoryRuleBackfillsDetail}</p>
          <div className="settings-suggestion-list">
            {backfills.map((backfill) => (
              <div key={backfill.ruleId} className="settings-suggestion-row">
                <div className="settings-suggestion-main">
                  <strong>{backfill.pattern}</strong>
                  <p>{settingsMessages.categoryRuleBackfillSummary(backfill.categoryName, backfill.entryCount)}</p>
                  <ul className="settings-rule-suggestion-samples">
                    {backfill.sampleDescriptions.map((sample) => (
                      <li key={sample}>{sample}</li>
                    ))}
                  </ul>
                </div>
                <div className="settings-suggestion-actions">
                  <button type="button" className="subtle-action" onClick={() => onApplyBackfill(backfill)}>
                    {settingsMessages.applyCategoryRuleBackfill(backfill.entryCount)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {suggestions.length ? (
        <section className="settings-attention-panel settings-suggestion-panel">
          <div className="settings-panel-head">
            <strong>{settingsMessages.categoryRuleSuggestionsTitle}</strong>
            <MetaChip tone="sky">{settingsMessages.categoryRuleSuggestionsCount(suggestions.length)}</MetaChip>
          </div>
          <p className="settings-hint">{settingsMessages.categoryRuleSuggestionsDetail}</p>
          <div className="settings-suggestion-list">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="settings-suggestion-row">
                <div className="settings-suggestion-main">
                  <strong>{suggestion.pattern}</strong>
                  <p>{messages.common.triplet(suggestion.categoryName, settingsMessages.categoryRuleSuggestionSeen(suggestion.sourceCount), suggestion.sampleDescriptions[0] ?? messages.common.emptyValue)}</p>
                  {suggestion.sampleDescriptions.length > 1 ? (
                    <ul className="settings-rule-suggestion-samples">
                      {suggestion.sampleDescriptions.slice(1).map((sample) => (
                        <li key={sample}>{sample}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="settings-suggestion-actions">
                  <button type="button" className="subtle-action" onClick={() => onAcceptSuggestion(suggestion)}>
                    {settingsMessages.acceptCategoryRuleSuggestion}
                  </button>
                  <button type="button" className="subtle-action" onClick={() => onEditSuggestion(suggestion)}>
                    {settingsMessages.editCategoryRuleSuggestion}
                  </button>
                  <button type="button" className="subtle-action muted-action" onClick={() => onIgnoreSuggestion(suggestion)}>
                    {settingsMessages.ignoreCategoryRuleSuggestion}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <DetailRows>
        <MoreDetails label={settingsMessages.categoryRulesHowTitle} openLabel={settingsMessages.categoryRulesHowTitle}>
          <div className="settings-detail-block">
            <p className="settings-hint">{settingsMessages.categoryRulesDetail}</p>
          </div>
        </MoreDetails>
        <AddRow onClick={onCreateRule}>{settingsMessages.addCategoryRule}</AddRow>
      </DetailRows>
      <div className="settings-actions">
        <button type="button" className="subtle-action" onClick={onRequestAiSuggestions} disabled={isAiWorking}>
          {isAiWorking ? "Preparing suggestions..." : "Suggest rules from history"}
        </button>
        {ruleGroups.length ? (
          <button
            type="button"
            className="subtle-action"
            onClick={() => setAreRuleGroupsExpanded((current) => !current)}
          >
            {areRuleGroupsExpanded ? settingsMessages.collapseCategoryRules : settingsMessages.expandCategoryRules}
          </button>
        ) : null}
      </div>
      {aiStatus ? <p className="settings-hint" aria-live="polite">{aiStatus}</p> : null}
      <div className="settings-rule-list">
        {ruleGroups.length ? ruleGroups.map((group) => (
          <details key={`${group.categoryName}-${areRuleGroupsExpanded ? "open" : "closed"}`} className="settings-rule-group" open={areRuleGroupsExpanded}>
            <summary className="settings-rule-group-header">
              <span className="settings-rule-group-title">
                {group.category ? (
                  <span
                    className="category-icon category-icon-static settings-rule-category-icon"
                    style={{ "--category-color": paletteColour(group.category.colorHex) }}
                  >
                    <CategoryGlyph iconKey={group.category.iconKey} />
                  </span>
                ) : null}
                <strong>{group.categoryName}</strong>
              </span>
              <span className="settings-rule-group-count">{settingsMessages.categoryRuleGroupCount(group.rules.length)}</span>
            </summary>
            <div className="settings-rule-group-list">
              {group.rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  detail={messages.common.triplet(settingsMessages.categoryRulePriorityValue(rule.priority), rule.isActive ? settingsMessages.categoryRuleActive : settingsMessages.categoryRuleInactive, rule.note || messages.common.emptyValue)}
                  onEditRule={onEditRule}
                  onDeleteRule={onDeleteRule}
                />
              ))}
            </div>
          </details>
        )) : (
          <EmptyState>{settingsMessages.categoryRulesEmpty}</EmptyState>
        )}
      </div>
    </SettingsSection>
  );
}

const RECONCILIATION_EXCEPTION_KINDS = [
  "missing_bank_row",
  "extra_ledger_row",
  "duplicate",
  "direction_mismatch",
  "wrong_account",
  "timing_difference",
  "manual_review",
  "adjustment_needed"
];

const RECONCILIATION_EXCEPTION_SEVERITIES = ["review", "blocking", "info"];
const SEVERITY_TONES = { review: "butter", blocking: "rose", info: "sky" };

function buildEmptyExceptionDraft(accounts) {
  return {
    accountId: accounts[0]?.id ?? "",
    checkpointMonth: "",
    kind: "manual_review",
    severity: "review",
    title: "",
    note: ""
  };
}

export function SettingsTrustSection({
  accounts = [],
  exceptions = [],
  isOpen,
  isSubmitting,
  summary,
  onToggle,
  onCreateException,
  onResolveException
}) {
  const [draftOpen, setDraftOpen] = useState(false);
  useRouteWorkBusy(draftOpen);
  const [draft, setDraft] = useState(() => buildEmptyExceptionDraft(accounts));
  const visibleExceptions = exceptions.slice(0, 12);
  const openExceptionCount = exceptions.filter((item) => item.status === "open").length;
  const guides = [
    { title: settingsMessages.trustOpeningTitle, detail: settingsMessages.trustOpeningDetail, action: settingsMessages.trustOpeningAction },
    { title: settingsMessages.trustCheckpointTitle, detail: settingsMessages.trustCheckpointDetail, action: settingsMessages.trustCheckpointAction },
    { title: settingsMessages.trustTransfersTitle, detail: settingsMessages.trustTransfersDetail, action: settingsMessages.trustTransfersAction }
  ];

  function updateDraft(nextValues) {
    setDraft((current) => ({ ...current, ...nextValues }));
  }

  async function handleCreateException() {
    if (!draft.title.trim()) {
      return;
    }

    const didSave = await onCreateException?.({
      accountId: draft.accountId || undefined,
      checkpointMonth: draft.checkpointMonth || undefined,
      kind: draft.kind,
      severity: draft.severity,
      title: draft.title.trim(),
      note: draft.note.trim() || undefined
    });
    if (didSave) {
      setDraftOpen(false);
      setDraft(buildEmptyExceptionDraft(accounts));
    }
  }

  return (
    <SettingsSection
      title={settingsMessages.trustRulesTitle}
      value={summary?.text}
      valueTone={summary?.tone}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {openExceptionCount ? (
        <p className="settings-hint settings-hint-strong">{settingsMessages.trustRulesDetailWithExceptions(openExceptionCount)}</p>
      ) : null}
      <DetailRows>
        {guides.map((guide) => (
          <MoreDetails key={guide.title} label={guide.title} openLabel={guide.title}>
            <div className="settings-detail-block">
              <p className="settings-hint">{guide.detail}</p>
              <p className="settings-hint settings-hint-action">{guide.action}</p>
            </div>
          </MoreDetails>
        ))}
      </DetailRows>

      <div className="settings-exception-panel">
        <div className="settings-panel-head">
          <div>
            <h3>{settingsMessages.reconciliationExceptionsTitle}</h3>
            <p className="settings-hint">{settingsMessages.reconciliationExceptionsDetail}</p>
          </div>
        </div>

        {draftOpen ? (
          <form
            className="settings-exception-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (isSubmitting || !draft.title.trim()) {
                return;
              }
              void handleCreateException();
            }}
          >
            <label>
              <span>{settingsMessages.exceptionAccountLabel}</span>
              <select
                className="table-edit-input"
                value={draft.accountId}
                onChange={(event) => updateDraft({ accountId: event.target.value })}
              >
                <option value="">{settingsMessages.exceptionNoAccount}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{settingsMessages.exceptionMonthLabel}</span>
              <input
                className="table-edit-input"
                type="month"
                enterKeyHint="next"
                value={draft.checkpointMonth}
                onChange={(event) => updateDraft({ checkpointMonth: event.target.value })}
              />
            </label>
            <label>
              <span>{settingsMessages.exceptionKindLabel}</span>
              <select
                className="table-edit-input"
                value={draft.kind}
                onChange={(event) => updateDraft({ kind: event.target.value })}
              >
                {RECONCILIATION_EXCEPTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{settingsMessages.exceptionKindLabels[kind]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{settingsMessages.exceptionSeverityLabel}</span>
              <select
                className="table-edit-input"
                value={draft.severity}
                onChange={(event) => updateDraft({ severity: event.target.value })}
              >
                {RECONCILIATION_EXCEPTION_SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>{settingsMessages.exceptionSeverityLabels[severity]}</option>
                ))}
              </select>
            </label>
            <label className="settings-exception-form-wide">
              <span>{settingsMessages.exceptionTitleLabel}</span>
              <input
                className="table-edit-input"
                enterKeyHint="done"
                value={draft.title}
                onChange={(event) => updateDraft({ title: event.target.value })}
                placeholder={settingsMessages.exceptionTitlePlaceholder}
              />
            </label>
            <label className="settings-exception-form-wide">
              <span>{settingsMessages.exceptionNoteLabel}</span>
              <textarea
                className="table-edit-input"
                rows={3}
                value={draft.note}
                onChange={(event) => updateDraft({ note: event.target.value })}
                placeholder={settingsMessages.exceptionNotePlaceholder}
              />
            </label>
            <div className="settings-exception-form-actions">
              <button
                type="submit"
                className="subtle-action is-primary"
                disabled={isSubmitting || !draft.title.trim()}
              >
                {isSubmitting ? messages.common.working : settingsMessages.saveReconciliationException}
              </button>
            </div>
          </form>
        ) : null}

        <DetailRows>
          {visibleExceptions.length ? visibleExceptions.map((item) => (
            <div key={item.id} className={`lsd-row settings-exception-row is-${item.status}`}>
              <div className="settings-exception-main">
                <strong>{item.title}</strong>
                <p>{formatExceptionMeta(item)}</p>
                {item.note ? <small>{item.note}</small> : null}
                <div className="settings-exception-status">
                  <MetaChip tone={SEVERITY_TONES[item.severity]}>
                    {settingsMessages.exceptionSeverityLabels[item.severity]}
                  </MetaChip>
                  <MetaChip tone={item.status === "open" ? "butter" : "mint"}>
                    {item.status === "open" ? settingsMessages.exceptionOpen : settingsMessages.exceptionResolved}
                  </MetaChip>
                </div>
              </div>
              {item.status === "open" ? (
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isSubmitting}
                  onClick={() => onResolveException?.(item.id)}
                >
                  {settingsMessages.resolveReconciliationException}
                </button>
              ) : null}
            </div>
          )) : (
            <div className="lsd-row is-readonly"><span className="lsd-row-label">{settingsMessages.noReconciliationExceptions}</span></div>
          )}
          <AddRow
            disabled={isSubmitting}
            onClick={() => {
              setDraftOpen((current) => !current);
              setDraft((current) => current.accountId ? current : buildEmptyExceptionDraft(accounts));
            }}
          >
            {draftOpen ? settingsMessages.cancelException : settingsMessages.addReconciliationException}
          </AddRow>
        </DetailRows>
      </div>
    </SettingsSection>
  );
}

function formatExceptionMeta(item) {
  return messages.common.triplet(
    settingsMessages.exceptionKindLabels[item.kind] ?? humanizeEnum(item.kind),
    item.accountName ?? settingsMessages.exceptionNoAccount,
    item.checkpointMonth ? formatService.formatMonthLabel(item.checkpointMonth) : formatService.formatDateOnly(item.createdAt)
  );
}

export function SettingsTransfersSection({
  transfers,
  isOpen,
  isSubmitting,
  isRefreshing,
  summary,
  onToggle,
  onDismissTransfer,
  onDismissAllTransfers,
  onRefreshTransfers,
  onOpenTransferReview,
  onManageTransfer
}) {
  const [page, setPage] = useState(1);
  const [selectedMonth, setSelectedMonth] = useState(undefined);
  const reviewModel = useMemo(
    () => buildSettingsTransferReviewModel(transfers, selectedMonth, page, SETTINGS_TRANSFER_PAGE_SIZE),
    [page, selectedMonth, transfers]
  );
  const { activeTransfers, currentPage, monthGroups, pageCount, truncatedDescriptionCount, visibleTransfers } = reviewModel;

  return (
    <SettingsSection
      title={settingsMessages.unresolvedTransfersTitle}
      value={summary?.text}
      valueTone={summary?.tone}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div className="settings-transfer-list">
        {transfers.length ? (
          <>
            <p className="settings-hint">{settingsMessages.unresolvedTransfersDetailWithCount(transfers.length)}</p>
            <div className="settings-actions settings-transfer-actions">
              <button type="button" className="subtle-action" disabled={isSubmitting || isRefreshing} onClick={onRefreshTransfers}>
                {isRefreshing ? settingsMessages.refreshingTransfers : settingsMessages.refreshTransfers}
              </button>
              <button type="button" className="subtle-action" disabled={isSubmitting} onClick={onDismissAllTransfers}>
                {settingsMessages.clearAllTransfers}
              </button>
            </div>
            {monthGroups.length > 1 ? (
              <div className="settings-transfer-months" role="list" aria-label={settingsMessages.transferMonthQueueLabel}>
                {monthGroups.map((group) => (
                  <button
                    key={group.month}
                    type="button"
                    className={`settings-transfer-month${reviewModel.activeMonth === group.month ? " active" : ""}`}
                    onClick={() => {
                      setSelectedMonth(group.month);
                      setPage(1);
                    }}
                  >
                    <span>{formatService.formatMonthLabel(group.month)}</span>
                    <strong>{group.count}</strong>
                  </button>
                ))}
              </div>
            ) : null}
            {truncatedDescriptionCount ? (
              <p className="settings-warning">{settingsMessages.transferTruncatedDescriptionWarning(truncatedDescriptionCount)}</p>
            ) : null}
            <DetailRows>
              {visibleTransfers.map((item) => (
                <div key={item.entryId} className="lsd-row settings-transfer-row">
                  <div className="settings-transfer-main">
                    <strong>{item.description}</strong>
                    <p>{messages.common.triplet(
                      formatService.formatDateOnly(item.date),
                      item.accountName,
                      item.transferDirection === "in" ? "Transfer in" : "Transfer out"
                    )}</p>
                  </div>
                  <strong className="settings-transfer-amount">{formatService.money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</strong>
                  <div className="settings-transfer-buttons">
                    <button type="button" className="subtle-action" onClick={() => onOpenTransferReview(item)}>
                      {settingsMessages.openTransferReview}
                    </button>
                    <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onManageTransfer(item.entryId)}>
                      {settingsMessages.manageTransferReview}
                    </button>
                    <button type="button" className="subtle-action muted-action" disabled={isSubmitting} onClick={() => onDismissTransfer(item.entryId)}>
                      {settingsMessages.clearTransfer}
                    </button>
                  </div>
                </div>
              ))}
            </DetailRows>
            {pageCount > 1 ? (
              <div className="import-history-pagination settings-transfer-pagination">
                <span>{settingsMessages.transferPage(currentPage, pageCount, activeTransfers.length)}</span>
                <div className="import-history-pagination-actions">
                  <button type="button" className="subtle-action" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    {importMessages.previousPage}
                  </button>
                  <button type="button" className="subtle-action" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
                    {importMessages.nextPage}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState>{settingsMessages.unresolvedTransfersEmpty}</EmptyState>
        )}
      </div>
    </SettingsSection>
  );
}

// Ask and AI (design.md "Claude credit notice"; "Settings"): a lead that says
// who answers Ask and the credit state as one chip, then the Claude credit
// line, the Claude Console link and "I've topped up", and when the status was
// last read. Shown only to a viewer the server lets see the status.
export function SettingsAskAiSection({ status, checkedAt, isOpen, onToggle, onMarkToppedUp }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [formOpen, setFormOpen] = useState(false);
  const line = buildClaudeCreditLine(status, { areTotalsVisible });
  if (!line) {
    return null;
  }
  const lead = describeAskAi(status);
  return (
    <SettingsSection
      id="settings-ask-ai"
      title={claudeCreditCopy.settingsTitle}
      value={lead.modelName}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div className="settings-claude-credit" data-credit-state={line.state}>
        <LeadCard
          className="settings-lead"
          accentColor="var(--accent-strong)"
          category={{ icon: Sparkles }}
          title={claudeCreditCopy.settingsLead.title}
          subtitle={lead.subtitle}
          chips={<MetaChip tone={lead.chip.tone} icon={lead.chip.tone === "mint" ? ShieldCheck : undefined}>{lead.chip.text}</MetaChip>}
        />
        <DetailRows>
          <DetailRow label={claudeCreditCopy.settingsLead.modelLabel} value={lead.modelName} readOnly />
          {checkedAt ? <DetailRow label={claudeCreditCopy.lastCheckedLabel} value={formatService.formatDate(checkedAt)} readOnly /> : null}
        </DetailRows>
        <p className={`claude-credit-line is-${line.tone}`}>{line.text}</p>
        {line.monthText ? <p className="claude-credit-month">{line.monthText}</p> : null}
        {line.actions.length ? <ClaudeCreditActions actions={line.actions} onToppedUp={() => setFormOpen(true)} /> : null}
      </div>
      {formOpen ? <ClaudeTopUpForm onClose={() => setFormOpen(false)} onSave={onMarkToppedUp} /> : null}
    </SettingsSection>
  );
}

export function SettingsActivitySection({ activityGroups, isOpen, summary, onToggle }) {
  return (
    <SettingsSection title={settingsMessages.recentActivityTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      <p className="settings-hint">{settingsMessages.recentActivityDetail}</p>
      <div className="settings-activity-groups">
        {activityGroups.length ? activityGroups.map((group) => (
          <section key={group.date} className="settings-activity-group">
            <div className="settings-activity-date">{formatService.formatDateOnly(group.date)}</div>
            <DetailRows>
              {group.events.map((event) => (
                <div key={event.id} className="lsd-row settings-activity-row">
                  <div className="settings-activity-main">
                    <strong>{accountService.formatAuditAction(event.action)}</strong>
                    <p>{event.detail}</p>
                  </div>
                  <p className="settings-account-meta">{formatService.formatDate(event.createdAt)}</p>
                </div>
              ))}
            </DetailRows>
          </section>
        )) : (
          <EmptyState>{settingsMessages.recentActivityEmpty}</EmptyState>
        )}
      </div>
    </SettingsSection>
  );
}

export function SettingsErrorDiagnosticsSection({ diagnostics, isOpen, summary, onToggle, isSubmitting, onRetainLatest }) {
  const pageSize = 10;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(diagnostics.length / pageSize));
  const visibleDiagnostics = diagnostics.slice((page - 1) * pageSize, page * pageSize);

  return (
    <SettingsSection id="settings-error-diagnostics" title={settingsMessages.errorDiagnosticsTitle} value={summary?.text} isOpen={isOpen} onToggle={onToggle}>
      <div className="settings-diagnostics">
        <p className="settings-hint">{settingsMessages.errorDiagnosticsDetail}</p>
        {visibleDiagnostics.length ? (
          <>
            <div className="settings-diagnostic-list">
              {visibleDiagnostics.map((diagnostic) => (
                <details key={diagnostic.id} className="settings-diagnostic-row">
                  <summary>
                    <span>
                      <strong>{diagnostic.action}</strong>
                      <span>{formatService.formatDate(diagnostic.createdAt)}</span>
                    </span>
                    <span>{settingsMessages.errorDiagnosticsStatus(diagnostic)}</span>
                  </summary>
                  <div className="settings-diagnostic-body">
                    <dl className="settings-diagnostic-grid">
                      <div>
                        <dt>{settingsMessages.errorDiagnosticsPreviousAction}</dt>
                        <dd>{diagnostic.previousAction || messages.common.emptyValue}</dd>
                      </div>
                      <div>
                        <dt>{settingsMessages.errorDiagnosticsRoute}</dt>
                        <dd>{[diagnostic.method, diagnostic.route].filter(Boolean).join(" ") || messages.common.emptyValue}</dd>
                      </div>
                      <div>
                        <dt>{settingsMessages.errorDiagnosticsContentType}</dt>
                        <dd>{diagnostic.contentType || messages.common.emptyValue}</dd>
                      </div>
                      <div>
                        <dt>{settingsMessages.errorDiagnosticsPossibleReason}</dt>
                        <dd>{diagnostic.possibleReason || settingsMessages.errorDiagnosticsUnknownReason}</dd>
                      </div>
                    </dl>
                    <div className="settings-diagnostic-block">
                      <strong>{settingsMessages.errorDiagnosticsShownMessage}</strong>
                      <p>{diagnostic.errorMessage}</p>
                    </div>
                    {diagnostic.requestContextJson ? (
                      <div className="settings-diagnostic-block">
                        <strong>{settingsMessages.errorDiagnosticsRequestContext}</strong>
                        <pre>{diagnostic.requestContextJson}</pre>
                      </div>
                    ) : null}
                    {diagnostic.responseBody ? (
                      <div className="settings-diagnostic-block">
                        <strong>{settingsMessages.errorDiagnosticsResponseBody}</strong>
                        <pre>{diagnostic.responseBody}</pre>
                      </div>
                    ) : diagnostic.responseExcerpt ? (
                      <div className="settings-diagnostic-block">
                        <strong>{settingsMessages.errorDiagnosticsResponseBody}</strong>
                        <pre>{diagnostic.responseExcerpt}</pre>
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
            <div className="import-history-pagination">
              <span>{settingsMessages.errorDiagnosticsPage(page, pageCount, diagnostics.length)}</span>
              <div>
                <button type="button" className="subtle-action" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  {importMessages.previousPage}
                </button>
                <button type="button" className="subtle-action" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                  {importMessages.nextPage}
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState>{settingsMessages.errorDiagnosticsEmpty}</EmptyState>
        )}
        <DetailRows>
          <MoreDetails label={settingsMessages.errorDiagnosticsKeepTitle} openLabel={settingsMessages.errorDiagnosticsKeepTitle}>
            <div className="settings-detail-block">
              <p className="settings-hint">{settingsMessages.errorDiagnosticsRetentionDetail}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isSubmitting || diagnostics.length === 0}
                  onClick={onRetainLatest}
                >
                  {settingsMessages.errorDiagnosticsRetainLatest}
                </button>
              </div>
            </div>
          </MoreDetails>
        </DetailRows>
      </div>
    </SettingsSection>
  );
}

export function SettingsDemoSection({
  demo,
  error,
  emptyStateDialogOpen,
  emptyStateText,
  isOpen,
  isSubmitting,
  reloadDialogOpen,
  reloadText,
  onEmptyStateDialogOpenChange,
  onReloadDialogOpenChange,
  onToggle,
  onEmptyStateTextChange,
  onReloadTextChange,
  onReseed,
  onRefresh,
  onEmptyState
}) {
  return (
    <SettingsSection
      title={settingsMessages.demoTitle}
      value={demo.emptyState ? settingsMessages.emptyMode : settingsMessages.seededMode}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <DetailRows>
        <DetailRow label={settingsMessages.state} value={demo.emptyState ? settingsMessages.emptyMode : settingsMessages.seededMode} readOnly />
        <DetailRow label={settingsMessages.seededAt} value={formatService.formatDate(demo.lastSeededAt)} readOnly />
      </DetailRows>
      <p className="settings-hint">{settingsMessages.demoDetail}</p>
      <div className="settings-actions">
        <button type="button" className="subtle-action" onClick={onReseed} disabled={isSubmitting}>
          {isSubmitting ? messages.common.working : settingsMessages.reseed}
        </button>
        <button type="button" className="subtle-action" disabled={isSubmitting} aria-haspopup="dialog" onClick={() => onReloadDialogOpenChange(true)}>
          {settingsMessages.refresh}
        </button>
        <button type="button" className="subtle-action subtle-danger" disabled={isSubmitting} aria-haspopup="dialog" onClick={() => onEmptyStateDialogOpenChange(true)}>
          {settingsMessages.emptyState}
        </button>
        {reloadDialogOpen ? (
          <TypedConfirmDialog
            icon={RefreshCw}
            title={settingsMessages.reloadDataTitle}
            detail={settingsMessages.reloadDataDetail}
            closeLabel="Close reload app data dialog"
            placeholder={settingsMessages.reloadDataPlaceholder}
            phrase="reload data"
            confirmLabel={settingsMessages.reloadDataConfirm}
            text={reloadText}
            isWorking={isSubmitting}
            onTextChange={onReloadTextChange}
            onConfirm={onRefresh}
            onClose={() => onReloadDialogOpenChange(false)}
          />
        ) : null}
        {emptyStateDialogOpen ? (
          <TypedConfirmDialog
            danger
            icon={Trash2}
            title={settingsMessages.emptyState}
            detail={settingsMessages.emptyStateDetail}
            closeLabel="Close empty-state dialog"
            placeholder={settingsMessages.emptyStatePlaceholder}
            phrase="empty state"
            confirmLabel={settingsMessages.emptyStateConfirm}
            text={emptyStateText}
            isWorking={isSubmitting}
            onTextChange={onEmptyStateTextChange}
            onConfirm={onEmptyState}
            onClose={() => onEmptyStateDialogOpenChange(false)}
          />
        ) : null}
      </div>
      <p className="settings-hint">{settingsMessages.refreshHint}</p>
    </SettingsSection>
  );
}

// Reload and Empty state ask for the words typed first. Reload replaces the
// data, so it is a neutral confirmation; Empty state deletes it, so it is rose.
function TypedConfirmDialog({ danger = false, icon, title, detail, closeLabel, placeholder, phrase, confirmLabel, text, isWorking, onTextChange, onConfirm, onClose }) {
  return (
    <SheetDialog
      tone={danger ? "danger" : undefined}
      title={title}
      description={detail}
      descriptionHidden
      closeLabel={closeLabel}
      lead={(
        <ConfirmLead icon={icon} title={title}>
          <p className="lsd-note">{detail}</p>
        </ConfirmLead>
      )}
      primaryLabel={isWorking ? messages.common.working : confirmLabel}
      primaryDisabled={text.trim().toLowerCase() !== phrase || isWorking}
      isSubmitting={isWorking}
      onSubmit={onConfirm}
      onClose={onClose}
    >
      <label className="sheet-dialog-field">
        <input
          className="table-edit-input"
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
      </label>
    </SheetDialog>
  );
}
