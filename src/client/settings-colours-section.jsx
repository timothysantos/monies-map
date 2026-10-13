import { useState } from "react";

import { applyColourPreset, COLOUR_PRESETS, findColourPreset, readStoredPresetId } from "./colour-presets";
import { settingsMessages } from "./copy/en-SG-settings";
import { SettingsSection } from "./settings-section";

// Settings > Colours (design.md, "Colour presets"): one row in the Settings
// list whose status word is the preset in use; open, it shows a chip per
// preset (its name and four colour dots). Choosing one applies at once and
// is remembered on this device only.
export function SettingsColoursSection({ isOpen, onToggle }) {
  const [presetId, setPresetId] = useState(() => readStoredPresetId());

  function choose(id) {
    setPresetId(id);
    void applyColourPreset(id);
  }

  return (
    <SettingsSection
      id="settings-colours"
      title={settingsMessages.coloursTitle}
      value={findColourPreset(presetId).name}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div className="settings-colour-presets" role="group" aria-label={settingsMessages.coloursChoiceLabel}>
        {COLOUR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={preset.id === presetId}
            className={`settings-colour-preset${preset.id === presetId ? " is-selected" : ""}`}
            data-preset={preset.id}
            onClick={() => choose(preset.id)}
          >
            <span className="settings-colour-preset-dots" aria-hidden="true">
              {preset.swatches.map((colour, index) => (
                <span key={index} style={{ "--swatch": colour }} />
              ))}
            </span>
            <span className="settings-colour-preset-name">{preset.name}</span>
          </button>
        ))}
      </div>
      <p className="settings-hint">{settingsMessages.coloursDeviceHint}</p>
    </SettingsSection>
  );
}
