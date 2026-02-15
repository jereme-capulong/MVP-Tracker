import { contextBridge, ipcRenderer } from "electron";

const IMPORT_CSV_CHANNEL = "monsters:import-csv";
const PICK_ALERT_SOUND_FILE_CHANNEL = "settings:pick-alert-sound-file";

contextBridge.exposeInMainWorld("electronAPI", {
  importCsv: (): Promise<string | null> => ipcRenderer.invoke(IMPORT_CSV_CHANNEL),
  pickAlertSoundFile: (): Promise<string | null> => ipcRenderer.invoke(PICK_ALERT_SOUND_FILE_CHANNEL),
});
