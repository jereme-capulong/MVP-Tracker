import { contextBridge, ipcRenderer } from "electron";

const IMPORT_CSV_CHANNEL = "monsters:import-csv";
const PICK_ALERT_SOUND_FILE_CHANNEL = "settings:pick-alert-sound-file";
const GOOGLE_OAUTH_SIGN_IN_CHANNEL = "auth:google-oauth-sign-in";

contextBridge.exposeInMainWorld("electronAPI", {
  importCsv: (): Promise<string | null> => ipcRenderer.invoke(IMPORT_CSV_CHANNEL),
  pickAlertSoundFile: (): Promise<string | null> => ipcRenderer.invoke(PICK_ALERT_SOUND_FILE_CHANNEL),
  googleOAuthSignIn: (clientId: string): Promise<{ idToken: string; accessToken: string }> =>
    ipcRenderer.invoke(GOOGLE_OAUTH_SIGN_IN_CHANNEL, clientId),
});
