import * as Popover from "@radix-ui/react-popover";
import { Ellipsis, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";

import { messages } from "./copy/en-SG";

// Route tabs plus the "More pages" menu for the secondary routes. App owns
// the tab list, each link's target (URL normalization) and the warmup
// intent handlers; this component only lays them out. A primary tab marked
// `phoneOverflow` stays in the strip on a wide screen but moves into "More
// pages" on a phone; one marked `phoneOnly` shows on a phone only.
export function ShellRouteTabs({
  primaryTabs,
  secondaryTabs,
  selectedTabId,
  buildTabTarget,
  getNavIntentProps,
  pendingCategorySuggestionCount,
  askInProgress = false
}) {
  const overflowTabs = [...primaryTabs.filter((tab) => tab.phoneOverflow), ...secondaryTabs];
  const titleFor = (tab) => (
    tab.id === "settings" && pendingCategorySuggestionCount
      ? messages.settings.settingsCategorySuggestionBadgeTitle(pendingCategorySuggestionCount)
      : undefined
  );
  // A conversation left in progress on Ask: a small accent dot on its tab,
  // named in the link's label for screen readers.
  const showsAskDot = (tab) => tab.id === "ask" && askInProgress;
  const ariaLabelFor = (tab) => (showsAskDot(tab) ? messages.tabs.askInProgress : undefined);
  const renderTabLabel = (tab) => (
    <span className="tab-label-with-badge">
      {tab.icon === "ask" ? <Sparkles size={15} aria-hidden="true" className="tab-icon" /> : null}
      <span>{tab.label}</span>
      {showsAskDot(tab) ? <span className="tab-dot" aria-hidden="true" /> : null}
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
          className={({ isActive }) => `tab ${tab.phoneOverflow ? "tab-phone-overflow" : ""} ${tab.phoneOnly ? "tab-phone-only" : ""} ${isActive ? "is-active" : ""}`}
          to={buildTabTarget(tab)}
          title={titleFor(tab)}
          aria-label={ariaLabelFor(tab)}
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
          <button type="button" className={`tab tab-overflow-trigger ${overflowTabs.some((tab) => tab.id === selectedTabId) ? "is-active" : ""}`} aria-label="More pages">
            <Ellipsis size={18} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="tab-overflow-popover" sideOffset={10} align="end">
            <div className="tab-overflow-list">
              {overflowTabs.map((tab) => (
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
