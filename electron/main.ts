import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { BUILD_CALVER } from "./generated-build-info";
import {
  closeHistoryLocalCacheDuckDb,
  queryStatsOverviewFromDuckDb,
  readHistoryLocalCacheFromDuckDb,
  writeHistoryLocalCacheToDuckDb,
} from "./historyLocalCacheDuckDb";

let mainWindow: BrowserWindow | null = null;
let rendererStaticServer: Server | null = null;
let rendererStaticServerUrl: string | null = null;
const RENDERER_STATIC_SERVER_PORT = 47631;
const IMPORT_CSV_CHANNEL = "monsters:import-csv";
const PICK_ALERT_SOUND_FILE_CHANNEL = "settings:pick-alert-sound-file";
const WINDOW_MINIMIZE_CHANNEL = "window:minimize";
const WINDOW_TOGGLE_MAXIMIZE_CHANNEL = "window:toggle-maximize";
const WINDOW_CLOSE_CHANNEL = "window:close";
const WINDOW_IS_MAXIMIZED_CHANNEL = "window:is-maximized";
const WINDOW_MAXIMIZED_STATE_CHANGED_CHANNEL = "window:maximized-state-changed";
const APP_GET_VERSION_CHANNEL = "app:get-version";
const APP_GET_TITLEBAR_ICON_CHANNEL = "app:get-titlebar-icon";
const APP_FOCUS_OFFSET_MINUTES_BY_INDEX_CHANNEL = "app:focus-offset-minutes-by-index";
const APP_OPEN_SET_EXACT_BY_INDEX_CHANNEL = "app:open-set-exact-by-index";
const APP_RETURN_TO_PREVIOUS_WINDOW_CHANNEL = "app:return-to-previous-window";
const APP_SET_GLOBAL_HOTKEYS_ENABLED_CHANNEL = "app:set-global-hotkeys-enabled";
const HISTORY_LOCAL_CACHE_DUCKDB_READ_CHANNEL = "history-local-cache:duckdb:read";
const HISTORY_LOCAL_CACHE_DUCKDB_WRITE_CHANNEL = "history-local-cache:duckdb:write";
const STATS_OVERVIEW_DUCKDB_QUERY_CHANNEL = "stats-overview:duckdb:query";
const GLOBAL_OFFSET_FOCUS_HOTKEY_BINDINGS = [
  { accelerator: "CommandOrControl+1", rowIndex: 0 },
  { accelerator: "CommandOrControl+2", rowIndex: 1 },
  { accelerator: "CommandOrControl+3", rowIndex: 2 },
  { accelerator: "CommandOrControl+4", rowIndex: 3 },
  { accelerator: "CommandOrControl+5", rowIndex: 4 },
  { accelerator: "CommandOrControl+6", rowIndex: 5 },
  { accelerator: "CommandOrControl+7", rowIndex: 6 },
  { accelerator: "CommandOrControl+8", rowIndex: 7 },
  { accelerator: "CommandOrControl+9", rowIndex: 8 },
] as const;
const GLOBAL_SET_EXACT_HOTKEY_BINDINGS = [
  { accelerator: "CommandOrControl+Alt+1", rowIndex: 0 },
  { accelerator: "CommandOrControl+Alt+2", rowIndex: 1 },
  { accelerator: "CommandOrControl+Alt+3", rowIndex: 2 },
  { accelerator: "CommandOrControl+Alt+4", rowIndex: 3 },
  { accelerator: "CommandOrControl+Alt+5", rowIndex: 4 },
  { accelerator: "CommandOrControl+Alt+6", rowIndex: 5 },
  { accelerator: "CommandOrControl+Alt+7", rowIndex: 6 },
  { accelerator: "CommandOrControl+Alt+8", rowIndex: 7 },
  { accelerator: "CommandOrControl+Alt+9", rowIndex: 8 },
] as const;

