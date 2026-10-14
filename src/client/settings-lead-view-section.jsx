import { settingsMessages } from "./copy/en-SG-settings";
import { useLeadView } from "./lead-view";
import { SettingsSection } from "./settings-section";

// Settings > Summary view (design.md, "Plan or Simple"): one row in the
// Settings list whose status word is how Summary and Month open ("Simple" or
// "Plan"); open, it shows the same two choices as the page's switch. It reads
// and writes the one lead-view store, so it is the same per-account choice
// as the switch on the page, not a second setting.
export function SettingsLeadViewSection({ isOpen, onToggle }) {
  const [leadView, setLeadView] = useLeadView();
  const names = settingsMessages.leadViewChoices;

  return (
    <SettingsSection
      id="settings-lead-view"
      title={settingsMessages.leadViewTitle}
      value={names[leadView]}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div className="settings-colour-modes" role="group" aria-label={settingsMessages.leadViewChoiceLabel}>
        {["simple", "plan"].map((option) => (
          <button
            key={option}
            type="button"
            className="settings-colour-mode"
            aria-pressed={option === leadView}
            data-lead-view-choice={option}
            onClick={() => void setLeadView(option)}
          >
            {names[option]}
          </button>
        ))}
      </div>
      <p className="settings-hint">{settingsMessages.leadViewHint}</p>
    </SettingsSection>
  );
}
