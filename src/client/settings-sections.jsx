import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, SquarePen, X } from "lucide-react";
import { useMemo, useState } from "react";

import { formatAuditAction } from "./account-display";
import { messages } from "./copy/en-SG";
import { formatDate, formatDateOnly, money } from "./formatters";
import { CategoryGlyph, DeleteRowButton } from "./ui-components";

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
        title={messages.settings.peopleTitle}
        detail={messages.settings.peopleDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-people-grid">
          {people.map((person) => (
            <div key={person.id} className="settings-account-row settings-person-card">
              <div className="settings-account-main">
                <strong>{person.name}</strong>
                <p>{messages.settings.personUsageHint}</p>
              </div>
              <div className="settings-account-actions">
                <button type="button" className="icon-action" aria-label={messages.settings.editPerson} onClick={() => onEditPerson(person)}>
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
        title={messages.settings.categoriesTitle}
        detail={messages.settings.categoriesDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <>
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={onCreateCategory}>
              {messages.settings.addCategory}
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
                  <button type="button" className="icon-action" aria-label={messages.settings.editCategory} onClick={() => onEditCategory(category)}>
                    <SquarePen size={16} />
                  </button>
                  <DeleteRowButton
                    label={category.name}
                    triggerLabel={messages.settings.deleteCategory}
                    confirmLabel={messages.settings.deleteCategory}
                    destructive={false}
                    prompt={messages.settings.deleteCategoryDetail(category.name)}
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
  isOpen,
  onToggle,
  onCreateRule,
  onEditRule,
  onDeleteRule,
  onAcceptSuggestion,
  onEditSuggestion,
  onIgnoreSuggestion
}) {
  const ruleGroups = useMemo(() => groupCategoryMatchRules(rules, categories), [categories, rules]);
  const [areRuleGroupsExpanded, setAreRuleGroupsExpanded] = useState(true);

  return (
    <section id={id} className="chart-card settings-card">
      <SettingsSectionToggle
        title={messages.settings.categoryRulesTitle}
        detail={messages.settings.categoryRulesDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <>
          {suggestions.length ? (
            <section className="settings-suggestion-panel">
              <div className="settings-rule-group-header">
                <strong>{messages.settings.categoryRuleSuggestionsTitle}</strong>
                <span>{messages.settings.categoryRuleSuggestionsCount(suggestions.length)}</span>
              </div>
              <p className="lede compact">{messages.settings.categoryRuleSuggestionsDetail}</p>
              <div className="settings-suggestion-list">
                {suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="settings-account-row settings-suggestion-row">
                    <div className="settings-account-main">
                      <strong>{suggestion.pattern}</strong>
                      <p>{messages.common.triplet(suggestion.categoryName, messages.settings.categoryRuleSuggestionSeen(suggestion.sourceCount), suggestion.sampleDescriptions[0] ?? messages.common.emptyValue)}</p>
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
                        {messages.settings.acceptCategoryRuleSuggestion}
                      </button>
                      <button type="button" className="subtle-action" onClick={() => onEditSuggestion(suggestion)}>
                        {messages.settings.editCategoryRuleSuggestion}
                      </button>
                      <button type="button" className="subtle-action muted-action" onClick={() => onIgnoreSuggestion(suggestion)}>
                        {messages.settings.ignoreCategoryRuleSuggestion}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={onCreateRule}>
              {messages.settings.addCategoryRule}
            </button>
            {ruleGroups.length ? (
              <button
                type="button"
                className="subtle-action"
                onClick={() => setAreRuleGroupsExpanded((current) => !current)}
              >
                {areRuleGroupsExpanded ? messages.settings.collapseCategoryRules : messages.settings.expandCategoryRules}
              </button>
            ) : null}
          </div>
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
                  <span className="settings-rule-group-count">{messages.settings.categoryRuleGroupCount(group.rules.length)}</span>
                </summary>
                <div className="settings-rule-group-list">
                  {group.rules.map((rule) => (
                    <div key={rule.id} className={`settings-account-row settings-rule-row ${rule.isActive ? "" : "is-muted"}`}>
                      <div className="settings-account-main">
                        <strong>{rule.pattern}</strong>
                        <p>{messages.common.triplet(messages.settings.categoryRulePriorityValue(rule.priority), rule.isActive ? messages.settings.categoryRuleActive : messages.settings.categoryRuleInactive, rule.note || messages.common.emptyValue)}</p>
                      </div>
                      <div className="settings-account-actions">
                        <button type="button" className="icon-action" aria-label={messages.settings.editCategoryRule} onClick={() => onEditRule(rule)}>
                          <SquarePen size={16} />
                        </button>
                        <DeleteRowButton
                          label={rule.pattern}
                          triggerLabel={messages.settings.deleteCategoryRule}
                          confirmLabel={messages.settings.deleteCategoryRule}
                          destructive={false}
                          prompt={messages.settings.deleteCategoryRuleDetail(rule.pattern)}
                          onConfirm={() => onDeleteRule(rule)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )) : (
              <p className="lede compact">{messages.common.emptyValue}</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function SettingsTrustSection({ isOpen, onToggle }) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={messages.settings.trustRulesTitle}
        detail={messages.settings.trustRulesDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-trust-grid">
          <div className="settings-demo-meta-item">
            <span>{messages.settings.trustOpeningTitle}</span>
            <strong>{messages.settings.trustOpeningDetail}</strong>
            <p>{messages.settings.trustOpeningAction}</p>
          </div>
          <div className="settings-demo-meta-item">
            <span>{messages.settings.trustCheckpointTitle}</span>
            <strong>{messages.settings.trustCheckpointDetail}</strong>
            <p>{messages.settings.trustCheckpointAction}</p>
          </div>
          <div className="settings-demo-meta-item">
            <span>{messages.settings.trustTransfersTitle}</span>
            <strong>{messages.settings.trustTransfersDetail}</strong>
            <p>{messages.settings.trustTransfersAction}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function SettingsTransfersSection({ transfers, isOpen, onToggle, onOpenTransferReview }) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={messages.settings.unresolvedTransfersTitle}
        detail={messages.settings.unresolvedTransfersDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-transfer-list">
          {transfers.length ? transfers.map((item) => (
            <div key={item.entryId} className="settings-account-row settings-transfer-row">
              <div className="settings-account-main settings-transfer-main">
                <strong>{item.description}</strong>
                <p>{messages.common.triplet(formatDateOnly(item.date), item.accountName, item.transferDirection === "in" ? "Transfer in" : "Transfer out")}</p>
              </div>
              <strong className="settings-transfer-amount">{money(item.transferDirection === "out" ? -item.amountMinor : item.amountMinor)}</strong>
              <div className="settings-account-actions">
                <button type="button" className="subtle-action" onClick={() => onOpenTransferReview(item.entryId)}>
                  {messages.settings.openTransferReview}
                </button>
              </div>
            </div>
          )) : (
            <p className="lede compact">{messages.common.emptyValue}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsActivitySection({ activityGroups, isOpen, onToggle }) {
  return (
    <section className="chart-card settings-card">
      <SettingsSectionToggle
        title={messages.settings.recentActivityTitle}
        detail={messages.settings.recentActivityDetail}
        isOpen={isOpen}
        onToggle={onToggle}
      />
      {isOpen ? (
        <div className="settings-activity-groups">
          {activityGroups.length ? activityGroups.map((group) => (
            <section key={group.date} className="settings-activity-group">
              <div className="settings-activity-date">{formatDateOnly(group.date)}</div>
              <div className="settings-activity-list">
                {group.events.map((event) => (
                  <div key={event.id} className="settings-account-row settings-activity-row">
                    <div className="settings-account-main">
                      <strong>{formatAuditAction(event.action)}</strong>
                      <p>{event.detail}</p>
                    </div>
                    <p className="settings-account-meta">{formatDate(event.createdAt)}</p>
                  </div>
                ))}
              </div>
            </section>
          )) : (
            <p className="lede compact">{messages.common.emptyValue}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsDemoSection({
  demo,
  emptyStateText,
  isOpen,
  isSubmitting,
  onToggle,
  onEmptyStateTextChange,
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
            <h3>{messages.settings.demoTitle}</h3>
            <p>{messages.settings.demoDetail}</p>
          </div>
          <div className="settings-demo-meta">
            <div className="settings-demo-meta-item">
              <span>{messages.settings.salaryPerPerson}</span>
              <strong>{money(demo.salaryPerPersonMinor)}</strong>
            </div>
            <div className="settings-demo-meta-item">
              <span>{messages.settings.state}</span>
              <strong>{demo.emptyState ? messages.settings.emptyMode : messages.settings.seededMode}</strong>
            </div>
            <div className="settings-demo-meta-item">
              <span>{messages.settings.seededAt}</span>
              <strong>{formatDate(demo.lastSeededAt)}</strong>
            </div>
          </div>
        </div>
        <span className={`settings-section-toggle-icon ${isOpen ? "is-open" : ""}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {isOpen ? (
        <>
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={onReseed} disabled={isSubmitting}>
              {messages.settings.reseed}
            </button>
            <button type="button" className="subtle-action" onClick={onRefresh} disabled={isSubmitting}>
              {messages.settings.refresh}
            </button>
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <button type="button" className="subtle-action subtle-danger" disabled={isSubmitting}>
                  {messages.settings.emptyState}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="note-dialog-overlay" />
                <Dialog.Content className="note-dialog-content">
                  <div className="note-dialog-head">
                    <div>
                      <Dialog.Title>{messages.settings.emptyState}</Dialog.Title>
                      <Dialog.Description>{messages.settings.emptyStateDetail}</Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="icon-action subtle-cancel"
                        aria-label="Close empty-state dialog"
                      >
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <input
                    className="table-edit-input"
                    placeholder={messages.settings.emptyStatePlaceholder}
                    value={emptyStateText}
                    onChange={(event) => onEmptyStateTextChange(event.target.value)}
                  />
                  <div className="note-dialog-actions">
                    <Dialog.Close asChild>
                      <button type="button" className="subtle-action">Cancel</button>
                    </Dialog.Close>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="subtle-action subtle-danger"
                        disabled={emptyStateText.trim().toLowerCase() !== "empty state" || isSubmitting}
                        onClick={onEmptyState}
                      >
                        {messages.settings.emptyStateConfirm}
                      </button>
                    </Dialog.Close>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
          <p className="lede compact">{messages.settings.refreshHint}</p>
        </>
      ) : null}
    </section>
  );
}
