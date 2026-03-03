export {};

type StatsOverviewQueryInput = {
  userUid: string;
  rangeStartMs: number | null;
  includeTracksPerDay: boolean;
  excludeMonsterNames: string[];
};

type StatsOverviewQueryResult = {
  totalTracksRange: number;
  totalTracksAllTime: number;
  mostActiveMonster: { name: string; count: number } | null;
  tracksPerDay: Array<{ day: string; count: number }>;
  topUsers: Array<{ uid: string | null; nickname: string; count: number }>;
};

declare global {
  interface Window {
    electronAPI: {
      importCsv: () => Promise<string | null>;
      pickAlertSoundFile: () => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      getTitleBarIcon: () => Promise<string | null>;
      onFocusOffsetMinutesByIndex: (listener: (rowIndex: number) => void) => () => void;
      onOpenSetExactByIndex: (listener: (rowIndex: number) => void) => () => void;
      returnToPreviousWindow: () => void;
      setGlobalHotkeysEnabled: (enabled: boolean) => void;
      readHistoryLocalCache: (userUid: string) => Promise<unknown | null>;
      writeHistoryLocalCache: (userUid: string, cache: unknown) => Promise<void>;
      queryStatsOverview: (input: StatsOverviewQueryInput) => Promise<StatsOverviewQueryResult>;
      googleOAuthSignIn: (
        clientId: string,
        clientSecret?: string
      ) => Promise<{ idToken: string; accessToken: string }>;
      windowControls?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizedStateChange: (listener: (isMaximized: boolean) => void) => () => void;
      };
    };
  }
}
