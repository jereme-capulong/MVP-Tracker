import { app } from "electron";
import path from "node:path";

const HISTORY_LOCAL_CACHE_DUCKDB_FILENAME = "mvp-tracker-local-cache.duckdb";
const HISTORY_LOCAL_CACHE_TABLE_NAME = "history_local_cache";
const HISTORY_ANALYTICS_TRACKS_TABLE_NAME = "history_analytics_tracks";
const TRACKED_MONSTER_ACTION_NORM = "tracked monster";
const LEGACY_RESET_TIMER_NOW_ACTION_NORM = "reset timer now";
const LEGACY_RESET_HISTORY_NOW_ACTION_NORM = "reset history now";
const EXCLUDED_HISTORY_ACTION_NORMS = new Set<string>([
  LEGACY_RESET_TIMER_NOW_ACTION_NORM,
  LEGACY_RESET_HISTORY_NOW_ACTION_NORM,
]);
const SET_EXACT_SPAWN_ACTION_NORM = "set exact spawn";
const RESET_ALL_TIMERS_ACTION_NORM = "reset all timers";
const EDIT_OFFSET_ACTION_NORM = "edit offset";
const EDIT_LAST_KILLED_ACTION_NORM = "edit last killed";
const EDIT_MONSTER_DETAIL_ACTION_NORM = "edit monster detail";
const EDIT_MONSTER_DETAILS_ACTION_NORM = "edit monster details";
const STATS_USER_RANKING_LIMIT = 10;
const STATS_DISTRIBUTION_INTERVAL_DAY = "day";
const STATS_DISTRIBUTION_INTERVAL_HOUR = "hour";
const STATS_DAY_MS = 24 * 60 * 60 * 1000;
const STATS_TREND_MAX_BUCKETS = 720;
const STATS_MOMENTUM_ROW_LIMIT = 30;
const STATS_HANDOFF_ROW_LIMIT = 40;
const STATS_MOMENTUM_FALLBACK_WINDOW_MS = 30 * STATS_DAY_MS;
type StatsDistributionInterval =
  | typeof STATS_DISTRIBUTION_INTERVAL_DAY
  | typeof STATS_DISTRIBUTION_INTERVAL_HOUR;

type HistoryAnalyticsEventRow = {
  historyId: string;
  timestampMs: number;
  dayKeyLocal: string;
  hourKeyLocal: string;
  monsterId: string | null;
  monsterName: string;
  monsterNameNorm: string;
  action: string;
  actionNorm: string;
  userUid: string | null;
  userNickname: string;
};

type ParsedHistoryLocalCache = {
  entries: unknown[];
};

type TrackCountRow = {
  track_count?: unknown;
};

type MostActiveMonsterRow = {
  monster_name?: unknown;
  track_count?: unknown;
};

type TracksPerDayRow = {
  day_key_local?: unknown;
  track_count?: unknown;
};

type UserTopMonsterRow = {
  person_id?: unknown;
  person_name?: unknown;
  monster_name?: unknown;
  track_count?: unknown;
};

type UserMostTracksInDayRow = {
  person_id?: unknown;
  person_name?: unknown;
  day_key_local?: unknown;
  track_count?: unknown;
};

type UserLongestStreakRow = {
  person_id?: unknown;
  person_name?: unknown;
  streak_hours?: unknown;
};

type AdditionalUserStatsRow = {
  person_id?: unknown;
  person_name?: unknown;
  least_favorite_monster?: unknown;
  least_favorite_count?: unknown;
  set_exact_count?: unknown;
  edit_count?: unknown;
  times_reset_count?: unknown;
};

type MonsterStatsRow = {
  monster_key?: unknown;
  monster_name?: unknown;
  tracked_count?: unknown;
  edit_offset_count?: unknown;
  set_exact_count?: unknown;
};

type MonsterTrackedByUserRow = {
  monster_key?: unknown;
  monster_name?: unknown;
  person_id?: unknown;
  person_name?: unknown;
  tracked_count?: unknown;
};

type DailyContributionRow = {
  bucket_key_local?: unknown;
  person_id?: unknown;
  person_name?: unknown;
  contribution_sum?: unknown;
};

type TimeTrendBucketRow = {
  bucket_key_local?: unknown;
  tracked_count?: unknown;
  active_tracker_count?: unknown;
  edit_offset_count?: unknown;
  set_exact_count?: unknown;
  edit_last_killed_count?: unknown;
  reset_all_timers_count?: unknown;
};

type MonsterMomentumRow = {
  monster_name?: unknown;
  current_count?: unknown;
  previous_count?: unknown;
};

type HourOfWeekHeatmapRow = {
  day_of_week?: unknown;
  hour_of_day?: unknown;
  tracked_count?: unknown;
};

type MonsterHandoffRateRow = {
  monster_name?: unknown;
  handoff_count?: unknown;
  comparable_transition_count?: unknown;
};

type AllTimeRangeCountRow = {
  track_count?: unknown;
};

type HistoryIdRow = {
  history_id?: unknown;
};

type StatsDistributionSummary = {
  totalAllDays: number;
  avgPerDay: number;
  maxDayTotal: number;
  activeUsers: number;
  daysRecorded: number;
};

type StatsDistributionSeries = {
  personId: string | null;
  personName: string;
  values: number[];
  total: number;
};

type StatsDistributionData = {
  days: string[];
  series: StatsDistributionSeries[];
  totalsPerDay: number[];
  summary: StatsDistributionSummary;
};

export type QueryStatsOverviewInput = {
  userUid: string;
  rangeStartMs: number | null;
  includeTracksPerDay: boolean;
  excludeMonsterNames: string[];
  distributionInterval: StatsDistributionInterval;
};

export type QueryStatsOverviewResult = {
  totalTracksRange: number;
  totalTracksAllTime: number;
  mostActiveMonster: {
    name: string;
    count: number;
  } | null;
  tracksPerDay: Array<{ day: string; count: number }>;
  topUsers: Array<{
    uid: string | null;
    nickname: string;
    count: number;
  }>;
  users: {
    leaderboard: Array<{
      uid: string | null;
      nickname: string;
      count: number;
      sharePercent: number;
    }>;
    mostTracksInDay: Array<{
      uid: string | null;
      nickname: string;
      day: string;
      count: number;
    }>;
    topMonsterTracked: Array<{
      uid: string | null;
      nickname: string;
      monsterName: string;
      count: number;
    }>;
    longestStreakHours: Array<{
      uid: string | null;
      nickname: string;
      hours: number;
    }>;
    additionalStats: Array<{
      uid: string | null;
      nickname: string;
      leastFavoriteMonster: {
        name: string;
        count: number;
      } | null;
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
      mostKilledBy: Array<{
        uid: string | null;
        nickname: string;
        count: number;
      }>;
      leastKilledBy: Array<{
        uid: string | null;
        nickname: string;
        count: number;
      }>;
    }>;
  };
  distribution: StatsDistributionData;
  timeTrends: {
    bucketInterval: StatsDistributionInterval;
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
};

type DuckDbModule = {
  Database: new (path: string) => DuckDbDatabase;
};

type DuckDbDatabase = {
  connect: () => DuckDbConnection;
  close: (callback?: (error?: unknown) => void) => void;
};

type DuckDbConnection = {
  run: (sql: string, ...args: unknown[]) => unknown;
  all: (sql: string, ...args: unknown[]) => void;
  close: (callback?: (error?: unknown) => void) => void;
};

let cachedDatabasePromise: Promise<DuckDbDatabase> | null = null;
let didLogInitializationError = false;
const syncedHistoryTrackIdsByUserUid = new Map<string, Set<string>>();
const pendingHistoryAnalyticsSyncPromisesByUserUid = new Map<
  string,
  Promise<void>
>();

import { promises as fs } from "node:fs";

function loadDuckDbModule(): DuckDbModule {
  const requiredModule = require("duckdb");
  if (!requiredModule || typeof requiredModule.Database !== "function") {
    throw new Error("DuckDB module is unavailable.");
  }
  return requiredModule as DuckDbModule;
}

function runDuckDbStatement(
  connection: DuckDbConnection,
  sql: string,
  parameters: unknown[] = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const callback = (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      if (parameters.length === 0) {
        connection.run(sql, callback);
        return;
      }
      connection.run(sql, ...parameters, callback);
    } catch (error) {
      reject(error);
    }
  });
}

function readDuckDbRows<T extends Record<string, unknown>>(
  connection: DuckDbConnection,
  sql: string,
  parameters: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const callback = (error: unknown, rows: Array<Record<string, unknown>>) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((rows as T[]) ?? []);
    };

    try {
      if (parameters.length === 0) {
        connection.all(sql, callback);
        return;
      }
      connection.all(sql, ...parameters, callback);
    } catch (error) {
      reject(error);
    }
  });
}

