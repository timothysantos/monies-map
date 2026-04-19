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
  return (
    <section className={`splits-groups-row ${floating ? "splits-groups-row-floating" : ""}`}>
      <div className="splits-group-pills">
        {groups.map((group) => {
          const Icon = getIconComponent(group.iconKey);
          return (
            <button
              key={group.id}
              type="button"
              className={`split-group-pill ${group.id === activeGroup?.id && selectedMode !== "matches" ? "is-active" : ""}`}
              onClick={() => onSelectGroup(group.id)}
            >
              <span className="split-group-pill-icon"><Icon size={18} strokeWidth={2.1} /></span>
              <span className="split-group-pill-content">
                <strong>{group.name}</strong>
                <span>{group.summaryText}</span>
                <span>{group.entryCount} {messages.splits.entries}</span>
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
