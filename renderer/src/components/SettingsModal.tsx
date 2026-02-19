import { memo, useMemo, useState } from "react";
import { AlertMode, AlertSettings } from "../utils/settings";
import { ModalBackdrop } from "./ModalBackdrop";
import { SoundToggle } from "./SoundToggle";

type SettingsModalProps = {
  isOpen: boolean;
  settings: AlertSettings;
  soundEnabled: boolean;
  onClose: () => void;
  onToggleSound: () => void;
  onSettingsChange: (settings: AlertSettings) => void;
  onPickCustomSound: () => Promise<string | null>;
};

function getDisplayFileName(filePath: string | null): string {
  if (!filePath) {
    return "No file selected.";
  }

  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export const SettingsModal = memo(function SettingsModal({
  isOpen,
  settings,
  soundEnabled,
  onClose,
  onToggleSound,
  onSettingsChange,
  onPickCustomSound,
}: SettingsModalProps) {
  const [isPickingFile, setIsPickingFile] = useState(false);

  const selectedFileName = useMemo(
    () => getDisplayFileName(settings.customSoundPath),
    [settings.customSoundPath]
  );

  if (!isOpen) {
    return null;
  }

  const setAlertMode = (alertMode: AlertMode) => {
    if (alertMode === settings.alertMode) {
      return;
    }
    onSettingsChange({
      ...settings,
      alertMode,
    });
  };

  const handlePickCustomSound = async () => {
    if (isPickingFile) {
      return;
    }

    setIsPickingFile(true);
    try {
      const selectedPath = await onPickCustomSound();
      if (!selectedPath) {
        return;
      }
      onSettingsChange({
        alertMode: "custom",
        customSoundPath: selectedPath,
      });
    } finally {
      setIsPickingFile(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="settings-modal-title">Settings</h3>
        <p className="settings-current-mode">
          Current mode:{" "}
          <strong>{settings.alertMode === "custom" ? "Custom Sound File" : "Default Beep"}</strong>
        </p>

        <div className="settings-section">
          <h4>Notifications</h4>
          <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        </div>

        <div className="settings-section">
          <h4>Alert Sound</h4>
          <fieldset className="settings-choice-group" aria-label="Alert Sound">
            <label className={`settings-choice ${settings.alertMode === "default" ? "selected" : ""}`}>
              <input
                type="radio"
                name="alert-mode"
                value="default"
                checked={settings.alertMode === "default"}
                onChange={() => setAlertMode("default")}
              />
              <span>Default Beep</span>
            </label>

            <label className={`settings-choice ${settings.alertMode === "custom" ? "selected" : ""}`}>
              <input
                type="radio"
                name="alert-mode"
                value="custom"
                checked={settings.alertMode === "custom"}
                onChange={() => setAlertMode("custom")}
              />
              <span>Custom Sound File</span>
            </label>
          </fieldset>

          {settings.alertMode === "custom" ? (
            <div className="settings-custom-sound">
              <button type="button" onClick={handlePickCustomSound} disabled={isPickingFile}>
                {isPickingFile ? "Selecting..." : "Choose Sound File"}
              </button>
              <p className="settings-selected-file">
                {selectedFileName}
              </p>
              <p className="settings-hint">Accepted: .mp3, .wav, .ogg</p>
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
});
