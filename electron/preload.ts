import { contextBridge, ipcRenderer } from "electron";

const IMPORT_CSV_CHANNEL = "monsters:import-csv";
const PICK_ALERT_SOUND_FILE_CHANNEL = "settings:pick-alert-sound-file";
const GOOGLE_OAUTH_SIGN_IN_CHANNEL = "auth:google-oauth-sign-in";
const WINDOW_MINIMIZE_CHANNEL = "window:minimize";
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "window:toggle-maximize";
const WINDOW_CLOSE_CHANNEL = "window:close";
const WINDOW_IS_MAXIMIZED_CHANNEL = "window:is-maximized";
const WINDOW_MAXIMIZED_STATE_CHANGED_CHANNEL = "window:maximized-state-changed";
const APP_GET_VERSION_CHANNEL = "app:get-version";
const APP_GET_TITLEBAR_ICON_CHANNEL = "app:get-titlebar-icon";

contextBridge.exposeInMainWorld("electronAPI", {
  importCsv: (): Promise<string | null> => ipcRenderer.invoke(IMPORT_CSV_CHANNEL),
  pickAlertSoundFile: (): Promise<string | null> => ipcRenderer.invoke(PICK_ALERT_SOUND_FILE_CHANNEL),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(APP_GET_VERSION_CHANNEL),
  getTitleBarIcon: (): Promise<string | null> => ipcRenderer.invoke(APP_GET_TITLEBAR_ICON_CHANNEL),
  googleOAuthSignIn: (
    clientId: string,
    clientSecret?: string
  ): Promise<{ idToken: string; accessToken: string }> =>
    ipcRenderer.invoke(GOOGLE_OAUTH_SIGN_IN_CHANNEL, clientId, clientSecret ?? null),
  windowControls: {
    minimize: (): void => {
      ipcRenderer.send(WINDOW_MINIMIZE_CHANNEL);
    },
    toggleMaximize: (): void => {
      ipcRenderer.send(WINDOW_TOGGLE_MAXIMIZE_CHANNEL);
    },
    close: (): void => {
      ipcRenderer.send(WINDOW_CLOSE_CHANNEL);
    },
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED_CHANNEL),
    onMaximizedStateChange: (listener: (isMaximized: boolean) => void): (() => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        listener(Boolean(value));
      };

      ipcRenderer.on(WINDOW_MAXIMIZED_STATE_CHANGED_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(WINDOW_MAXIMIZED_STATE_CHANGED_CHANNEL, wrappedListener);
      };
    },
  },
});
