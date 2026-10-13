import { useEffect, useState } from "react";

import {
  applyColours,
  COLOUR_MODES,
  COLOUR_PRESETS,
  findColourPreset,
  readStoredMode,
  readStoredPresetId,
  resolveMode,
  systemPrefersDark
} from "./colour-presets";
import { settingsMessages } from "./copy/en-SG-settings";
import { SettingsSection } from "./settings-section";

// Whether the phone is set to dark, kept current while Settings is open so
// Auto's swatches follow it.
function useSystemPrefersDark() {
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark());
  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query?.addEventListener) return undefined;
    const onChange = (event) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

// Settings > Colours (design.md, "Colour presets"): one row in the Settings
// list whose status word is the preset and mode in use; open, it shows a
// Light / Dark / Auto switch and a chip per preset (its name and four colour
// dots in the mode on screen). Choosing applies at once and is remembered
// on this device only.
export function SettingsColoursSection({ isOpen, onToggle }) {
  const [presetId, setPresetId] = useState(() => readStoredPresetId());
  const [mode, setMode] = useState(() => readStoredMode());
  const prefersDark = useSystemPrefersDark();
  const resolvedMode = resolveMode(mode, prefersDark);
  const modeNames = settingsMessages.coloursModes;

  function choose(next) {
    setPresetId(next.presetId);
    setMode(next.mode);
    void applyColours(next);
  }

  return (
    <SettingsSection
      id="settings-colours"
      title={settingsMessages.coloursTitle}
      value={`${findColourPreset(presetId).name} · ${modeNames[mode]}`}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <div className="settings-colour-modes" role="group" aria-label={settingsMessages.coloursModeLabel}>
        {COLOUR_MODES.map((option) => (
          <button
            key={option}
            type="button"
            className="settings-colour-mode"
            aria-pressed={option === mode}
            data-mode-choice={option}
            onClick={() => choose({ presetId, mode: option })}
          >
            {modeNames[option]}
          </button>
        ))}
      </div>
      <div className="settings-colour-presets" role="group" aria-label={settingsMessages.coloursChoiceLabel}>
        {COLOUR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={preset.id === presetId}
            className={`settings-colour-preset${preset.id === presetId ? " is-selected" : ""}`}
            data-preset={preset.id}
            onClick={() => choose({ presetId: preset.id, mode })}
          >
            <span className="settings-colour-preset-dots" aria-hidden="true">
              {preset.swatches[resolvedMode].map((colour, index) => (
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
