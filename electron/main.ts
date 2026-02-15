import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
const IMPORT_CSV_CHANNEL = "monsters:import-csv";
const PICK_ALERT_SOUND_FILE_CHANNEL = "settings:pick-alert-sound-file";

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 300,
    minHeight: 640,
    resizable: true,
    backgroundColor: "#121418",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Renderer is served by Vite in dev and loaded from static build output in prod.
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ipcMain.handle(IMPORT_CSV_CHANNEL, async () => {
    const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const openDialogOptions: OpenDialogOptions = {
      title: "Import Monster CSV",
      filters: [{ name: "CSV Files", extensions: ["csv"] }],
      properties: ["openFile"],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, openDialogOptions)
      : await dialog.showOpenDialog(openDialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    try {
      return await readFile(result.filePaths[0], "utf8");
    } catch {
      return null;
    }
  });

  ipcMain.handle(PICK_ALERT_SOUND_FILE_CHANNEL, async () => {
    const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const openDialogOptions: OpenDialogOptions = {
      title: "Select Alert Sound",
      filters: [{ name: "Audio Files", extensions: ["mp3", "wav", "ogg"] }],
      properties: ["openFile"],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, openDialogOptions)
      : await dialog.showOpenDialog(openDialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
