import * as Popover from "@radix-ui/react-popover";
import { Ellipsis } from "lucide-react";
import { Link } from "react-router-dom";

import { messages } from "./copy/en-SG";

// A tab is active on every route it stands for: Summary covers /summary
// (All months) and /month (one month picked), so it lists both route ids.
export function isRouteTabActive(tab, selectedTabId) {
  return (tab.routeIds ?? [tab.id]).includes(selectedTabId);
}

// Route tabs plus the "More pages" menu for the secondary routes. App owns
// the tab list, each link's target (URL normalization) and the warmup
// intent handlers; this component only lays them out. On a phone the
// primary tabs fill the bottom bar, one grid column each, then the •••
// menu (`--primary-tab-count`), so adding a primary tab is one registry line.
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
  const renderTabLink = (tab, className) => {
    const isActive = isRouteTabActive(tab, selectedTabId);
    return (
      <Link
        key={tab.id}
        {...getNavIntentProps(tab.id)}
        className={`${className} ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        to={buildTabTarget(tab)}
        title={titleFor(tab)}
      >
        {renderTabLabel(tab)}
      </Link>
    );
  };

  return (
    <nav
      className="tab-strip"
      aria-label={messages.tabs.ariaLabel}
      style={/** @type {import("react").CSSProperties} */ ({ "--primary-tab-count": primaryTabs.length })}
    >
      {primaryTabs.map((tab) => renderTabLink(tab, "tab"))}
      {secondaryTabs.map((tab) => renderTabLink(tab, "tab tab-secondary"))}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className={`tab tab-overflow-trigger ${secondaryTabs.some((tab) => isRouteTabActive(tab, selectedTabId)) ? "is-active" : ""}`} aria-label="More pages">
            <Ellipsis size={18} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="tab-overflow-popover" sideOffset={10} align="end">
            <div className="tab-overflow-list">
              {secondaryTabs.map((tab) => renderTabLink(tab, "tab-overflow-link"))}
            </div>
            <Popover.Arrow className="category-popover-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </nav>
  );
}
