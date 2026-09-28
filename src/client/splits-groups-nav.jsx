import { useEffect, useRef } from "react";

import { messages } from "./copy/en-SG";
import { getIconComponent } from "./ui-components";
import { useMoneyPrivacy } from "./money-privacy";
import { isMobileLayout } from "./use-viewport";
import { moneyToneClass } from "./money-tone-class";

export function SplitsGroupsNav({
  groups,
  activeGroup,
  selectedMode,
  onSelectGroup,
  onCreateGroup,
  readOnly = false,
  floating = false
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const pillsRef = useRef(null);
  const activePillRef = useRef(null);

  useEffect(() => {
    if (!floating || selectedMode === "matches") {
      return;
    }

    if (!isMobileLayout()) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const pills = pillsRef.current;
      const activePill = activePillRef.current;
      if (!pills || !activePill) {
        return;
      }

      pills.scrollTo({
        left: Math.max(0, activePill.offsetLeft - 8),
        behavior: "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeGroup?.id, floating, selectedMode]);

  return (
    <section className={`splits-groups-row ${floating ? "splits-groups-row-floating" : ""}`}>
      <div ref={pillsRef} className="splits-group-pills">
        {groups.map((group) => {
          const Icon = getIconComponent(group.iconKey);
          const isActive = group.id === activeGroup?.id && selectedMode !== "matches";
          return (
            <button
              key={group.id}
              ref={isActive ? activePillRef : null}
              type="button"
              className={`split-group-pill ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectGroup(group.id)}
            >
              <span className="split-group-pill-icon"><Icon size={18} strokeWidth={2.1} /></span>
              <span className="split-group-pill-content">
                <strong>{group.name}</strong>
                <span>{group.currency ?? "SGD"} · {group.expenseSource === "cash" ? "Cash only" : group.expenseSource === "ledger" ? "Bank/card" : "Mixed"}</span>
                <span>{messages.splits.entryCount(group.entryCount)}</span>
                <span className={`split-group-pill-balance ${moneyToneClass(areTotalsVisible ? group.balanceTone : "neutral", "soft")}`}>{areTotalsVisible ? group.summaryText : "Balance hidden"}</span>
              </span>
            </button>
          );
        })}
        {!readOnly ? (
          <button
            type="button"
            className="split-group-pill split-group-pill-create"
            onClick={onCreateGroup}
            aria-label={messages.splits.createGroup}
          >
            <strong>{messages.splits.addGroup}</strong>
          </button>
        ) : null}
      </div>
    </section>
  );
}