let areGlobalHotkeysEnabled = true;
let lastReturnToPreviousWindowAt = 0;
let pendingReturnToPreviousWindowTimer: ReturnType<typeof setTimeout> | null = null;
const RETURN_TO_PREVIOUS_WINDOW_COOLDOWN_MS = 220;
const GLOBAL_HOTKEY_REPEAT_COOLDOWN_MS = 120;
const lastGlobalHotkeyInvocationAtByAccelerator = new Map<string, number>();

function getEventWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
}

function resolveWindowIconPath(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(app.getAppPath(), "build", "icon.ico");

  return existsSync(candidate) ? candidate : undefined;
}

const APP_START_CALVER = BUILD_CALVER;

function resolveWindowIconDataUrl(): string | null {
  const iconPath = resolveWindowIconPath();
  if (!iconPath) {
    return null;
  }

  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    return null;
  }
  return icon.toDataURL();
}

function inferStaticContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function ensureRendererStaticServerUrl(): Promise<string> {
  if (rendererStaticServerUrl) {
    return rendererStaticServerUrl;
  }

  const rendererRoot = path.resolve(app.getAppPath(), "dist/renderer");
  const rootWithSeparator = rendererRoot.endsWith(path.sep) ? rendererRoot : `${rendererRoot}${path.sep}`;
  const indexPath = path.join(rendererRoot, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Renderer build output is missing: ${indexPath}`);
  }

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end("Method Not Allowed");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const rawPathname = requestUrl.pathname || "/";
      const normalizedPathname = path.posix.normalize(rawPathname);
      const pathname = normalizedPathname === "/" ? "/index.html" : normalizedPathname;
      const relativePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
      const resolvedPath = path.resolve(rendererRoot, `.${relativePath}`);
      if (resolvedPath !== rendererRoot && !resolvedPath.startsWith(rootWithSeparator)) {
        response.statusCode = 403;
        response.end("Forbidden");
        return;
      }

      const hasExtension = path.posix.basename(pathname).includes(".");
      let filePath = resolvedPath;
      let fileContents: Buffer | null = null;

      try {
        fileContents = await readFile(filePath);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT" && !hasExtension) {
          filePath = indexPath;
          fileContents = await readFile(filePath);
        } else {
          response.statusCode = 404;
          response.end("Not Found");
          return;
        }
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", inferStaticContentType(filePath));
      if (request.method === "HEAD") {
        response.end();
        return;
      }

      response.end(fileContents ?? undefined);
    })().catch((error) => {
      console.error("Renderer static server request failed.", error);
      response.statusCode = 500;
      response.end("Internal Server Error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(RENDERER_STATIC_SERVER_PORT, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to start local renderer static server.");
  }

  rendererStaticServer = server;
  rendererStaticServerUrl = `http://localhost:${address.port}`;
  return rendererStaticServerUrl;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 1080,
    minHeight: 700,
    resizable: true,
    backgroundColor: "#121418",
    autoHideMenuBar: true,
    frame: false,
    icon: resolveWindowIconPath(),
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
    void ensureRendererStaticServerUrl()
      .then((rendererUrl) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        mainWindow.loadURL(rendererUrl);
      })
      .catch((error) => {
        console.error("Failed to start local renderer static server.", error);
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        mainWindow.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
      });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const emitMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(WINDOW_MAXIMIZED_STATE_CHANGED_CHANNEL, mainWindow.isMaximized());
  };

  mainWindow.on("maximize", emitMaximizedState);
  mainWindow.on("unmaximize", emitMaximizedState);
  mainWindow.webContents.on("did-finish-load", emitMaximizedState);
}

function focusMainWindowForShortcut(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow = BrowserWindow.getAllWindows()[0] ?? null;
    }
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  return mainWindow;
}

function sendRowIndexRequest(channel: string, rowIndex: number): void {
  const targetWindow = focusMainWindowForShortcut();
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  const dispatch = () => {
    if (targetWindow.isDestroyed()) {
      return;
    }
    targetWindow.webContents.send(channel, rowIndex);
  };

  if (targetWindow.webContents.isLoadingMainFrame()) {
    targetWindow.webContents.once("did-finish-load", dispatch);
    return;
  }

  dispatch();
}

