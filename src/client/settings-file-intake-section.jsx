import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

import { settingsMessages } from "./copy/en-SG-settings";
import { SettingsSection } from "./settings-section";
import { makeNewFileIntakeKey, requestFileIntakeSettings } from "./waiting-files-api";

// Settings > Send files to Monies Map (DOMAIN.md "Waiting File"): the
// address and the key the share-sheet Shortcut sends files with, and
// "Make a new key", which stops the old key at once. It reads its own route
// when opened, so the Settings page payload never carries the key.
export function SettingsFileIntakeSection({ isOpen, onToggle }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || settings) {
      return undefined;
    }
    const controller = new AbortController();
    void requestFileIntakeSettings({ signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      setSettings(next.ok ? next : null);
      setError(next.ok ? "" : settingsMessages.fileIntakeLoadFailed);
    });
    return () => controller.abort();
  }, [isOpen, settings]);

  const hasKey = Boolean(settings?.key);

  async function handleMakeKey() {
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    const next = await makeNewFileIntakeKey();
    setIsSaving(false);
    if (!next.ok) {
      setError(settingsMessages.fileIntakeNewKeyFailed);
      return;
    }
    setSettings(next);
    setIsKeyVisible(true);
    setStatus(hasKey ? settingsMessages.fileIntakeNewKeyMade : "");
  }

  return (
    <SettingsSection
      id="settings-file-intake"
      title={settingsMessages.fileIntakeTitle}
      value={settings ? (hasKey ? settingsMessages.fileIntakeOn : settingsMessages.fileIntakeOff) : null}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {status ? <p className="settings-shortcut-status" role="status" aria-live="polite">{status}</p> : null}
      <p className="settings-hint">{settingsMessages.fileIntakeLead}</p>
      {settings ? (
        <div className="settings-detail-block settings-shortcut-advanced-content">
          <label className="table-edit-field settings-form-wide">
            <span>{settingsMessages.fileIntakeAddress}</span>
            <input className="table-edit-input" value={settings.endpoint} readOnly />
          </label>
          <div className="table-edit-field settings-form-wide">
            <label htmlFor="file-intake-key">{settingsMessages.fileIntakeKey}</label>
            {hasKey ? (
              <div className="settings-shortcut-secret-input">
                <input
                  id="file-intake-key"
                  className="table-edit-input"
                  type={isKeyVisible ? "text" : "password"}
                  value={settings.key}
                  readOnly
                  autoComplete="off"
                  spellCheck="false"
                />
                <button
                  type="button"
                  className="icon-action settings-row-icon"
                  aria-label={isKeyVisible ? settingsMessages.fileIntakeHideKey : settingsMessages.fileIntakeShowKey}
                  title={isKeyVisible ? settingsMessages.fileIntakeHideKey : settingsMessages.fileIntakeShowKey}
                  onClick={() => setIsKeyVisible((current) => !current)}
                >
                  {isKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            ) : (
              <p id="file-intake-key" className="settings-hint">{settingsMessages.fileIntakeNoKey}</p>
            )}
            <small className="field-help">{settingsMessages.fileIntakeHelp}</small>
          </div>
          <div className="settings-actions">
            <button type="button" className="subtle-action" onClick={() => void handleMakeKey()} disabled={isSaving}>
              {hasKey ? settingsMessages.fileIntakeMakeNewKey : settingsMessages.fileIntakeMakeKey}
            </button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}
