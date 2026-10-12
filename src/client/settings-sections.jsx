import { ArrowDown, ArrowUp, ChevronRight, ExternalLink, Eye, EyeOff, GripVertical, RefreshCw, ShieldCheck, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { buildClaudeCreditLine } from "./claude-credit-model";
import { ClaudeCreditActions, ClaudeTopUpForm } from "./claude-credit-notice";
import { claudeCreditCopy } from "./copy/claude-credit-copy";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { settingsMessages } from "./copy/en-SG-settings";
import { useMoneyPrivacy } from "./money-privacy";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { EmptyState } from "./ui-states";
import { moniesClient } from "./monies-client-service";
import { buildSettingsTransferReviewModel, SETTINGS_TRANSFER_PAGE_SIZE } from "./settings-transfer-review-model";
import { buildPaymentWayAccountOptions, findDuplicateCategoryMatchRules } from "./settings-workflow";
import { DeleteRowButton } from "./delete-row-button";
import { CategoryGlyph } from "./ui-components";
import { useRouteWorkBusy } from "./use-route-work-status";

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

function SettingsSectionToggle({ title, detail, isOpen, onToggle }) {
  return (
    <button
      type="button"
      className="settings-section-toggle"
      onClick={onToggle}
      aria-expanded={isOpen}
    >
      <div className="settings-section-toggle-copy">
        <div className="chart-head">
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
      </div>
      <span className={`settings-section-toggle-icon ${isOpen ? "is-open" : ""}`}>
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

export function SettingsPeopleSection({ people, isOpen, onToggle, onEditPerson }) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.peopleTitle}
        detail={settingsMessages.peopleDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-people-grid">
          {people.map((person) => (
            <div key={person.id} className="settings-account-row settings-person-card">
              <div className="settings-account-main">
                <strong>{person.name}</strong>
                <p>{settingsMessages.personUsageHint}</p>
              </div>
              <div className="settings-account-actions">
                <button type="button" className="icon-action" aria-label={settingsMessages.editPerson} onClick={() => onEditPerson(person)}>
                  <SquarePen size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsShortcutApiSection({
  accounts,
  draft,
  error,
  isOpen,
  isSubmitting,
  shortcutSettings,
  status,
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
  useRouteWorkBusy(isInstalling);
  const accountsById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const orderedAccounts = draft.defaultAccountPriorityIds
    .map((accountId) => accountsById.get(accountId))
    .filter(Boolean);
  const endpoint = new URL(shortcutSettings.endpointPath, window.location.origin).toString();

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
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.shortcutApiTitle}
        detail={settingsMessages.shortcutApiDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-shortcut-grid">
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {status ? <p className="settings-shortcut-status" role="status" aria-live="polite">{status}</p> : null}
          <div className="settings-shortcut-install">
            <div className="settings-shortcut-install-copy">
              <span className="settings-shortcut-install-icon" aria-hidden="true"><ShieldCheck size={18} /></span>
              <div>
                <strong>{settingsMessages.shortcutInstallTitle}</strong>
                <p>{settingsMessages.shortcutInstallDetail}</p>
              </div>
            </div>
            <button
              type="button"
              className="settings-shortcut-install-button"
              disabled={isSubmitting || isInstalling || orderedAccounts.length === 0}
              onClick={() => void handleInstallShortcut()}
            >
              <ExternalLink size={16} aria-hidden="true" />
              {isInstalling ? settingsMessages.shortcutInstalling : settingsMessages.shortcutInstall}
            </button>
          </div>
          <ol className="settings-shortcut-steps">
            <li>{settingsMessages.shortcutInstallStep}</li>
            <li>{settingsMessages.shortcutPasteStep}</li>
            <li>{settingsMessages.shortcutAutomationStep}</li>
            <li>{settingsMessages.shortcutAutomationRunStep}</li>
          </ol>
          <details className="settings-shortcut-advanced">
            <summary>{settingsMessages.shortcutAdvancedTitle}</summary>
            <div className="settings-shortcut-advanced-content">
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
                    className="icon-action"
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
                <button type="button" className="subtle-action" onClick={onSave} disabled={isSubmitting || !draft.apiKey.trim() || orderedAccounts.length === 0}>
                  {isSubmitting ? messages.common.saving : settingsMessages.shortcutSave}
                </button>
              </div>
            </div>
          </details>
          <div className="settings-shortcut-priority">
            <div className="chart-head">
              <h3>{settingsMessages.shortcutDefaultAccountsTitle}</h3>
              <p>{settingsMessages.shortcutDefaultAccountsDetail}</p>
            </div>
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
                    <p>{messages.common.triplet(account.institution, account.kind, account.ownerLabel)}</p>
                  </div>
                  <div className="settings-account-actions">
                    <button
                      type="button"
                      className="icon-action"
                      aria-label={settingsMessages.shortcutMoveAccountUp(account.name)}
                      disabled={isSubmitting || index === 0}
                      onClick={() => void onMoveAccount(index, index - 1)}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-action"
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
          <div className="settings-shortcut-priority">
            <div className="chart-head">
              <h3>{settingsMessages.shortcutForeignCurrencyTitle}</h3>
              <p>{settingsMessages.shortcutForeignCurrencyDetail}</p>
            </div>
            <label className="table-edit-field">
              <span>{settingsMessages.shortcutForeignCurrencyLabel}</span>
              <select
                className="table-edit-input"
                value={draft.foreignCurrencyAccountId}
                disabled={isSubmitting}
                onChange={(event) => void onForeignCurrencyAccountChange(event.target.value)}
              >
                <option value="">{settingsMessages.shortcutForeignCurrencySame}</option>
                {orderedAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </section>
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
  onChange,
  onToggle
}) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.paymentWaysTitle}
        detail={settingsMessages.paymentWaysDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-payment-ways">
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {status ? <p className="settings-shortcut-status" role="status" aria-live="polite">{status}</p> : null}
          {draft.map((way) => {
            const options = buildPaymentWayAccountOptions(accounts, way.personId);
            const bankId = `payment-way-bank-${way.personId}`;
            const cashId = `payment-way-cash-${way.personId}`;
            return (
              <fieldset key={way.personId} className="settings-account-row settings-payment-way-person">
                <legend>{way.personName}</legend>
                <div className="settings-payment-way-fields">
                  <div className="table-edit-field">
                    <label htmlFor={bankId}>{settingsMessages.paymentWaysBankLabel}</label>
                    <select
                      id={bankId}
                      className="table-edit-input"
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
                  </div>
                  <div className="table-edit-field">
                    <label htmlFor={cashId}>{settingsMessages.paymentWaysCashLabel}</label>
                    <select
                      id={cashId}
                      className="table-edit-input"
                      value={way.cashAccountId}
                      disabled={isSubmitting || options.cash.length === 0}
                      aria-describedby={options.cash.length === 0 ? `${cashId}-help` : undefined}
                      onChange={(event) => void onChange(way.personId, { cashAccountId: event.target.value })}
                    >
                      <option value="">{settingsMessages.paymentWaysNone}</option>
                      {options.cash.map((account) => (
                        <option key={account.id} value={account.id}>
                          {settingsMessages.paymentWaysAccountOption(account.name, account.ownerLabel)}
                        </option>
                      ))}
                    </select>
                    {options.cash.length === 0 ? (
                      <small id={`${cashId}-help`} className="field-help">{settingsMessages.paymentWaysNoCashAccounts}</small>
                    ) : null}
                  </div>
                </div>
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsCategoriesSection({
  categories,
  isOpen,
  onToggle,
  onCreateCategory,
  onEditCategory,
  onDeleteCategory
}) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.categoriesTitle}
        detail={settingsMessages.categoriesDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <>
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={onCreateCategory}>
              {settingsMessages.addCategory}
            </button>
          </div>
          <div className="settings-categories-grid">
            {categories.map((category) => (
              <div key={category.id} className="settings-account-row settings-category-card">
                <span
                  className="category-icon category-icon-static settings-category-icon"
                  style={{ "--category-color": category.colorHex }}
                >
                  <CategoryGlyph iconKey={category.iconKey} />
                </span>
                <div className="settings-account-main">
                  <strong>{category.name}</strong>
                  <p>{messages.common.triplet(category.slug, category.iconKey, category.colorHex)}</p>
                </div>
                <div className="settings-account-actions">
                  <button type="button" className="icon-action" aria-label={settingsMessages.editCategory} onClick={() => onEditCategory(category)}>
                    <SquarePen size={16} />
                  </button>
                  <DeleteRowButton
                    label={category.name}
                    triggerLabel={settingsMessages.deleteCategory}
                    confirmLabel={settingsMessages.deleteCategory}
                    destructive={false}
                    prompt={settingsMessages.deleteCategoryDetail(category.name)}
                    onConfirm={() => onDeleteCategory(category)}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
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
  const [areRuleGroupsExpanded, setAreRuleGroupsExpanded] = useState(true);

  return (
    <section id={id} className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.categoryRulesTitle}
        detail={settingsMessages.categoryRulesDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <>
          {duplicateRuleIssues.length ? (
            <section className="settings-duplicate-rule-panel">
              <div className="settings-rule-group-header">
                <strong>{settingsMessages.categoryRuleDuplicatesTitle}</strong>
                <span>{settingsMessages.categoryRuleDuplicatesCount(duplicateRuleIssues.length)}</span>
              </div>
              <p className="lede compact">{settingsMessages.categoryRuleDuplicatesDetail}</p>
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
                    <div className="settings-duplicate-rule-actions">
                      {issue.rules.map((rule) => (
                        <div key={rule.id} className="settings-account-row settings-rule-row settings-duplicate-rule-row">
                          <div className="settings-account-main">
                            <strong>{rule.pattern}</strong>
                            <p>{messages.common.triplet(rule.categoryName, settingsMessages.categoryRulePriorityValue(rule.priority), rule.note || messages.common.emptyValue)}</p>
                          </div>
                          <div className="settings-account-actions">
                            <button type="button" className="icon-action" aria-label={settingsMessages.editCategoryRule} onClick={() => onEditRule(rule)}>
                              <SquarePen size={16} />
                            </button>
                            <DeleteRowButton
                              label={rule.pattern}
                              triggerLabel={settingsMessages.deleteCategoryRule}
                              confirmLabel={settingsMessages.deleteCategoryRule}
                              destructive={false}
                              prompt={settingsMessages.deleteCategoryRuleDetail(rule.pattern)}
                              onConfirm={() => onDeleteRule(rule)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {backfills.length ? (
            <section className="settings-suggestion-panel settings-rule-backfill-panel" aria-label={settingsMessages.categoryRuleBackfillsTitle}>
              <div className="settings-rule-group-header">
                <strong>{settingsMessages.categoryRuleBackfillsTitle}</strong>
                <span>{settingsMessages.categoryRuleBackfillsCount(backfills.length)}</span>
              </div>
              <p className="lede compact">{settingsMessages.categoryRuleBackfillsDetail}</p>
              <div className="settings-suggestion-list">
                {backfills.map((backfill) => (
                  <div key={backfill.ruleId} className="settings-account-row settings-suggestion-row">
                    <div className="settings-account-main">
                      <strong>{backfill.pattern}</strong>
                      <p>{settingsMessages.categoryRuleBackfillSummary(backfill.categoryName, backfill.entryCount)}</p>
                      <ul className="settings-rule-suggestion-samples">
                        {backfill.sampleDescriptions.map((sample) => (
                          <li key={sample}>{sample}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="settings-account-actions settings-suggestion-actions">
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
            <section className="settings-suggestion-panel">
              <div className="settings-rule-group-header">
                <strong>{settingsMessages.categoryRuleSuggestionsTitle}</strong>
                <span>{settingsMessages.categoryRuleSuggestionsCount(suggestions.length)}</span>
              </div>
              <p className="lede compact">{settingsMessages.categoryRuleSuggestionsDetail}</p>
              <div className="settings-suggestion-list">
                {suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="settings-account-row settings-suggestion-row">
                    <div className="settings-account-main">
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
                    <div className="settings-account-actions settings-suggestion-actions">
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
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={onRequestAiSuggestions} disabled={isAiWorking}>
              {isAiWorking ? "Preparing suggestions..." : "Suggest rules from history"}
            </button>
            <button type="button" className="subtle-action" onClick={onCreateRule}>
              {settingsMessages.addCategoryRule}
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
          {aiStatus ? <p className="lede compact" aria-live="polite">{aiStatus}</p> : null}
          <div className="settings-rule-list">
            {ruleGroups.length ? ruleGroups.map((group) => (
              <details key={`${group.categoryName}-${areRuleGroupsExpanded ? "open" : "closed"}`} className="settings-rule-group" open={areRuleGroupsExpanded}>
                <summary className="settings-rule-group-header">
                  <span className="settings-rule-group-title">
                    {group.category ? (
                      <span
                        className="category-icon category-icon-static settings-rule-category-icon"
                        style={{ "--category-color": group.category.colorHex }}
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
                    <div key={rule.id} className={`settings-account-row settings-rule-row ${rule.isActive ? "" : "is-muted"}`}>
                      <div className="settings-account-main">
                        <strong>{rule.pattern}</strong>
                        <p>{messages.common.triplet(settingsMessages.categoryRulePriorityValue(rule.priority), rule.isActive ? settingsMessages.categoryRuleActive : settingsMessages.categoryRuleInactive, rule.note || messages.common.emptyValue)}</p>
                      </div>
                      <div className="settings-account-actions">
                        <button type="button" className="icon-action" aria-label={settingsMessages.editCategoryRule} onClick={() => onEditRule(rule)}>
                          <SquarePen size={16} />
                        </button>
                        <DeleteRowButton
                          label={rule.pattern}
                          triggerLabel={settingsMessages.deleteCategoryRule}
                          confirmLabel={settingsMessages.deleteCategoryRule}
                          destructive={false}
                          prompt={settingsMessages.deleteCategoryRuleDetail(rule.pattern)}
                          onConfirm={() => onDeleteRule(rule)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )) : (
              <EmptyState>{settingsMessages.categoryRulesEmpty}</EmptyState>
            )}
          </div>
        </>
      ) : null}
    </section>
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
  onToggle,
  onCreateException,
  onResolveException
}) {
  const [draftOpen, setDraftOpen] = useState(false);
  useRouteWorkBusy(draftOpen);
  const [draft, setDraft] = useState(() => buildEmptyExceptionDraft(accounts));
  const visibleExceptions = exceptions.slice(0, 12);
  const openExceptionCount = exceptions.filter((item) => item.status === "open").length;

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
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.trustRulesTitle}
        detail={openExceptionCount ? settingsMessages.trustRulesDetailWithExceptions(openExceptionCount) : settingsMessages.trustRulesDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-trust-stack">
          <div className="settings-trust-grid">
            <div className="settings-demo-meta-item">
              <span>{settingsMessages.trustOpeningTitle}</span>
              <strong>{settingsMessages.trustOpeningDetail}</strong>
              <p>{settingsMessages.trustOpeningAction}</p>
            </div>
            <div className="settings-demo-meta-item">
              <span>{settingsMessages.trustCheckpointTitle}</span>
              <strong>{settingsMessages.trustCheckpointDetail}</strong>
              <p>{settingsMessages.trustCheckpointAction}</p>
            </div>
            <div className="settings-demo-meta-item">
              <span>{settingsMessages.trustTransfersTitle}</span>
              <strong>{settingsMessages.trustTransfersDetail}</strong>
              <p>{settingsMessages.trustTransfersAction}</p>
            </div>
          </div>

          <div className="settings-exception-panel">
            <div className="settings-exception-head">
              <div>
                <h3>{settingsMessages.reconciliationExceptionsTitle}</h3>
                <p>{settingsMessages.reconciliationExceptionsDetail}</p>
              </div>
              <button
                type="button"
                className="subtle-action"
                disabled={isSubmitting}
                onClick={() => {
                  setDraftOpen((current) => !current);
                  setDraft((current) => current.accountId ? current : buildEmptyExceptionDraft(accounts));
                }}
              >
                {draftOpen ? settingsMessages.cancelException : settingsMessages.addReconciliationException}
              </button>
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
                    className="subtle-action"
                    disabled={isSubmitting || !draft.title.trim()}
                  >
                    {isSubmitting ? messages.common.working : settingsMessages.saveReconciliationException}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="settings-exception-list">
              {visibleExceptions.length ? visibleExceptions.map((item) => (
                <div key={item.id} className={`settings-account-row settings-exception-row is-${item.status}`}>
                  <div className="settings-account-main settings-exception-main">
                    <strong>{item.title}</strong>
                    <p>{formatExceptionMeta(item)}</p>
                    {item.note ? <small>{item.note}</small> : null}
                  </div>
                  <div className="settings-exception-status">
                    <span className={`entry-chip entry-chip-exception is-${item.severity}`}>
                      {settingsMessages.exceptionSeverityLabels[item.severity]}
                    </span>
                    <span className={`entry-chip entry-chip-exception-status is-${item.status}`}>
                      {item.status === "open" ? settingsMessages.exceptionOpen : settingsMessages.exceptionResolved}
                    </span>
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
                <EmptyState>{settingsMessages.noReconciliationExceptions}</EmptyState>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatExceptionMeta(item) {
  return messages.common.triplet(
    settingsMessages.exceptionKindLabels[item.kind] ?? item.kind,
    item.accountName ?? settingsMessages.exceptionNoAccount,
    item.checkpointMonth ? formatService.formatMonthLabel(item.checkpointMonth) : formatService.formatDateOnly(item.createdAt)
  );
}

export function SettingsTransfersSection({
  transfers,
  isOpen,
  isSubmitting,
  isRefreshing,
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
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.unresolvedTransfersTitle}
        detail={transfers.length ? settingsMessages.unresolvedTransfersDetailWithCount(transfers.length) : settingsMessages.unresolvedTransfersDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-transfer-list">
          {transfers.length ? (
            <>
              <div className="settings-actions settings-transfer-actions">
                <button type="button" className="subtle-action" disabled={isSubmitting} onClick={onDismissAllTransfers}>
                  {settingsMessages.clearAllTransfers}
                </button>
                <button type="button" className="subtle-action" disabled={isSubmitting || isRefreshing} onClick={onRefreshTransfers}>
                  {isRefreshing ? settingsMessages.refreshingTransfers : settingsMessages.refreshTransfers}
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
              {visibleTransfers.map((item) => (
                <div key={item.entryId} className="settings-account-row settings-transfer-row">
                  <div className="settings-account-main settings-transfer-main">
                    <strong>{item.description}</strong>
                    <p>{messages.common.triplet(
                      formatService.formatDateOnly(item.date),
                      item.accountName,
                      item.transferDirection === "in" ? "Transfer in" : "Transfer out"
                    )}</p>
                  </div>
                  <strong className="settings-transfer-amount">{formatService.money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</strong>
                  <div className="settings-account-actions">
                    <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onDismissTransfer(item.entryId)}>
                      {settingsMessages.clearTransfer}
                    </button>
                    <button type="button" className="subtle-action" onClick={() => onOpenTransferReview(item)}>
                      {settingsMessages.openTransferReview}
                    </button>
                    <button type="button" className="subtle-action" disabled={isSubmitting} onClick={() => onManageTransfer(item.entryId)}>
                      {settingsMessages.manageTransferReview}
                    </button>
                  </div>
                </div>
              ))}
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
      ) : null}
    </section>
  );
}

// Ask and AI (design.md "Claude credit notice"): the Claude credit line,
// the Claude Console link and "I've topped up", and when the status was
// last read. Shown only to a viewer the server lets see the status.
export function SettingsAskAiSection({ status, checkedAt, isOpen, onToggle, onMarkToppedUp }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const [formOpen, setFormOpen] = useState(false);
  const line = buildClaudeCreditLine(status, { areTotalsVisible });
  if (!line) {
    return null;
  }
  return (
    <section id="settings-ask-ai" className="chart-card settings-card">
      <SettingsSectionToggle
        title={claudeCreditCopy.settingsTitle}
        detail={claudeCreditCopy.settingsDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-claude-credit" data-credit-state={line.state}>
          <p className={`claude-credit-line is-${line.tone}`}>{line.text}</p>
          {line.monthText ? <p className="claude-credit-month">{line.monthText}</p> : null}
          {line.actions.length ? <ClaudeCreditActions actions={line.actions} onToppedUp={() => setFormOpen(true)} /> : null}
          {checkedAt ? <p className="claude-credit-checked">{claudeCreditCopy.lastChecked(formatService.formatDate(checkedAt))}</p> : null}
        </div>
      ) : null}
      {formOpen ? <ClaudeTopUpForm onClose={() => setFormOpen(false)} onSave={onMarkToppedUp} /> : null}
    </section>
  );
}

export function SettingsActivitySection({ activityGroups, isOpen, onToggle }) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.recentActivityTitle}
        detail={settingsMessages.recentActivityDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-activity-groups">
          {activityGroups.length ? activityGroups.map((group) => (
            <section key={group.date} className="settings-activity-group">
              <div className="settings-activity-date">{formatService.formatDateOnly(group.date)}</div>
              <div className="settings-activity-list">
                {group.events.map((event) => (
                  <div key={event.id} className="settings-account-row settings-activity-row">
                    <div className="settings-account-main">
                      <strong>{accountService.formatAuditAction(event.action)}</strong>
                      <p>{event.detail}</p>
                    </div>
                    <p className="settings-account-meta">{formatService.formatDate(event.createdAt)}</p>
                  </div>
                ))}
              </div>
            </section>
          )) : (
            <EmptyState>{settingsMessages.recentActivityEmpty}</EmptyState>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsErrorDiagnosticsSection({ diagnostics, isOpen, onToggle, isSubmitting, onRetainLatest }) {
  const pageSize = 10;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(diagnostics.length / pageSize));
  const visibleDiagnostics = diagnostics.slice((page - 1) * pageSize, page * pageSize);

  return (
    <section id="settings-error-diagnostics" className="chart-card settings-card">
      <SettingsSectionToggle
        title={settingsMessages.errorDiagnosticsTitle}
        detail={settingsMessages.errorDiagnosticsDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-diagnostics">
          <div className="settings-diagnostics-toolbar">
            <p>{settingsMessages.errorDiagnosticsRetentionDetail}</p>
            <button
              type="button"
              className="subtle-action"
              disabled={isSubmitting || diagnostics.length === 0}
              onClick={onRetainLatest}
            >
              {settingsMessages.errorDiagnosticsRetainLatest}
            </button>
          </div>
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
        </div>
      ) : null}
    </section>
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
    <section className="chart-card settings-card">
      <button
        type="button"
        className="settings-section-toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="settings-section-toggle-copy">
          <div className="chart-head">
            <h3>{settingsMessages.demoTitle}</h3>
            <p>{settingsMessages.demoDetail}</p>
          </div>
          <div className="settings-demo-meta">
            <div className="settings-demo-meta-item">
              <span>{settingsMessages.state}</span>
              <strong>{demo.emptyState ? settingsMessages.emptyMode : settingsMessages.seededMode}</strong>
            </div>
            <div className="settings-demo-meta-item">
              <span>{settingsMessages.seededAt}</span>
              <strong>{formatService.formatDate(demo.lastSeededAt)}</strong>
            </div>
          </div>
        </div>
        <span className={`settings-section-toggle-icon ${isOpen ? "is-open" : ""}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {isOpen ? (
        <>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
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
          <p className="lede compact">{settingsMessages.refreshHint}</p>
        </>
      ) : null}
    </section>
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