function sendOffsetMinutesFocusRequest(rowIndex: number): void {
  sendRowIndexRequest(APP_FOCUS_OFFSET_MINUTES_BY_INDEX_CHANNEL, rowIndex);
}

function sendSetExactRequest(rowIndex: number): void {
  sendRowIndexRequest(APP_OPEN_SET_EXACT_BY_INDEX_CHANNEL, rowIndex);
}

function shouldHandleGlobalHotkey(accelerator: string): boolean {
  const now = Date.now();
  const lastHandledAt = lastGlobalHotkeyInvocationAtByAccelerator.get(accelerator) ?? 0;
  if (now - lastHandledAt < GLOBAL_HOTKEY_REPEAT_COOLDOWN_MS) {
    return false;
  }

  lastGlobalHotkeyInvocationAtByAccelerator.set(accelerator, now);
  return true;
}

function registerGlobalHotkeys(): void {
  if (!areGlobalHotkeysEnabled) {
    return;
  }

  for (const { accelerator, rowIndex } of GLOBAL_OFFSET_FOCUS_HOTKEY_BINDINGS) {
    const didRegister = globalShortcut.register(accelerator, () => {
      if (!shouldHandleGlobalHotkey(accelerator)) {
        return;
      }
      sendOffsetMinutesFocusRequest(rowIndex);
    });

    if (!didRegister) {
      console.warn(`Failed to register global hotkey: ${accelerator}`);
    }
  }

  for (const { accelerator, rowIndex } of GLOBAL_SET_EXACT_HOTKEY_BINDINGS) {
    const didRegister = globalShortcut.register(accelerator, () => {
      if (!shouldHandleGlobalHotkey(accelerator)) {
        return;
      }
      sendSetExactRequest(rowIndex);
    });

    if (!didRegister) {
      console.warn(`Failed to register global hotkey: ${accelerator}`);
    }
  }
}

function unregisterGlobalHotkeys(): void {
  for (const { accelerator } of GLOBAL_OFFSET_FOCUS_HOTKEY_BINDINGS) {
    globalShortcut.unregister(accelerator);
  }
  for (const { accelerator } of GLOBAL_SET_EXACT_HOTKEY_BINDINGS) {
    globalShortcut.unregister(accelerator);
  }
  lastGlobalHotkeyInvocationAtByAccelerator.clear();
}

function setGlobalHotkeysEnabled(enabled: boolean): void {
  const shouldEnable = Boolean(enabled);
  if (areGlobalHotkeysEnabled === shouldEnable) {
    return;
  }

  areGlobalHotkeysEnabled = shouldEnable;
  if (shouldEnable) {
    registerGlobalHotkeys();
    return;
  }

  unregisterGlobalHotkeys();
}

