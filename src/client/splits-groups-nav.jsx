import { useEffect, useRef } from "react";

import { messages } from "./copy/en-SG";
import { getIconComponent } from "./ui-components";

export function SplitsGroupsNav({
  groups,
  activeGroup,
  selectedMode,
  onSelectGroup,
  onCreateGroup,
  readOnly = false,
  floating = false
}) {
  const pillsRef = useRef(null);
  const activePillRef = useRef(null);

  useEffect(() => {
    if (!floating || selectedMode === "matches") {
      return;
    }

    if (!window.matchMedia("(max-width: 760px)").matches) {
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
                <span>{group.entryCount} {messages.splits.entries}</span>
                <span>{group.summaryText}</span>
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
