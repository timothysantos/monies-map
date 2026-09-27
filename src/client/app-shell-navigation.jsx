import * as Popover from "@radix-ui/react-popover";
import { Ellipsis } from "lucide-react";
import { NavLink } from "react-router-dom";

import { messages } from "./copy/en-SG";

// Route tabs plus the "More pages" menu for the secondary routes. App owns
// the tab list, each link's target (URL normalization) and the warmup
// intent handlers; this component only lays them out.
export function ShellRouteTabs({
  primaryTabs,
  secondaryTabs,
  selectedTabId,
  buildTabTarget,
  getNavIntentProps,
  pendingCategorySuggestionCount
}) {
  const titleFor = (tab) => (
    tab.id === "settings" && pendingCategorySuggestionCount
      ? messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount)
      : undefined
  );
  const renderTabLabel = (tab) => (
    <span className="tab-label-with-badge">
      <span>{tab.label}</span>
      {tab.id === "settings" && pendingCategorySuggestionCount ? (
        <span className="tab-badge" title={messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount)}>
          {pendingCategorySuggestionCount}
        </span>
      ) : null}
    </span>
  );

  return (
    <nav className="tab-strip" aria-label={messages.tabs.ariaLabel}>
      {primaryTabs.map((tab) => (
        <NavLink
          key={tab.id}
          {...getNavIntentProps(tab.id)}
          className={({ isActive }) => `tab ${isActive ? "is-active" : ""}`}
          to={buildTabTarget(tab)}
          title={titleFor(tab)}
        >
          {renderTabLabel(tab)}
        </NavLink>
      ))}
      {secondaryTabs.map((tab) => (
        <NavLink
          key={tab.id}
          {...getNavIntentProps(tab.id)}
          className={({ isActive }) => `tab tab-secondary ${isActive ? "is-active" : ""}`}
          to={buildTabTarget(tab)}
          title={titleFor(tab)}
        >
          {renderTabLabel(tab)}
        </NavLink>
      ))}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className={`tab tab-overflow-trigger ${secondaryTabs.some((tab) => tab.id === selectedTabId) ? "is-active" : ""}`} aria-label="More pages">
            <Ellipsis size={18} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="tab-overflow-popover" sideOffset={10} align="end">
            <div className="tab-overflow-list">
              {secondaryTabs.map((tab) => (
                <NavLink
                  key={tab.id}
                  {...getNavIntentProps(tab.id)}
                  className={({ isActive }) => `tab-overflow-link ${isActive ? "is-active" : ""}`}
                  to={buildTabTarget(tab)}
                  title={titleFor(tab)}
                >
                  {renderTabLabel(tab)}
                </NavLink>
              ))}
            </div>
            <Popover.Arrow className="category-popover-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </nav>
  );
}
