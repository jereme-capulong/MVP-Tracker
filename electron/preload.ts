import { contextBridge, ipcRenderer } from "electron";

const IMPORT_CSV_CHANNEL = "monsters:import-csv";

contextBridge.exposeInMainWorld("electronAPI", {
  importCsv: (): Promise<string | null> => ipcRenderer.invoke(IMPORT_CSV_CHANNEL),
});
