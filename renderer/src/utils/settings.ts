export type AlertMode = "default" | "custom";

export type AlertSettings = {
  alertMode: AlertMode;
  customSoundPath: string | null;
};

const ALERT_SETTINGS_STORAGE_KEY = "mvp-tracker.alert-settings.v1";
const GLOBAL_HOTKEYS_ENABLED_STORAGE_KEY = "mvp-tracker.global-hotkeys-enabled.v1";

const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  alertMode: "default",
  customSoundPath: null,
};

function isAlertMode(value: unknown): value is AlertMode {
  return value === "default" || value === "custom";
}

export function loadAlertSettings(): AlertSettings {
  const raw = localStorage.getItem(ALERT_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_ALERT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AlertSettings>;
    const alertMode = isAlertMode(parsed.alertMode)
      ? parsed.alertMode
      : DEFAULT_ALERT_SETTINGS.alertMode;
    const customSoundPath =
      typeof parsed.customSoundPath === "string" && parsed.customSoundPath.trim().length > 0
        ? parsed.customSoundPath
        : null;

    return {
      alertMode,
      customSoundPath,
    };
  } catch {
    return DEFAULT_ALERT_SETTINGS;
  }
}

export function saveAlertSettings(settings: AlertSettings): void {
  localStorage.setItem(ALERT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function loadGlobalHotkeysEnabled(): boolean {
  const raw = localStorage.getItem(GLOBAL_HOTKEYS_ENABLED_STORAGE_KEY);
  if (raw === null) {
    return true;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "boolean" ? parsed : true;
  } catch {
    return true;
  }
}

export function saveGlobalHotkeysEnabled(enabled: boolean): void {
  localStorage.setItem(GLOBAL_HOTKEYS_ENABLED_STORAGE_KEY, JSON.stringify(Boolean(enabled)));
}
