export {};

type StatsOverviewQueryInput = {
  userUid: string;
  rangeStartMs: number | null;
  includeTracksPerDay: boolean;
  excludeMonsterNames: string[];
  distributionInterval: "day" | "hour";
};

type StatsOverviewQueryResult = {
  totalTracksRange: number;
  totalTracksAllTime: number;
  mostActiveMonster: { name: string; count: number } | null;
  tracksPerDay: Array<{ day: string; count: number }>;
  topUsers: Array<{ uid: string | null; nickname: string; count: number }>;
  users: {
    leaderboard: Array<{ uid: string | null; nickname: string; count: number; sharePercent: number }>;
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