function closeDuckDbConnection(connection: DuckDbConnection): Promise<void> {
  return new Promise((resolve) => {
    try {
      connection.close(() => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function closeDuckDbDatabase(database: DuckDbDatabase): Promise<void> {
  return new Promise((resolve) => {
    try {
      database.close(() => {
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function getLocalDayKeyFromTimestampMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "1970-01-01";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalHourKeyFromTimestampMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return "1970-01-01 00:00";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:00`;
}

function normalizeTrackCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return Number(value > 0n ? value : 0n);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

function normalizeAverageValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function normalizeSignedAverageValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function parseLocalDayKeyToTimestampMs(dayKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    return null;
  }
  const parsed = new Date(`${dayKey}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.getTime();
}

function parseLocalHourKeyToTimestampMs(hourKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(hourKey)) {
    return null;
  }
  const parsed = new Date(
    `${hourKey.slice(0, 10)}T${hourKey.slice(11, 13)}:00:00`,
  );
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.getTime();
}

function floorToLocalDayTimestampMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback.getTime();
  }
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function floorToLocalHourTimestampMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  if (!Number.isFinite(date.getTime())) {
    const fallback = new Date();
    fallback.setMinutes(0, 0, 0);
    return fallback.getTime();
  }
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function buildContiguousDayKeys(
  startDayTimestampMs: number,
  endDayTimestampMs: number,
): string[] {
  if (
    !Number.isFinite(startDayTimestampMs) ||
    !Number.isFinite(endDayTimestampMs)
  ) {
    return [];
  }

  const start = floorToLocalDayTimestampMs(startDayTimestampMs);
  const end = floorToLocalDayTimestampMs(endDayTimestampMs);
  if (start > end) {
    return [getLocalDayKeyFromTimestampMs(end)];
  }

  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end) {
    days.push(getLocalDayKeyFromTimestampMs(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildContiguousHourKeys(
  startHourTimestampMs: number,
  endHourTimestampMs: number,
): string[] {
  if (
    !Number.isFinite(startHourTimestampMs) ||
    !Number.isFinite(endHourTimestampMs)
  ) {
    return [];
  }

  const start = floorToLocalHourTimestampMs(startHourTimestampMs);
  const end = floorToLocalHourTimestampMs(endHourTimestampMs);
  if (start > end) {
    return [getLocalHourKeyFromTimestampMs(end)];
  }

  const hours: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end) {
    hours.push(getLocalHourKeyFromTimestampMs(cursor.getTime()));
    cursor.setHours(cursor.getHours() + 1);
  }
  return hours;
}

function buildEmptyStatsDistribution(
  nowTimestampMs = Date.now(),
): StatsDistributionData {
  const currentDay = getLocalDayKeyFromTimestampMs(nowTimestampMs);
  return {
    days: [currentDay],
    series: [],
    totalsPerDay: [0],
    summary: {
      totalAllDays: 0,
      avgPerDay: 0,
      maxDayTotal: 0,
      activeUsers: 0,
      daysRecorded: 0,
    },
  };
}

function buildEmptyStatsOverviewResult(): QueryStatsOverviewResult {
  const nowTimestampMs = Date.now();
  const fallbackBucket =
    getLocalHourKeyFromTimestampMs(nowTimestampMs);
  return {
    totalTracksRange: 0,
    totalTracksAllTime: 0,
    mostActiveMonster: null,
    tracksPerDay: [],
    topUsers: [],
    users: {
      leaderboard: [],
      mostTracksInDay: [],
      topMonsterTracked: [],
      longestStreakHours: [],
      additionalStats: [],
    },
    monsters: {
      perMonster: [],
    },
    distribution: buildEmptyStatsDistribution(),
    timeTrends: {
      bucketInterval: STATS_DISTRIBUTION_INTERVAL_HOUR,
      buckets: [
        {
          bucket: fallbackBucket,
          trackedCount: 0,
          trackedMovingAverage: 0,
          activeTrackerCount: 0,
          editOffsetCount: 0,
          setExactCount: 0,
          editLastKilledCount: 0,
          resetAllTimersCount: 0,
          correctionRatePercent: 0,
        },
      ],
      monsterMomentum: [],
      hourOfWeekHeatmap: [],
      handoffRates: [],
    },
  };
}

function normalizeHistoryLocalCacheEntries(cache: unknown): unknown[] {
  if (typeof cache !== "object" || cache === null) {
    return [];
  }

  const parsed = cache as Partial<ParsedHistoryLocalCache>;
  if (!Array.isArray(parsed.entries)) {
    return [];
  }
  return parsed.entries;
}

function normalizeHistoryActionForAnalytics(action: string): string {
  const normalizedAction = action.trim().toLowerCase();
  if (EXCLUDED_HISTORY_ACTION_NORMS.has(normalizedAction)) {
    return "";
  }
  return normalizedAction;
}

function normalizeHistoryAnalyticsEventRows(
  entries: unknown[],
  alreadySyncedHistoryIds?: ReadonlySet<string>,
): HistoryAnalyticsEventRow[] {
  const dedupedRowsById = new Map<string, HistoryAnalyticsEventRow>();

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const data = entry as {
      id?: unknown;
      timestampIso?: unknown;
      action?: unknown;
      monsterId?: unknown;
      monsterName?: unknown;
      userUid?: unknown;
      userNickname?: unknown;
    };

    const historyId = typeof data.id === "string" ? data.id.trim() : "";
    if (!historyId) {
      continue;
    }
    if (alreadySyncedHistoryIds?.has(historyId)) {
      continue;
    }

    const timestampIso =
      typeof data.timestampIso === "string" ? data.timestampIso : "";
    const timestampMs = Date.parse(timestampIso);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    const monsterName =
      typeof data.monsterName === "string" ? data.monsterName.trim() : "";
    if (!monsterName) {
      continue;
    }
    const monsterId =
      typeof data.monsterId === "string" && data.monsterId.trim()
        ? data.monsterId.trim()
        : null;
    const action = typeof data.action === "string" ? data.action.trim() : "";
    if (!action) {
      continue;
    }
    const actionNorm = normalizeHistoryActionForAnalytics(action);
    if (!actionNorm) {
      continue;
    }

    const userUid =
      typeof data.userUid === "string" && data.userUid.trim()
        ? data.userUid.trim()
        : null;
    const userNickname =
      typeof data.userNickname === "string" && data.userNickname.trim()
        ? data.userNickname.trim()
        : "Unknown User";

    dedupedRowsById.set(historyId, {
      historyId,
      timestampMs: Math.trunc(timestampMs),
      dayKeyLocal: getLocalDayKeyFromTimestampMs(timestampMs),
      hourKeyLocal: getLocalHourKeyFromTimestampMs(timestampMs),
      monsterId,
      monsterName,
      monsterNameNorm: monsterName.toLowerCase(),
      action,
      actionNorm,
      userUid,
      userNickname,
    });
  }

  return Array.from(dedupedRowsById.values());
}

function isDuckDbConcurrentConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("duplicate key") || message.includes("conflict on tuple")
  );
}

function isDuckDbColumnAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("already exists") || message.includes("duplicate column")
  );
}

async function addColumnIfMissing(
  connection: DuckDbConnection,
  tableName: string,
  columnDefinitionSql: string,
): Promise<void> {
  try {
    await runDuckDbStatement(
      connection,
      `ALTER TABLE ${tableName}
       ADD COLUMN IF NOT EXISTS ${columnDefinitionSql}`,
    );
  } catch {
    try {
      await runDuckDbStatement(
        connection,
        `ALTER TABLE ${tableName}
         ADD COLUMN ${columnDefinitionSql}`,
      );
    } catch (fallbackError) {
      if (!isDuckDbColumnAlreadyExistsError(fallbackError)) {
        throw fallbackError;
      }
    }
  }
}

async function upsertHistoryAnalyticsEventRows(
  connection: DuckDbConnection,
  normalizedUserUid: string,
  rows: HistoryAnalyticsEventRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    try {
      await runDuckDbStatement(
        connection,
        `INSERT INTO ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME} (
          user_uid,
          history_id,
          timestamp_ms,
          day_key_local,
          hour_key_local,
          monster_id,
          monster_name,
          monster_name_norm,
          action,
          action_norm,
          tracked_by_uid,
          tracked_by_nickname
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        -- Concurrent writers can attempt the same key at the same time.
        ON CONFLICT (user_uid, history_id) DO UPDATE
        SET
          hour_key_local = excluded.hour_key_local,
          monster_id = coalesce(monster_id, excluded.monster_id),
          action = excluded.action,
          tracked_by_uid = excluded.tracked_by_uid,
          tracked_by_nickname = excluded.tracked_by_nickname`,
        [
          normalizedUserUid,
          row.historyId,
          row.timestampMs,
          row.dayKeyLocal,
          row.hourKeyLocal,
          row.monsterId,
          row.monsterName,
          row.monsterNameNorm,
          row.action,
          row.actionNorm,
          row.userUid,
          row.userNickname,
        ],
      );
    } catch (error) {
      // Analytics table is derived from cache payload; ignore transient conflicts.
      if (!isDuckDbConcurrentConflictError(error)) {
        throw error;
      }
    }
  }
}

async function syncHistoryAnalyticsTracksFromCache(
  connection: DuckDbConnection,
  normalizedUserUid: string,
  cache: unknown,
): Promise<void> {
  await deleteExcludedHistoryAnalyticsRows(connection, normalizedUserUid);

  const entries = normalizeHistoryLocalCacheEntries(cache);
  if (entries.length === 0) {
    return;
  }

  const alreadySyncedHistoryIds =
    syncedHistoryTrackIdsByUserUid.get(normalizedUserUid);
  const analyticsRows = normalizeHistoryAnalyticsEventRows(
    entries,
    alreadySyncedHistoryIds,
  );
  if (analyticsRows.length === 0) {
    return;
  }

  await upsertHistoryAnalyticsEventRows(
    connection,
    normalizedUserUid,
    analyticsRows,
  );
  const syncedIds = alreadySyncedHistoryIds ?? new Set<string>();
  for (const row of analyticsRows) {
    syncedIds.add(row.historyId);
  }
  syncedHistoryTrackIdsByUserUid.set(normalizedUserUid, syncedIds);
}

async function deleteExcludedHistoryAnalyticsRows(
  connection: DuckDbConnection,
  normalizedUserUid: string,
): Promise<void> {
  if (EXCLUDED_HISTORY_ACTION_NORMS.size === 0) {
    return;
  }

  const excludedActions = Array.from(EXCLUDED_HISTORY_ACTION_NORMS);
  const placeholders = excludedActions.map(() => "?").join(", ");
  const rows = await readDuckDbRows<HistoryIdRow>(
    connection,
    `SELECT history_id
     FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
     WHERE user_uid = ?
       AND lower(trim(action)) IN (${placeholders})`,
    [normalizedUserUid, ...excludedActions],
  );

  if (rows.length === 0) {
    return;
  }

  await runDuckDbStatement(
    connection,
    `DELETE FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
     WHERE user_uid = ?
       AND lower(trim(action)) IN (${placeholders})`,
    [normalizedUserUid, ...excludedActions],
  );

  const syncedIds = syncedHistoryTrackIdsByUserUid.get(normalizedUserUid);
  if (!syncedIds) {
    return;
  }

  for (const row of rows) {
    const historyId =
      typeof row.history_id === "string" ? row.history_id.trim() : "";
    if (historyId) {
      syncedIds.delete(historyId);
    }
  }

  if (syncedIds.size === 0) {
    syncedHistoryTrackIdsByUserUid.delete(normalizedUserUid);
  }
}

function queueHistoryAnalyticsSyncFromCache(
  normalizedUserUid: string,
  cache: unknown,
): void {
  if (!normalizedUserUid.trim()) {
    return;
  }
  if (pendingHistoryAnalyticsSyncPromisesByUserUid.has(normalizedUserUid)) {
    return;
  }

  const syncPromise = (async () => {
    try {
      const database = await getHistoryLocalCacheDatabase();
      const connection = database.connect();
      try {
        await syncHistoryAnalyticsTracksFromCache(
          connection,
          normalizedUserUid,
          cache,
        );
      } finally {
        await closeDuckDbConnection(connection);
      }
    } catch (syncError) {
      console.warn(
        "Failed to sync history analytics tracks in background.",
        syncError,
      );
    } finally {
      pendingHistoryAnalyticsSyncPromisesByUserUid.delete(normalizedUserUid);
    }
  })();

  pendingHistoryAnalyticsSyncPromisesByUserUid.set(
    normalizedUserUid,
    syncPromise,
  );
}

function createMonsterExcludeClause(excludeMonsterNames: string[]): {
  sql: string;
  parameters: unknown[];
} {
  if (excludeMonsterNames.length === 0) {
    return { sql: "", parameters: [] };
  }

  const normalizedNames = Array.from(
    new Set(
      excludeMonsterNames
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0),
    ),
  );
  if (normalizedNames.length === 0) {
    return { sql: "", parameters: [] };
  }

  const placeholders = normalizedNames.map(() => "?").join(", ");
  return {
    sql: ` AND monster_name_norm NOT IN (${placeholders})`,
    parameters: normalizedNames,
  };
}

async function ensureSchema(database: DuckDbDatabase): Promise<void> {
  const connection = database.connect();
  try {
    await runDuckDbStatement(
      connection,
      `CREATE TABLE IF NOT EXISTS ${HISTORY_LOCAL_CACHE_TABLE_NAME} (
        user_uid VARCHAR PRIMARY KEY,
        payload_json VARCHAR NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_local_cache_updated_at_idx
       ON ${HISTORY_LOCAL_CACHE_TABLE_NAME}(updated_at)`,
    );
    await runDuckDbStatement(
      connection,
      `CREATE TABLE IF NOT EXISTS ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME} (
        user_uid VARCHAR NOT NULL,
        history_id VARCHAR NOT NULL,
        timestamp_ms BIGINT NOT NULL,
        day_key_local VARCHAR NOT NULL,
        hour_key_local VARCHAR,
        monster_id VARCHAR,
        monster_name VARCHAR NOT NULL,
        monster_name_norm VARCHAR NOT NULL,
        action VARCHAR,
        action_norm VARCHAR,
        tracked_by_uid VARCHAR,
        tracked_by_nickname VARCHAR NOT NULL,
        PRIMARY KEY (user_uid, history_id)
      )`,
    );
    await addColumnIfMissing(
      connection,
      HISTORY_ANALYTICS_TRACKS_TABLE_NAME,
      "hour_key_local VARCHAR",
    );
    await addColumnIfMissing(
      connection,
      HISTORY_ANALYTICS_TRACKS_TABLE_NAME,
      "monster_id VARCHAR",
    );
    await addColumnIfMissing(
      connection,
      HISTORY_ANALYTICS_TRACKS_TABLE_NAME,
      "action VARCHAR",
    );
    await addColumnIfMissing(
      connection,
      HISTORY_ANALYTICS_TRACKS_TABLE_NAME,
      "action_norm VARCHAR",
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_ts_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, timestamp_ms)`,
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_monster_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, monster_name_norm)`,
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_day_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, day_key_local)`,
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_action_ts_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, action_norm, timestamp_ms)`,
    );
  } finally {
    await closeDuckDbConnection(connection);
  }
}

async function getHistoryLocalCacheDatabase(): Promise<DuckDbDatabase> {
  if (!cachedDatabasePromise) {
    cachedDatabasePromise = (async () => {
      const duckDb = loadDuckDbModule();
      const databasePath = path.join(
        app.getPath("userData"),
        HISTORY_LOCAL_CACHE_DUCKDB_FILENAME,
      );
      const database = new duckDb.Database(databasePath);
      await ensureSchema(database);
      return database;
    })().catch((error) => {
      cachedDatabasePromise = null;
      if (!didLogInitializationError) {
        didLogInitializationError = true;
        console.error("Failed to initialize history cache DuckDB.", error);
      }
      throw error;
    });
  }
  return cachedDatabasePromise;
}

export async function readHistoryLocalCacheFromDuckDb(
  userUid: string,
): Promise<unknown | null> {
  const normalizedUserUid = userUid.trim();
  if (!normalizedUserUid) {
    return null;
  }

  try {
    const database = await getHistoryLocalCacheDatabase();
    const connection = database.connect();
    try {
      const rows = await readDuckDbRows<{ payload_json?: unknown }>(
        connection,
        `SELECT payload_json
         FROM ${HISTORY_LOCAL_CACHE_TABLE_NAME}
         WHERE user_uid = ?
         LIMIT 1`,
        [normalizedUserUid],
      );

      let payloadJson = rows[0]?.payload_json;
      if (typeof payloadJson !== "string") {
        // Fallback for auth UID changes: prefer the richest cached payload over returning empty.
        const fallbackRows = await readDuckDbRows<{ payload_json?: unknown }>(
          connection,
          `SELECT payload_json
           FROM ${HISTORY_LOCAL_CACHE_TABLE_NAME}
           WHERE payload_json IS NOT NULL
           ORDER BY length(payload_json) DESC
           LIMIT 1`,
        );
        payloadJson = fallbackRows[0]?.payload_json;
        if (typeof payloadJson === "string") {
          console.warn(
            `History cache row for UID "${normalizedUserUid}" is missing; using best available local cache row.`,
          );
        }
      }

      if (typeof payloadJson !== "string") {
        return null;
      }
      const parsedCache = JSON.parse(payloadJson);
      queueHistoryAnalyticsSyncFromCache(normalizedUserUid, parsedCache);
      return parsedCache;
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to read history local cache from DuckDB.", error);
    throw error;
  }
}

export async function writeHistoryLocalCacheToDuckDb(
  userUid: string,
  cache: unknown,
): Promise<void> {
  const normalizedUserUid = userUid.trim();
  if (!normalizedUserUid || typeof cache !== "object" || cache === null) {
    return;
  }

  try {
    const database = await getHistoryLocalCacheDatabase();
    const connection = database.connect();
    try {
      const payloadJson = JSON.stringify(cache);
      await runDuckDbStatement(
        connection,
        // DuckDB rejects assignments to indexed columns inside ON CONFLICT DO UPDATE.
        `INSERT INTO ${HISTORY_LOCAL_CACHE_TABLE_NAME} (user_uid, payload_json)
         VALUES (?, ?)
         ON CONFLICT (user_uid) DO UPDATE
         SET payload_json = excluded.payload_json`,
        [normalizedUserUid, payloadJson],
      );
      try {
        await syncHistoryAnalyticsTracksFromCache(
          connection,
          normalizedUserUid,
          cache,
        );
      } catch (syncError) {
        console.warn(
          "Failed to sync history analytics tracks during cache write.",
          syncError,
        );
      }
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to write history local cache to DuckDB.", error);
  }
}

export async function queryStatsOverviewFromDuckDb(
  input: QueryStatsOverviewInput,
): Promise<QueryStatsOverviewResult> {
  const normalizedUserUid = input.userUid.trim();
  if (!normalizedUserUid) {
    return buildEmptyStatsOverviewResult();
  }

  const normalizedRangeStartMs =
    typeof input.rangeStartMs === "number" &&
    Number.isFinite(input.rangeStartMs)
      ? Math.max(0, Math.trunc(input.rangeStartMs))
      : null;
  const includeTracksPerDay = Boolean(input.includeTracksPerDay);
  const distributionInterval: StatsDistributionInterval =
    input.distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
      ? STATS_DISTRIBUTION_INTERVAL_HOUR
      : STATS_DISTRIBUTION_INTERVAL_DAY;
  const monsterExcludeClause = createMonsterExcludeClause(
    input.excludeMonsterNames,
  );

  try {
    const database = await getHistoryLocalCacheDatabase();
    const connection = database.connect();
    try {
      const nowTimestampMs = Date.now();
      const rangeWhereSqlParts = [`user_uid = ?${monsterExcludeClause.sql}`];
      const rangeWhereParameters: unknown[] = [
        normalizedUserUid,
        ...monsterExcludeClause.parameters,
      ];
      if (normalizedRangeStartMs !== null) {
        rangeWhereSqlParts.push("timestamp_ms >= ?");
        rangeWhereParameters.push(normalizedRangeStartMs);
      }
      const rangeWhereSql = rangeWhereSqlParts.join(" AND ");
      const normalizedActionSql = `coalesce(
        nullif(trim(action_norm), ''),
        nullif(lower(trim(action)), ''),
        '${TRACKED_MONSTER_ACTION_NORM}'
      )`;
      const monsterKeySql = `coalesce(
        nullif(trim(monster_id), ''),
        'name:' || monster_name_norm
      )`;
      const rangeTrackedWhereSql = `${rangeWhereSql} AND ${normalizedActionSql} = ?`;
      const rangeTrackedWhereParameters: unknown[] = [
        ...rangeWhereParameters,
        TRACKED_MONSTER_ACTION_NORM,
      ];

      const allTimeWhereSql = `user_uid = ?${monsterExcludeClause.sql}`;
      const allTimeWhereParameters: unknown[] = [
        normalizedUserUid,
        ...monsterExcludeClause.parameters,
      ];
      const allTimeTrackedWhereSql = `${allTimeWhereSql} AND ${normalizedActionSql} = ?`;
      const allTimeTrackedWhereParameters: unknown[] = [
        ...allTimeWhereParameters,
        TRACKED_MONSTER_ACTION_NORM,
      ];
      const momentumWindowMs =
        normalizedRangeStartMs !== null
          ? Math.max(60 * 60 * 1000, nowTimestampMs - normalizedRangeStartMs)
          : STATS_MOMENTUM_FALLBACK_WINDOW_MS;
      const currentMomentumWindowStartMs =
        nowTimestampMs - momentumWindowMs;
      const previousMomentumWindowStartMs =
        currentMomentumWindowStartMs - momentumWindowMs;
      const distributionBucketSql =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? "coalesce(hour_key_local, day_key_local || ' 00:00')"
          : "day_key_local";
      const allTimeCountRows = await readDuckDbRows<AllTimeRangeCountRow>(
        connection,
        `SELECT COUNT(*) AS track_count
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${allTimeTrackedWhereSql}`,
        allTimeTrackedWhereParameters,
      );
      const mostActiveMonsterRows = await readDuckDbRows<MostActiveMonsterRow>(
        connection,
        `WITH filtered_tracks AS (
           SELECT
             ${monsterKeySql} AS monster_key,
             monster_name,
             monster_name_norm,
             timestamp_ms
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeTrackedWhereSql}
         ),
         monster_counts AS (
           SELECT
             monster_key,
             COUNT(*) AS track_count
           FROM filtered_tracks
           GROUP BY monster_key
         ),
         monster_latest_names AS (
           SELECT
             monster_key,
             monster_name,
             monster_name_norm
           FROM (
             SELECT
               monster_key,
               monster_name,
               monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY monster_key
                 ORDER BY timestamp_ms DESC, monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_tracks
           )
           WHERE latest_rank = 1
         )
         SELECT
           monster_latest_names.monster_name AS monster_name,
           monster_counts.track_count AS track_count
         FROM monster_counts
         INNER JOIN monster_latest_names
           ON monster_latest_names.monster_key = monster_counts.monster_key
         ORDER BY monster_counts.track_count DESC, monster_latest_names.monster_name_norm ASC
         LIMIT 1`,
        rangeTrackedWhereParameters,
      );
      const contributionRows = await readDuckDbRows<DailyContributionRow>(
        connection,
        `SELECT
           ${distributionBucketSql} AS bucket_key_local,
           tracked_by_uid AS person_id,
           tracked_by_nickname AS person_name,
           SUM(1) AS contribution_sum
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${rangeTrackedWhereSql}
         GROUP BY 1, tracked_by_uid, tracked_by_nickname
         ORDER BY 1 ASC, contribution_sum DESC, lower(tracked_by_nickname) ASC`,
        rangeTrackedWhereParameters,
      );
      const timeTrendBucketRows = await readDuckDbRows<TimeTrendBucketRow>(
        connection,
        `WITH filtered_rows AS (
           SELECT
             ${distributionBucketSql} AS bucket_key_local,
             ${normalizedActionSql} AS action_norm,
             nullif(trim(tracked_by_uid), '') AS tracker_uid
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeWhereSql}
             AND ${normalizedActionSql} IN (?, ?, ?, ?, ?)
         )
         SELECT
           bucket_key_local,
           SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS tracked_count,
           COUNT(
             DISTINCT CASE
               WHEN action_norm = ? THEN tracker_uid
               ELSE NULL
             END
           ) AS active_tracker_count,
           SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS edit_offset_count,
           SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS set_exact_count,
           SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS edit_last_killed_count,
           SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS reset_all_timers_count
         FROM filtered_rows
         GROUP BY bucket_key_local
         ORDER BY bucket_key_local ASC`,
        [
          ...rangeWhereParameters,
          TRACKED_MONSTER_ACTION_NORM,
          EDIT_OFFSET_ACTION_NORM,
          SET_EXACT_SPAWN_ACTION_NORM,
          EDIT_LAST_KILLED_ACTION_NORM,
          RESET_ALL_TIMERS_ACTION_NORM,
          TRACKED_MONSTER_ACTION_NORM,
          TRACKED_MONSTER_ACTION_NORM,
          EDIT_OFFSET_ACTION_NORM,
          SET_EXACT_SPAWN_ACTION_NORM,
          EDIT_LAST_KILLED_ACTION_NORM,
          RESET_ALL_TIMERS_ACTION_NORM,
        ],
      );
      const monsterMomentumRows = await readDuckDbRows<MonsterMomentumRow>(
        connection,
        `WITH filtered_tracks AS (
           SELECT
             ${monsterKeySql} AS monster_key,
             monster_name,
             monster_name_norm,
             timestamp_ms
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${allTimeWhereSql}
             AND ${normalizedActionSql} = ?
             AND timestamp_ms >= ?
         ),
         monster_counts AS (
           SELECT
             monster_key,
             SUM(CASE WHEN timestamp_ms >= ? THEN 1 ELSE 0 END) AS current_count,
             SUM(CASE WHEN timestamp_ms < ? THEN 1 ELSE 0 END) AS previous_count
           FROM filtered_tracks
           GROUP BY monster_key
         ),
         monster_latest_names AS (
           SELECT
             monster_key,
             monster_name,
             monster_name_norm
           FROM (
             SELECT
               monster_key,
               monster_name,
               monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY monster_key
                 ORDER BY timestamp_ms DESC, monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_tracks
           )
           WHERE latest_rank = 1
         )
         SELECT
           monster_latest_names.monster_name AS monster_name,
           monster_counts.current_count AS current_count,
           monster_counts.previous_count AS previous_count
         FROM monster_counts
         INNER JOIN monster_latest_names
           ON monster_latest_names.monster_key = monster_counts.monster_key
         WHERE monster_counts.current_count > 0
            OR monster_counts.previous_count > 0
         ORDER BY
           ABS(monster_counts.current_count - monster_counts.previous_count) DESC,
           monster_counts.current_count DESC,
           monster_latest_names.monster_name_norm ASC
         LIMIT ?`,
        [
          ...allTimeWhereParameters,
          TRACKED_MONSTER_ACTION_NORM,
          previousMomentumWindowStartMs,
          currentMomentumWindowStartMs,
          currentMomentumWindowStartMs,
          STATS_MOMENTUM_ROW_LIMIT,
        ],
      );
      const hourOfWeekHeatmapRows =
        await readDuckDbRows<HourOfWeekHeatmapRow>(
          connection,
          `SELECT
             CAST(
               strftime(strptime(day_key_local, '%Y-%m-%d'), '%w')
               AS INTEGER
             ) AS day_of_week,
             CAST(
               substr(
                 coalesce(hour_key_local, day_key_local || ' 00:00'),
                 12,
                 2
               ) AS INTEGER
             ) AS hour_of_day,
             COUNT(*) AS tracked_count
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeTrackedWhereSql}
           GROUP BY day_of_week, hour_of_day
           ORDER BY day_of_week ASC, hour_of_day ASC`,
          rangeTrackedWhereParameters,
        );
      const monsterHandoffRows = await readDuckDbRows<MonsterHandoffRateRow>(
        connection,
        `WITH filtered_tracks AS (
           SELECT
             ${monsterKeySql} AS monster_key,
             monster_name,
             monster_name_norm,
             timestamp_ms,
             history_id,
             nullif(trim(tracked_by_uid), '') AS tracker_uid
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeTrackedWhereSql}
         ),
         monster_latest_names AS (
           SELECT
             monster_key,
             monster_name,
             monster_name_norm
           FROM (
             SELECT
               monster_key,
               monster_name,
               monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY monster_key
                 ORDER BY timestamp_ms DESC, monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_tracks
           ) AS ranked_names
           WHERE ranked_names.latest_rank = 1
         ),
         ordered_tracks AS (
           SELECT
             monster_key,
             tracker_uid,
             LAG(tracker_uid) OVER (
               PARTITION BY monster_key
               ORDER BY timestamp_ms ASC, history_id ASC
             ) AS previous_tracker_uid
           FROM filtered_tracks
         ),
         handoff_counts AS (
           SELECT
             monster_key,
             SUM(
               CASE
                 WHEN previous_tracker_uid IS NOT NULL
                  AND tracker_uid IS NOT NULL
                 THEN 1
                 ELSE 0
               END
             ) AS comparable_transition_count,
             SUM(
               CASE
                 WHEN previous_tracker_uid IS NOT NULL
                  AND tracker_uid IS NOT NULL
                  AND previous_tracker_uid <> tracker_uid
                 THEN 1
                 ELSE 0
               END
             ) AS handoff_count
           FROM ordered_tracks
           GROUP BY monster_key
         )
         SELECT
           monster_latest_names.monster_name AS monster_name,
           handoff_counts.handoff_count AS handoff_count,
           handoff_counts.comparable_transition_count AS comparable_transition_count
         FROM handoff_counts
         INNER JOIN monster_latest_names
           ON monster_latest_names.monster_key = handoff_counts.monster_key
         WHERE handoff_counts.comparable_transition_count > 0
         ORDER BY
           handoff_counts.comparable_transition_count DESC,
           handoff_counts.handoff_count DESC,
           monster_latest_names.monster_name_norm ASC
         LIMIT ?`,
        [...rangeTrackedWhereParameters, STATS_HANDOFF_ROW_LIMIT],
      );
      const topMonsterTrackedRows = await readDuckDbRows<UserTopMonsterRow>(
        connection,
        `WITH filtered_tracks AS (
           SELECT
             coalesce(tracked_by_uid, 'name:' || lower(tracked_by_nickname)) AS person_key,
             tracked_by_uid,
             tracked_by_nickname,
             ${monsterKeySql} AS monster_key,
             monster_name,
             monster_name_norm,
             timestamp_ms
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeTrackedWhereSql}
         ),
         users_by_key AS (
           SELECT
             person_key,
             min(tracked_by_uid) AS person_id,
             min(tracked_by_nickname) AS person_name
           FROM filtered_tracks
           GROUP BY person_key
         ),
         tracks_by_user_monster AS (
           SELECT
             person_key,
             monster_key,
             COUNT(*) AS track_count
           FROM filtered_tracks
           GROUP BY person_key, monster_key
         ),
         user_monster_latest_names AS (
           SELECT
             person_key,
             monster_key,
             monster_name,
             monster_name_norm
           FROM (
             SELECT
               person_key,
               monster_key,
               monster_name,
               monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY person_key, monster_key
                 ORDER BY timestamp_ms DESC, monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_tracks
           )
           WHERE latest_rank = 1
         ),
         ranked AS (
           SELECT
             tracks_by_user_monster.person_key,
             users_by_key.person_id AS person_id,
             users_by_key.person_name AS person_name,
             user_monster_latest_names.monster_name AS monster_name,
             tracks_by_user_monster.track_count AS track_count,
             ROW_NUMBER() OVER (
               PARTITION BY tracks_by_user_monster.person_key
               ORDER BY tracks_by_user_monster.track_count DESC, user_monster_latest_names.monster_name_norm ASC
             ) AS rank_in_user
           FROM tracks_by_user_monster
           INNER JOIN users_by_key
             ON users_by_key.person_key = tracks_by_user_monster.person_key
           INNER JOIN user_monster_latest_names
             ON user_monster_latest_names.person_key = tracks_by_user_monster.person_key
            AND user_monster_latest_names.monster_key = tracks_by_user_monster.monster_key
         )
         SELECT
           person_id,
           person_name,
           monster_name,
           track_count
         FROM ranked
         WHERE rank_in_user = 1
         ORDER BY track_count DESC, lower(person_name) ASC, lower(monster_name) ASC`,
        rangeTrackedWhereParameters,
      );
      const mostTracksInDayRows = await readDuckDbRows<UserMostTracksInDayRow>(
        connection,
        `WITH filtered_tracks AS (
           SELECT
             coalesce(tracked_by_uid, 'name:' || lower(tracked_by_nickname)) AS person_key,
             tracked_by_uid,
             tracked_by_nickname,
             day_key_local
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeTrackedWhereSql}
             AND day_key_local IS NOT NULL
         ),
         users_by_key AS (
           SELECT
             person_key,
             min(tracked_by_uid) AS person_id,
             min(tracked_by_nickname) AS person_name
           FROM filtered_tracks
           GROUP BY person_key
         ),
         tracks_by_user_day AS (
           SELECT
             person_key,
             day_key_local,
             COUNT(*) AS track_count
           FROM filtered_tracks
           GROUP BY person_key, day_key_local
         ),
         ranked AS (
           SELECT
             tracks_by_user_day.person_key,
             users_by_key.person_id AS person_id,
             users_by_key.person_name AS person_name,
             tracks_by_user_day.day_key_local AS day_key_local,
             tracks_by_user_day.track_count AS track_count,
             ROW_NUMBER() OVER (
               PARTITION BY tracks_by_user_day.person_key
               ORDER BY tracks_by_user_day.track_count DESC, tracks_by_user_day.day_key_local DESC
             ) AS rank_in_user
           FROM tracks_by_user_day
           INNER JOIN users_by_key
             ON users_by_key.person_key = tracks_by_user_day.person_key
         )
         SELECT
           person_id,
           person_name,
           day_key_local,
           track_count
         FROM ranked
         WHERE rank_in_user = 1
         ORDER BY track_count DESC, day_key_local DESC, lower(person_name) ASC`,
        rangeTrackedWhereParameters,
      );
      const longestStreakRows = await readDuckDbRows<UserLongestStreakRow>(
        connection,
        `WITH filtered_tracks AS (
           SELECT
             tracked_by_uid,
             tracked_by_nickname,
             hour_key_local
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeTrackedWhereSql}
         ),
         users_by_key AS (
           SELECT
             coalesce(tracked_by_uid, 'name:' || lower(tracked_by_nickname)) AS person_key,
             min(tracked_by_uid) AS person_id,
             min(tracked_by_nickname) AS person_name
           FROM filtered_tracks
           GROUP BY person_key
         ),
         hourly_activity AS (
           SELECT
             coalesce(tracked_by_uid, 'name:' || lower(tracked_by_nickname)) AS person_key,
             hour_key_local
           FROM filtered_tracks
           WHERE hour_key_local IS NOT NULL
           GROUP BY person_key, hour_key_local
         ),
         hourly_indexed AS (
           SELECT
             person_key,
             DATE_DIFF(
               'hour',
               TIMESTAMP '1970-01-01 00:00:00',
               STRPTIME(hour_key_local, '%Y-%m-%d %H:%M')
             ) AS hour_index,
             ROW_NUMBER() OVER (PARTITION BY person_key ORDER BY hour_key_local ASC) AS hour_seq
           FROM hourly_activity
         ),
         streak_grouped AS (
           SELECT
             person_key,
             hour_index - hour_seq AS streak_group
           FROM hourly_indexed
         ),
         streak_lengths AS (
           SELECT
             person_key,
             COUNT(*) AS streak_hours
           FROM streak_grouped
           GROUP BY person_key, streak_group
         ),
         longest_streaks AS (
           SELECT
             person_key,
             MAX(streak_hours) AS streak_hours
           FROM streak_lengths
           GROUP BY person_key
         )
         SELECT
           users_by_key.person_id AS person_id,
           users_by_key.person_name AS person_name,
           longest_streaks.streak_hours AS streak_hours
         FROM longest_streaks
         INNER JOIN users_by_key
           ON users_by_key.person_key = longest_streaks.person_key
         ORDER BY longest_streaks.streak_hours DESC, lower(users_by_key.person_name) ASC`,
        rangeTrackedWhereParameters,
      );
      const additionalUserStatsRows =
        await readDuckDbRows<AdditionalUserStatsRow>(
          connection,
          `WITH filtered_rows AS (
           SELECT
             coalesce(tracked_by_uid, 'name:' || lower(tracked_by_nickname)) AS person_key,
             tracked_by_uid AS person_id,
             tracked_by_nickname AS person_name,
             ${normalizedActionSql} AS action_norm,
             ${monsterKeySql} AS monster_key,
             timestamp_ms,
             monster_name,
             monster_name_norm
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeWhereSql}
         ),
         users_base AS (
           SELECT
             person_key,
             min(person_id) AS person_id,
             min(person_name) AS person_name
           FROM filtered_rows
           GROUP BY person_key
         ),
         least_favorite_candidates AS (
           SELECT
             person_key,
             monster_key,
             COUNT(*) AS track_count
           FROM filtered_rows
           WHERE action_norm = ?
           GROUP BY person_key, monster_key
         ),
         least_favorite_names AS (
           SELECT
             ranked_names.person_key,
             ranked_names.monster_key,
             ranked_names.monster_name,
             ranked_names.monster_name_norm
           FROM (
             SELECT
               filtered_rows.person_key,
               filtered_rows.monster_key,
               filtered_rows.monster_name,
               filtered_rows.monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY filtered_rows.person_key, filtered_rows.monster_key
                 ORDER BY filtered_rows.timestamp_ms DESC, filtered_rows.monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_rows
             INNER JOIN least_favorite_candidates
               ON least_favorite_candidates.person_key = filtered_rows.person_key
              AND least_favorite_candidates.monster_key = filtered_rows.monster_key
           ) AS ranked_names
           WHERE ranked_names.latest_rank = 1
         ),
         least_favorite AS (
           SELECT
             least_favorite_candidates.person_key,
             least_favorite_names.monster_name AS monster_name,
             least_favorite_candidates.track_count AS track_count,
             ROW_NUMBER() OVER (
               PARTITION BY least_favorite_candidates.person_key
               ORDER BY least_favorite_candidates.track_count ASC, least_favorite_names.monster_name_norm ASC
             ) AS rank_in_user
           FROM least_favorite_candidates
           INNER JOIN least_favorite_names
             ON least_favorite_names.person_key = least_favorite_candidates.person_key
            AND least_favorite_names.monster_key = least_favorite_candidates.monster_key
         ),
        action_counts AS (
          SELECT
            person_key,
            SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS set_exact_count,
            SUM(CASE WHEN action_norm IN (?, ?, ?, ?) THEN 1 ELSE 0 END) AS edit_count,
            SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS times_reset_count
          FROM filtered_rows
          GROUP BY person_key
        )
         SELECT
           users_base.person_id AS person_id,
           users_base.person_name AS person_name,
           least_favorite.monster_name AS least_favorite_monster,
           least_favorite.track_count AS least_favorite_count,
           coalesce(action_counts.set_exact_count, 0) AS set_exact_count,
           coalesce(action_counts.edit_count, 0) AS edit_count,
           coalesce(action_counts.times_reset_count, 0) AS times_reset_count
         FROM users_base
         LEFT JOIN least_favorite
           ON least_favorite.person_key = users_base.person_key
          AND least_favorite.rank_in_user = 1
         LEFT JOIN action_counts
           ON action_counts.person_key = users_base.person_key
         ORDER BY lower(users_base.person_name) ASC`,
          [
            ...rangeWhereParameters,
            TRACKED_MONSTER_ACTION_NORM,
            SET_EXACT_SPAWN_ACTION_NORM,
            EDIT_OFFSET_ACTION_NORM,
            EDIT_LAST_KILLED_ACTION_NORM,
            EDIT_MONSTER_DETAIL_ACTION_NORM,
            EDIT_MONSTER_DETAILS_ACTION_NORM,
            RESET_ALL_TIMERS_ACTION_NORM,
          ],
        );
      const perMonsterStatsRows = await readDuckDbRows<MonsterStatsRow>(
        connection,
        `WITH filtered_rows AS (
           SELECT
             ${monsterKeySql} AS monster_key,
           monster_name,
           monster_name_norm,
           timestamp_ms,
            ${normalizedActionSql} AS action_norm
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeWhereSql}
             AND ${normalizedActionSql} IN (?, ?, ?)
         ),
         monsters_by_key AS (
           SELECT
             monster_key,
             SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS tracked_count,
             SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS edit_offset_count,
             SUM(CASE WHEN action_norm = ? THEN 1 ELSE 0 END) AS set_exact_count
           FROM filtered_rows
           GROUP BY monster_key
         ),
         monster_latest_names AS (
           SELECT
             monster_key,
             monster_name,
             monster_name_norm
           FROM (
             SELECT
               monster_key,
               monster_name,
               monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY monster_key
                 ORDER BY timestamp_ms DESC, monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_rows
           ) AS ranked_names
           WHERE ranked_names.latest_rank = 1
        )
        SELECT
          monsters_by_key.monster_key AS monster_key,
          monster_latest_names.monster_name AS monster_name,
           monsters_by_key.tracked_count AS tracked_count,
           monsters_by_key.edit_offset_count AS edit_offset_count,
           monsters_by_key.set_exact_count AS set_exact_count
         FROM monsters_by_key
         INNER JOIN monster_latest_names
           ON monster_latest_names.monster_key = monsters_by_key.monster_key
         ORDER BY monster_latest_names.monster_name_norm ASC`,
        [
          ...rangeWhereParameters,
          TRACKED_MONSTER_ACTION_NORM,
          EDIT_OFFSET_ACTION_NORM,
          SET_EXACT_SPAWN_ACTION_NORM,
          TRACKED_MONSTER_ACTION_NORM,
          EDIT_OFFSET_ACTION_NORM,
          SET_EXACT_SPAWN_ACTION_NORM,
        ],
      );
      const monsterTrackedByRows = await readDuckDbRows<MonsterTrackedByUserRow>(
        connection,
        `WITH filtered_rows AS (
           SELECT
             ${monsterKeySql} AS monster_key,
             monster_name,
             monster_name_norm,
             timestamp_ms,
             ${normalizedActionSql} AS action_norm,
             coalesce(tracked_by_uid, 'name:' || lower(tracked_by_nickname)) AS person_key,
             tracked_by_uid AS person_id,
             tracked_by_nickname AS person_name
           FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           WHERE ${rangeWhereSql}
             AND ${normalizedActionSql} = ?
         ),
         monster_latest_names AS (
           SELECT
             monster_key,
             monster_name,
             monster_name_norm
           FROM (
             SELECT
               monster_key,
               monster_name,
               monster_name_norm,
               ROW_NUMBER() OVER (
                 PARTITION BY monster_key
                 ORDER BY timestamp_ms DESC, monster_name_norm ASC
               ) AS latest_rank
             FROM filtered_rows
           ) AS ranked_names
           WHERE ranked_names.latest_rank = 1
         ),
         tracked_by_user AS (
           SELECT
             monster_key,
             person_key,
             min(person_id) AS person_id,
             min(person_name) AS person_name,
             COUNT(*) AS tracked_count
           FROM filtered_rows
           GROUP BY monster_key, person_key
         )
         SELECT
           tracked_by_user.monster_key AS monster_key,
           monster_latest_names.monster_name AS monster_name,
           tracked_by_user.person_id AS person_id,
           tracked_by_user.person_name AS person_name,
           tracked_by_user.tracked_count AS tracked_count
         FROM tracked_by_user
         INNER JOIN monster_latest_names
           ON monster_latest_names.monster_key = tracked_by_user.monster_key
         ORDER BY monster_latest_names.monster_name_norm ASC, tracked_by_user.tracked_count DESC, lower(tracked_by_user.person_name) ASC`,
        [...rangeWhereParameters, TRACKED_MONSTER_ACTION_NORM],
      );

      const totalTracksAllTime = normalizeTrackCount(
        allTimeCountRows[0]?.track_count,
      );
      const mostActiveMonsterNameRaw = mostActiveMonsterRows[0]?.monster_name;
      const mostActiveMonsterName =
        typeof mostActiveMonsterNameRaw === "string"
          ? mostActiveMonsterNameRaw.trim()
          : "";
      const mostActiveMonsterCount = normalizeTrackCount(
        mostActiveMonsterRows[0]?.track_count,
      );

      const normalizedContributionRows = contributionRows
        .map((row) => {
          const bucket =
            typeof row.bucket_key_local === "string"
              ? row.bucket_key_local.trim()
              : "";
          const personName =
            typeof row.person_name === "string" && row.person_name.trim()
              ? row.person_name.trim()
              : "Unknown User";
          const personId =
            typeof row.person_id === "string" && row.person_id.trim()
              ? row.person_id.trim()
              : null;
          const contribution = normalizeTrackCount(row.contribution_sum);
          const isValidBucket =
            distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
              ? /^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(bucket)
              : /^\d{4}-\d{2}-\d{2}$/.test(bucket);
          if (!isValidBucket || contribution <= 0) {
            return null;
          }
          return {
            bucket,
            personId,
            personName,
            contribution,
          };
        })
        .filter(
          (
            row,
          ): row is {
            bucket: string;
            personId: string | null;
            personName: string;
            contribution: number;
          } => row !== null,
        );

      const earliestTrackedBucketKey =
        normalizedContributionRows[0]?.bucket ?? null;
      const defaultStartBucketTimestampMs =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? floorToLocalHourTimestampMs(nowTimestampMs)
          : floorToLocalDayTimestampMs(nowTimestampMs);
      const requestedStartBucketTimestampMs =
        normalizedRangeStartMs !== null
          ? distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
            ? floorToLocalHourTimestampMs(normalizedRangeStartMs)
            : floorToLocalDayTimestampMs(normalizedRangeStartMs)
          : earliestTrackedBucketKey
            ? distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
              ? (parseLocalHourKeyToTimestampMs(earliestTrackedBucketKey) ??
                defaultStartBucketTimestampMs)
              : (parseLocalDayKeyToTimestampMs(earliestTrackedBucketKey) ??
                defaultStartBucketTimestampMs)
            : defaultStartBucketTimestampMs;
      const contiguousBuckets =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? buildContiguousHourKeys(
              requestedStartBucketTimestampMs,
              nowTimestampMs,
            )
          : buildContiguousDayKeys(
              requestedStartBucketTimestampMs,
              nowTimestampMs,
            );
      const fallbackBucketKey =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? getLocalHourKeyFromTimestampMs(nowTimestampMs)
          : getLocalDayKeyFromTimestampMs(nowTimestampMs);
      const days =
        contiguousBuckets.length > 0 ? contiguousBuckets : [fallbackBucketKey];
      const dayIndexes = new Map<string, number>();
      for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
        dayIndexes.set(days[dayIndex], dayIndex);
      }

      const totalsPerDay = new Array<number>(days.length).fill(0);
      const seriesByPerson = new Map<string, StatsDistributionSeries>();
      for (const row of normalizedContributionRows) {
        const dayIndex = dayIndexes.get(row.bucket);
        if (dayIndex === undefined) {
          continue;
        }

        const personKey = row.personId
          ? `uid:${row.personId}`
          : `name:${row.personName.toLowerCase()}`;
        let personSeries = seriesByPerson.get(personKey);
        if (!personSeries) {
          personSeries = {
            personId: row.personId,
            personName: row.personName,
            values: new Array<number>(days.length).fill(0),
            total: 0,
          };
          seriesByPerson.set(personKey, personSeries);
        }

        personSeries.values[dayIndex] += row.contribution;
        personSeries.total += row.contribution;
        totalsPerDay[dayIndex] += row.contribution;
      }

      const sortedSeries = Array.from(seriesByPerson.values())
        .filter((entry) => entry.total > 0)
        .sort(
          (left, right) =>
            right.total - left.total ||
            left.personName.localeCompare(right.personName),
        );
      const totalTracksRange = totalsPerDay.reduce(
        (sum, value) => sum + value,
        0,
      );
      const totalAllDays = totalTracksRange;
      const maxDayTotal =
        totalsPerDay.length > 0 ? Math.max(...totalsPerDay) : 0;
      const daysRecorded = totalsPerDay.reduce(
        (count, value) => count + (value > 0 ? 1 : 0),
        0,
      );
      const avgPerDay = normalizeAverageValue(
        days.length > 0 ? totalAllDays / days.length : 0,
      );

      const distribution: StatsDistributionData = {
        days,
        series: sortedSeries,
        totalsPerDay,
        summary: {
          totalAllDays,
          avgPerDay,
          maxDayTotal,
          activeUsers: sortedSeries.length,
          daysRecorded,
        },
      };

      const tracksPerDay = includeTracksPerDay
        ? days
            .map((day, dayIndex) => ({
              day,
              count: totalsPerDay[dayIndex] ?? 0,
            }))
            .filter((entry) => entry.count > 0)
            .reverse()
        : [];
      const leaderboard = sortedSeries
        .slice(0, STATS_USER_RANKING_LIMIT)
        .map((entry) => ({
          uid: entry.personId,
          nickname: entry.personName,
          count: entry.total,
          sharePercent:
            totalTracksRange > 0
              ? normalizeAverageValue((entry.total / totalTracksRange) * 100)
              : 0,
        }));
      const topUsers = leaderboard.map((entry) => ({
        uid: entry.uid,
        nickname: entry.nickname,
        count: entry.count,
      }));
      const mostTracksInDay = mostTracksInDayRows
        .map((row) => {
          const nickname =
            typeof row.person_name === "string" && row.person_name.trim()
              ? row.person_name.trim()
              : "Unknown User";
          const uid =
            typeof row.person_id === "string" && row.person_id.trim()
              ? row.person_id.trim()
              : null;
          const day =
            typeof row.day_key_local === "string" ? row.day_key_local.trim() : "";
          const count = normalizeTrackCount(row.track_count);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || count <= 0) {
            return null;
          }
          return {
            uid,
            nickname,
            day,
            count,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            uid: string | null;
            nickname: string;
            day: string;
            count: number;
          } => entry !== null,
        );
      const topMonsterTracked = topMonsterTrackedRows
        .map((row) => {
          const nickname =
            typeof row.person_name === "string" && row.person_name.trim()
              ? row.person_name.trim()
              : "Unknown User";
          const uid =
            typeof row.person_id === "string" && row.person_id.trim()
              ? row.person_id.trim()
              : null;
          const monsterName =
            typeof row.monster_name === "string" && row.monster_name.trim()
              ? row.monster_name.trim()
              : "";
          const count = normalizeTrackCount(row.track_count);
          if (!monsterName || count <= 0) {
            return null;
          }
          return {
            uid,
            nickname,
            monsterName,
            count,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            uid: string | null;
            nickname: string;
            monsterName: string;
            count: number;
          } => entry !== null,
        );
      const longestStreakHours = longestStreakRows
        .map((row) => {
          const nickname =
            typeof row.person_name === "string" && row.person_name.trim()
              ? row.person_name.trim()
              : "Unknown User";
          const uid =
            typeof row.person_id === "string" && row.person_id.trim()
              ? row.person_id.trim()
              : null;
          const hours = normalizeTrackCount(row.streak_hours);
          if (hours <= 0) {
            return null;
          }
          return {
            uid,
            nickname,
            hours,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            uid: string | null;
            nickname: string;
            hours: number;
          } => entry !== null,
        );
      const additionalStats = additionalUserStatsRows
        .map((row) => {
          const nickname =
            typeof row.person_name === "string" && row.person_name.trim()
              ? row.person_name.trim()
              : "Unknown User";
          const uid =
            typeof row.person_id === "string" && row.person_id.trim()
              ? row.person_id.trim()
              : null;
          const leastFavoriteMonsterName =
            typeof row.least_favorite_monster === "string" &&
            row.least_favorite_monster.trim()
              ? row.least_favorite_monster.trim()
              : "";
          const leastFavoriteMonsterCount = normalizeTrackCount(
            row.least_favorite_count,
          );
          return {
            uid,
            nickname,
            leastFavoriteMonster:
              leastFavoriteMonsterName && leastFavoriteMonsterCount > 0
                ? {
                    name: leastFavoriteMonsterName,
                    count: leastFavoriteMonsterCount,
                  }
                : null,
            setExacts: normalizeTrackCount(row.set_exact_count),
            editsDone: normalizeTrackCount(row.edit_count),
            timesReset: normalizeTrackCount(row.times_reset_count),
          };
        })
        .sort((left, right) => left.nickname.localeCompare(right.nickname));
      const trackedByUsersByMonsterKey = new Map<
        string,
        Array<{
          uid: string | null;
          nickname: string;
          count: number;
        }>
      >();
      for (const row of monsterTrackedByRows) {
        const monsterKey =
          typeof row.monster_key === "string" && row.monster_key.trim()
            ? row.monster_key.trim()
            : "";
        if (!monsterKey) {
          continue;
        }
        const nickname =
          typeof row.person_name === "string" && row.person_name.trim()
            ? row.person_name.trim()
            : "Unknown User";
        const uid =
          typeof row.person_id === "string" && row.person_id.trim()
            ? row.person_id.trim()
            : null;
        const count = normalizeTrackCount(row.tracked_count);
        if (count <= 0) {
          continue;
        }
        const list = trackedByUsersByMonsterKey.get(monsterKey);
        const next = {
          uid,
          nickname,
          count,
        };
        if (!list) {
          trackedByUsersByMonsterKey.set(monsterKey, [next]);
          continue;
        }
        list.push(next);
      }
      const perMonster = perMonsterStatsRows
        .map((row) => {
          const monsterKey =
            typeof row.monster_key === "string" && row.monster_key.trim()
              ? row.monster_key.trim()
              : "";
          const monsterName =
            typeof row.monster_name === "string" && row.monster_name.trim()
              ? row.monster_name.trim()
              : "";
          if (!monsterName || !monsterKey) {
            return null;
          }
          const trackedCount = normalizeTrackCount(row.tracked_count);
          const editOffsetCount = normalizeTrackCount(row.edit_offset_count);
          const setExactCount = normalizeTrackCount(row.set_exact_count);
          const trackedByUsers = trackedByUsersByMonsterKey.get(monsterKey) ?? [];
          const maxTrackedCount = trackedByUsers.reduce(
            (highest, entry) => (entry.count > highest ? entry.count : highest),
            0,
          );
          const minTrackedCount = trackedByUsers.reduce(
            (lowest, entry) => (entry.count < lowest ? entry.count : lowest),
            Number.POSITIVE_INFINITY,
          );
          const mostKilledBy =
            maxTrackedCount > 0
              ? trackedByUsers
                  .filter((entry) => entry.count === maxTrackedCount)
                  .sort((left, right) => left.nickname.localeCompare(right.nickname))
              : [];
          const leastKilledBy =
            Number.isFinite(minTrackedCount)
              ? trackedByUsers
                  .filter((entry) => entry.count === minTrackedCount)
                  .sort((left, right) => left.nickname.localeCompare(right.nickname))
              : [];
          return {
            monsterName,
            trackedCount,
            editOffsetCount,
            setExactCount,
            mostKilledBy,
            leastKilledBy,
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            monsterName: string;
            trackedCount: number;
            editOffsetCount: number;
            setExactCount: number;
            mostKilledBy: Array<{
              uid: string | null;
              nickname: string;
              count: number;
            }>;
            leastKilledBy: Array<{
              uid: string | null;
              nickname: string;
              count: number;
            }>;
          } => entry !== null,
        );
      const normalizedTimeTrendRows = timeTrendBucketRows
        .map((row) => {
          const bucket =
            typeof row.bucket_key_local === "string"
              ? row.bucket_key_local.trim()
              : "";
          const isValidBucket =
            distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
              ? /^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(bucket)
              : /^\d{4}-\d{2}-\d{2}$/.test(bucket);
          if (!isValidBucket) {
            return null;
          }
          return {
            bucket,
            trackedCount: normalizeTrackCount(row.tracked_count),
            activeTrackerCount: normalizeTrackCount(row.active_tracker_count),
            editOffsetCount: normalizeTrackCount(row.edit_offset_count),
            setExactCount: normalizeTrackCount(row.set_exact_count),
            editLastKilledCount: normalizeTrackCount(
              row.edit_last_killed_count,
            ),
            resetAllTimersCount: normalizeTrackCount(
              row.reset_all_timers_count,
            ),
          };
        })
        .filter(
          (
            row,
          ): row is {
            bucket: string;
            trackedCount: number;
            activeTrackerCount: number;
            editOffsetCount: number;
            setExactCount: number;
            editLastKilledCount: number;
            resetAllTimersCount: number;
          } => row !== null,
        );
      const trendRowsByBucket = new Map<
        string,
        {
          trackedCount: number;
          activeTrackerCount: number;
          editOffsetCount: number;
          setExactCount: number;
          editLastKilledCount: number;
          resetAllTimersCount: number;
        }
      >();
      for (const row of normalizedTimeTrendRows) {
        trendRowsByBucket.set(row.bucket, {
          trackedCount: row.trackedCount,
          activeTrackerCount: row.activeTrackerCount,
          editOffsetCount: row.editOffsetCount,
          setExactCount: row.setExactCount,
          editLastKilledCount: row.editLastKilledCount,
          resetAllTimersCount: row.resetAllTimersCount,
        });
      }
      const trendSourceBuckets =
        contiguousBuckets.length > 0 ? contiguousBuckets : [fallbackBucketKey];
      const trendBucketsWindow =
        trendSourceBuckets.length > STATS_TREND_MAX_BUCKETS
          ? trendSourceBuckets.slice(-STATS_TREND_MAX_BUCKETS)
          : trendSourceBuckets;
      const trendMovingAverageWindowSize =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR ? 6 : 7;
      const trendTrackedCounts = trendBucketsWindow.map((bucket) => {
        return trendRowsByBucket.get(bucket)?.trackedCount ?? 0;
      });
      const timeTrendBuckets = trendBucketsWindow.map((bucket, bucketIndex) => {
        const row = trendRowsByBucket.get(bucket);
        const trackedCount = row?.trackedCount ?? 0;
        const editOffsetCount = row?.editOffsetCount ?? 0;
        const setExactCount = row?.setExactCount ?? 0;
        const editLastKilledCount = row?.editLastKilledCount ?? 0;
        const startIndex = Math.max(
          0,
          bucketIndex - trendMovingAverageWindowSize + 1,
        );
        let trackedMovingAverageSum = 0;
        for (
          let rollingIndex = startIndex;
          rollingIndex <= bucketIndex;
          rollingIndex += 1
        ) {
          trackedMovingAverageSum += trendTrackedCounts[rollingIndex] ?? 0;
        }
        const trackedMovingAverage = normalizeAverageValue(
          trackedMovingAverageSum / (bucketIndex - startIndex + 1),
        );
        const correctionRatePercent =
          trackedCount > 0
            ? normalizeAverageValue(
                ((editOffsetCount + setExactCount + editLastKilledCount) /
                  trackedCount) *
                  100,
              )
            : 0;
        return {
          bucket,
          trackedCount,
          trackedMovingAverage,
          activeTrackerCount: row?.activeTrackerCount ?? 0,
          editOffsetCount,
          setExactCount,
          editLastKilledCount,
          resetAllTimersCount: row?.resetAllTimersCount ?? 0,
          correctionRatePercent,
        };
      });
      const monsterMomentum = monsterMomentumRows
        .map((row) => {
          const monsterName =
            typeof row.monster_name === "string" && row.monster_name.trim()
              ? row.monster_name.trim()
              : "";
          if (!monsterName) {
            return null;
          }
          const currentTracks = normalizeTrackCount(row.current_count);
          const previousTracks = normalizeTrackCount(row.previous_count);
          const delta = currentTracks - previousTracks;
          return {
            monsterName,
            currentTracks,
            previousTracks,
            delta,
            deltaPercent:
              previousTracks > 0
                ? normalizeSignedAverageValue((delta / previousTracks) * 100)
                : null,
          };
        })
        .filter(
          (
            row,
          ): row is {
            monsterName: string;
            currentTracks: number;
            previousTracks: number;
            delta: number;
            deltaPercent: number | null;
          } => row !== null,
        );
      const hourOfWeekHeatmap = hourOfWeekHeatmapRows
        .map((row) => {
          const dayOfWeek = normalizeTrackCount(row.day_of_week);
          const hourOfDay = normalizeTrackCount(row.hour_of_day);
          const trackedCount = normalizeTrackCount(row.tracked_count);
          if (dayOfWeek > 6 || hourOfDay > 23 || trackedCount <= 0) {
            return null;
          }
          return {
            dayOfWeek,
            hourOfDay,
            trackedCount,
          };
        })
        .filter(
          (
            row,
          ): row is {
            dayOfWeek: number;
            hourOfDay: number;
            trackedCount: number;
          } => row !== null,
        );
      const handoffRates = monsterHandoffRows
        .map((row) => {
          const monsterName =
            typeof row.monster_name === "string" && row.monster_name.trim()
              ? row.monster_name.trim()
              : "";
          if (!monsterName) {
            return null;
          }
          const handoffCount = normalizeTrackCount(row.handoff_count);
          const comparableTransitions = normalizeTrackCount(
            row.comparable_transition_count,
          );
          if (comparableTransitions <= 0) {
            return null;
          }
          return {
            monsterName,
            handoffCount,
            comparableTransitions,
            handoffRatePercent: normalizeAverageValue(
              (handoffCount / comparableTransitions) * 100,
            ),
          };
        })
        .filter(
          (
            row,
          ): row is {
            monsterName: string;
            handoffCount: number;
            comparableTransitions: number;
            handoffRatePercent: number;
          } => row !== null,
        );

      return {
        totalTracksRange,
        totalTracksAllTime,
        mostActiveMonster:
          mostActiveMonsterName && mostActiveMonsterCount > 0
            ? {
                name: mostActiveMonsterName,
                count: mostActiveMonsterCount,
              }
            : null,
        tracksPerDay,
        topUsers,
        users: {
          leaderboard,
          mostTracksInDay,
          topMonsterTracked,
          longestStreakHours,
          additionalStats,
        },
        monsters: {
          perMonster,
        },
        distribution,
        timeTrends: {
          bucketInterval: distributionInterval,
          buckets: timeTrendBuckets,
          monsterMomentum,
          hourOfWeekHeatmap,
          handoffRates,
        },
      };
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to query stats overview from DuckDB.", error);
    return buildEmptyStatsOverviewResult();
  }
}

export async function closeHistoryLocalCacheDuckDb(): Promise<void> {
  if (!cachedDatabasePromise) {
    return;
  }

  try {
    const database = await cachedDatabasePromise;
    await closeDuckDbDatabase(database);
  } catch {
    // Ignore close failures on shutdown.
  } finally {
    cachedDatabasePromise = null;
    syncedHistoryTrackIdsByUserUid.clear();
    pendingHistoryAnalyticsSyncPromisesByUserUid.clear();
  }
}