function returnToPreviousWindow(targetWindow: BrowserWindow | null): void {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (!targetWindow.isFocused()) {
    return;
  }

  const now = Date.now();
  if (now - lastReturnToPreviousWindowAt < RETURN_TO_PREVIOUS_WINDOW_COOLDOWN_MS) {
    return;
  }
  lastReturnToPreviousWindowAt = now;

  // Coalesce repeated calls and run after submit/keydown handlers settle.
  if (pendingReturnToPreviousWindowTimer !== null) {
    clearTimeout(pendingReturnToPreviousWindowTimer);
  }
  pendingReturnToPreviousWindowTimer = setTimeout(() => {
    pendingReturnToPreviousWindowTimer = null;
    if (!targetWindow || targetWindow.isDestroyed() || !targetWindow.isFocused()) {
      return;
    }

    targetWindow.blur();
  }, 0);
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

  ipcMain.handle(HISTORY_LOCAL_CACHE_DUCKDB_READ_CHANNEL, async (_event, userUid: unknown) => {
    if (typeof userUid !== "string") {
      throw new Error("Invalid history cache read user ID.");
    }
    return readHistoryLocalCacheFromDuckDb(userUid);
  });

  ipcMain.handle(HISTORY_LOCAL_CACHE_DUCKDB_WRITE_CHANNEL, async (_event, userUid: unknown, cache: unknown) => {
    if (typeof userUid !== "string") {
      throw new Error("Invalid history cache write user ID.");
    }
    await writeHistoryLocalCacheToDuckDb(userUid, cache);
  });

  ipcMain.handle(STATS_OVERVIEW_DUCKDB_QUERY_CHANNEL, async (_event, input: unknown) => {
    if (typeof input !== "object" || input === null) {
      throw new Error("Invalid stats overview query payload.");
    }

    const parsedInput = input as {
      userUid?: unknown;
      rangeStartMs?: unknown;
      includeTracksPerDay?: unknown;
      excludeMonsterNames?: unknown;
      distributionInterval?: unknown;
    };
    if (typeof parsedInput.userUid !== "string") {
      throw new Error("Invalid stats overview user ID.");
    }
    if (
      parsedInput.rangeStartMs !== null &&
      parsedInput.rangeStartMs !== undefined &&
      (typeof parsedInput.rangeStartMs !== "number" || !Number.isFinite(parsedInput.rangeStartMs))
    ) {
      throw new Error("Invalid stats overview range start.");
    }
    if (
      parsedInput.distributionInterval !== undefined &&
      parsedInput.distributionInterval !== "day" &&
      parsedInput.distributionInterval !== "hour"
    ) {
      throw new Error("Invalid stats overview distribution interval.");
    }

    return queryStatsOverviewFromDuckDb({
      userUid: parsedInput.userUid,
      rangeStartMs:
        typeof parsedInput.rangeStartMs === "number" ? Math.trunc(parsedInput.rangeStartMs) : null,
      includeTracksPerDay: Boolean(parsedInput.includeTracksPerDay),
      excludeMonsterNames: Array.isArray(parsedInput.excludeMonsterNames)
        ? parsedInput.excludeMonsterNames.filter((value): value is string => typeof value === "string")
        : [],
      distributionInterval: parsedInput.distributionInterval === "hour" ? "hour" : "day",
    });
  });

  ipcMain.on(WINDOW_MINIMIZE_CHANNEL, (event) => {
    getEventWindow(event)?.minimize();
  });

  ipcMain.on(WINDOW_TOGGLE_MAXIMIZE_CHANNEL, (event) => {
    const targetWindow = getEventWindow(event);
    if (!targetWindow) {
      return;
    }

    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
      return;
    }
    targetWindow.maximize();
  });

  ipcMain.on(WINDOW_CLOSE_CHANNEL, (event) => {
    getEventWindow(event)?.close();
  });

  ipcMain.handle(WINDOW_IS_MAXIMIZED_CHANNEL, (event) => {
    return getEventWindow(event)?.isMaximized() ?? false;
  });

  ipcMain.handle(APP_GET_VERSION_CHANNEL, () => APP_START_CALVER);
  ipcMain.handle(APP_GET_TITLEBAR_ICON_CHANNEL, () => resolveWindowIconDataUrl());
  ipcMain.on(APP_RETURN_TO_PREVIOUS_WINDOW_CHANNEL, (event) => {
    returnToPreviousWindow(getEventWindow(event));
  });
  ipcMain.on(APP_SET_GLOBAL_HOTKEYS_ENABLED_CHANNEL, (_event, value: unknown) => {
    setGlobalHotkeysEnabled(Boolean(value));
  });

  createMainWindow();
  registerGlobalHotkeys();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("will-quit", () => {
  if (pendingReturnToPreviousWindowTimer !== null) {
    clearTimeout(pendingReturnToPreviousWindowTimer);
    pendingReturnToPreviousWindowTimer = null;
  }
  if (rendererStaticServer) {
    rendererStaticServer.close();
    rendererStaticServer = null;
    rendererStaticServerUrl = null;
  }
  unregisterGlobalHotkeys();
  void closeHistoryLocalCacheDuckDb();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
