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
const APP_FOCUS_OFFSET_MINUTES_BY_INDEX_CHANNEL = "app:focus-offset-minutes-by-index";
const APP_OPEN_SET_EXACT_BY_INDEX_CHANNEL = "app:open-set-exact-by-index";
const APP_RETURN_TO_PREVIOUS_WINDOW_CHANNEL = "app:return-to-previous-window";
const APP_SET_GLOBAL_HOTKEYS_ENABLED_CHANNEL = "app:set-global-hotkeys-enabled";
const HISTORY_LOCAL_CACHE_DUCKDB_READ_CHANNEL = "history-local-cache:duckdb:read";
const HISTORY_LOCAL_CACHE_DUCKDB_WRITE_CHANNEL = "history-local-cache:duckdb:write";
const STATS_OVERVIEW_DUCKDB_QUERY_CHANNEL = "stats-overview:duckdb:query";

contextBridge.exposeInMainWorld("electronAPI", {
  importCsv: (): Promise<string | null> => ipcRenderer.invoke(IMPORT_CSV_CHANNEL),
  pickAlertSoundFile: (): Promise<string | null> => ipcRenderer.invoke(PICK_ALERT_SOUND_FILE_CHANNEL),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(APP_GET_VERSION_CHANNEL),
  getTitleBarIcon: (): Promise<string | null> => ipcRenderer.invoke(APP_GET_TITLEBAR_ICON_CHANNEL),
  onFocusOffsetMinutesByIndex: (listener: (rowIndex: number) => void): (() => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return;
      }
      listener(Math.max(0, Math.trunc(value)));
    };

    ipcRenderer.on(APP_FOCUS_OFFSET_MINUTES_BY_INDEX_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(APP_FOCUS_OFFSET_MINUTES_BY_INDEX_CHANNEL, wrappedListener);
    };
  },
  onOpenSetExactByIndex: (listener: (rowIndex: number) => void): (() => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return;
      }
      listener(Math.max(0, Math.trunc(value)));
    };

    ipcRenderer.on(APP_OPEN_SET_EXACT_BY_INDEX_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(APP_OPEN_SET_EXACT_BY_INDEX_CHANNEL, wrappedListener);
    };
  },
  returnToPreviousWindow: (): void => {
    ipcRenderer.send(APP_RETURN_TO_PREVIOUS_WINDOW_CHANNEL);
  },
  setGlobalHotkeysEnabled: (enabled: boolean): void => {
    ipcRenderer.send(APP_SET_GLOBAL_HOTKEYS_ENABLED_CHANNEL, Boolean(enabled));
  },
  readHistoryLocalCache: (userUid: string): Promise<unknown | null> =>
    ipcRenderer.invoke(HISTORY_LOCAL_CACHE_DUCKDB_READ_CHANNEL, userUid),
  writeHistoryLocalCache: (userUid: string, cache: unknown): Promise<void> =>
    ipcRenderer.invoke(HISTORY_LOCAL_CACHE_DUCKDB_WRITE_CHANNEL, userUid, cache),
  queryStatsOverview: (input: {
    userUid: string;
    rangeStartMs: number | null;
    includeTracksPerDay: boolean;
    excludeMonsterNames: string[];
    distributionInterval: "day" | "hour";
  }): Promise<{
    totalTracksRange: number;
    totalTracksAllTime: number;
    mostActiveMonster: { name: string; count: number } | null;
    tracksPerDay: Array<{ day: string; count: number }>;
    topUsers: Array<{ uid: string | null; nickname: string; count: number }>;
    users: {
      leaderboard: Array<{ uid: string | null; nickname: string; count: number; sharePercent: number }>;
      mostTracksInDay: Array<{ uid: string | null; nickname: string; day: string; count: number }>;
      topMonsterTracked: Array<{ uid: string | null; nickname: string; monsterName: string; count: number }>;
      longestStreakHours: Array<{ uid: string | null; nickname: string; hours: number }>;
      additionalStats: Array<{
        uid: string | null;
        nickname: string;
        leastFavoriteMonster: { name: string; count: number } | null;
        setExacts: number;
        editsDone: number;
        timesReset: number;
      }>;
    };
    monsters: {
      perMonster: Array<{
        monsterName: string;
        trackedCount: number;
        editOffsetCount: number;
        setExactCount: number;
        mostKilledBy: Array<{ uid: string | null; nickname: string; count: number }>;
        leastKilledBy: Array<{ uid: string | null; nickname: string; count: number }>;
      }>;
    };
    distribution: {
      days: string[];
      series: Array<{ personId: string | null; personName: string; values: number[]; total: number }>;
      totalsPerDay: number[];
      summary: {
        totalAllDays: number;
        avgPerDay: number;
        maxDayTotal: number;
        activeUsers: number;
        daysRecorded: number;
      };
    };
    timeTrends: {
      bucketInterval: "day" | "hour";
      buckets: Array<{
        bucket: string;
        trackedCount: number;
        trackedMovingAverage: number;
        activeTrackerCount: number;
        editOffsetCount: number;
        setExactCount: number;
        editLastKilledCount: number;
        resetAllTimersCount: number;
        correctionRatePercent: number;
      }>;
      monsterMomentum: Array<{
        monsterName: string;
        currentTracks: number;
        previousTracks: number;
        delta: number;
        deltaPercent: number | null;
      }>;
      hourOfWeekHeatmap: Array<{
        dayOfWeek: number;
        hourOfDay: number;
        trackedCount: number;
      }>;
      handoffRates: Array<{
        monsterName: string;
        handoffCount: number;
        comparableTransitions: number;
        handoffRatePercent: number;
      }>;
    };
  }> => ipcRenderer.invoke(STATS_OVERVIEW_DUCKDB_QUERY_CHANNEL, input),
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
