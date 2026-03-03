import { app } from "electron";
import path from "node:path";

const HISTORY_LOCAL_CACHE_DUCKDB_FILENAME = "mvp-tracker-local-cache.duckdb";
const HISTORY_LOCAL_CACHE_TABLE_NAME = "history_local_cache";
const HISTORY_ANALYTICS_TRACKS_TABLE_NAME = "history_analytics_tracks";
const TRACKED_MONSTER_ACTION = "Tracked Monster";
const STATS_USER_RANKING_LIMIT = 10;
const STATS_DISTRIBUTION_INTERVAL_DAY = "day";
const STATS_DISTRIBUTION_INTERVAL_HOUR = "hour";
type StatsDistributionInterval =
  | typeof STATS_DISTRIBUTION_INTERVAL_DAY
  | typeof STATS_DISTRIBUTION_INTERVAL_HOUR;

type HistoryAnalyticsTrackRow = {
  historyId: string;
  timestampMs: number;
  dayKeyLocal: string;
  hourKeyLocal: string;
  monsterName: string;
  monsterNameNorm: string;
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

type TopUserRow = {
  user_uid?: unknown;
  user_nickname?: unknown;
  track_count?: unknown;
};

type DailyContributionRow = {
  bucket_key_local?: unknown;
  person_id?: unknown;
  person_name?: unknown;
  contribution_sum?: unknown;
};

type AllTimeRangeCountRow = {
  track_count?: unknown;
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
  distribution: StatsDistributionData;
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

function loadDuckDbModule(): DuckDbModule {
  const requiredModule = require("duckdb");
  if (!requiredModule || typeof requiredModule.Database !== "function") {
    throw new Error("DuckDB module is unavailable.");
  }
  return requiredModule as DuckDbModule;
}

function runDuckDbStatement(connection: DuckDbConnection, sql: string, parameters: unknown[] = []): Promise<void> {
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
  parameters: unknown[] = []
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
  const parsed = new Date(`${hourKey.slice(0, 10)}T${hourKey.slice(11, 13)}:00:00`);
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

function buildContiguousDayKeys(startDayTimestampMs: number, endDayTimestampMs: number): string[] {
  if (!Number.isFinite(startDayTimestampMs) || !Number.isFinite(endDayTimestampMs)) {
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

function buildContiguousHourKeys(startHourTimestampMs: number, endHourTimestampMs: number): string[] {
  if (!Number.isFinite(startHourTimestampMs) || !Number.isFinite(endHourTimestampMs)) {
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

function buildEmptyStatsDistribution(nowTimestampMs = Date.now()): StatsDistributionData {
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
  return {
    totalTracksRange: 0,
    totalTracksAllTime: 0,
    mostActiveMonster: null,
    tracksPerDay: [],
    topUsers: [],
    distribution: buildEmptyStatsDistribution(),
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

function normalizeHistoryAnalyticsTrackRows(
  entries: unknown[],
  alreadySyncedHistoryIds?: ReadonlySet<string>
): HistoryAnalyticsTrackRow[] {
  const dedupedRowsById = new Map<string, HistoryAnalyticsTrackRow>();

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const data = entry as {
      id?: unknown;
      timestampIso?: unknown;
      action?: unknown;
      monsterName?: unknown;
      userUid?: unknown;
      userNickname?: unknown;
    };

    if (data.action !== TRACKED_MONSTER_ACTION) {
      continue;
    }

    const historyId = typeof data.id === "string" ? data.id.trim() : "";
    if (!historyId) {
      continue;
    }
    if (alreadySyncedHistoryIds?.has(historyId)) {
      continue;
    }

    const timestampIso = typeof data.timestampIso === "string" ? data.timestampIso : "";
    const timestampMs = Date.parse(timestampIso);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    const monsterName = typeof data.monsterName === "string" ? data.monsterName.trim() : "";
    if (!monsterName) {
      continue;
    }

    const userUid =
      typeof data.userUid === "string" && data.userUid.trim() ? data.userUid.trim() : null;
    const userNickname =
      typeof data.userNickname === "string" && data.userNickname.trim()
        ? data.userNickname.trim()
        : "Unknown User";

    dedupedRowsById.set(historyId, {
      historyId,
      timestampMs: Math.trunc(timestampMs),
      dayKeyLocal: getLocalDayKeyFromTimestampMs(timestampMs),
      hourKeyLocal: getLocalHourKeyFromTimestampMs(timestampMs),
      monsterName,
      monsterNameNorm: monsterName.toLowerCase(),
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
  return message.includes("duplicate key") || message.includes("conflict on tuple");
}

function isDuckDbColumnAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("already exists") || message.includes("duplicate column");
}

async function upsertHistoryAnalyticsTrackRows(
  connection: DuckDbConnection,
  normalizedUserUid: string,
  rows: HistoryAnalyticsTrackRow[]
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
          monster_name,
          monster_name_norm,
          tracked_by_uid,
          tracked_by_nickname
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        -- Concurrent writers can attempt the same key at the same time.
        ON CONFLICT (user_uid, history_id) DO UPDATE
        SET
          hour_key_local = excluded.hour_key_local,
          tracked_by_uid = excluded.tracked_by_uid,
          tracked_by_nickname = excluded.tracked_by_nickname`,
        [
          normalizedUserUid,
          row.historyId,
          row.timestampMs,
          row.dayKeyLocal,
          row.hourKeyLocal,
          row.monsterName,
          row.monsterNameNorm,
          row.userUid,
          row.userNickname,
        ]
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
  cache: unknown
): Promise<void> {
  const entries = normalizeHistoryLocalCacheEntries(cache);
  if (entries.length === 0) {
    return;
  }

  const alreadySyncedHistoryIds = syncedHistoryTrackIdsByUserUid.get(normalizedUserUid);
  const trackRows = normalizeHistoryAnalyticsTrackRows(entries, alreadySyncedHistoryIds);
  if (trackRows.length === 0) {
    return;
  }

  await upsertHistoryAnalyticsTrackRows(connection, normalizedUserUid, trackRows);
  const syncedIds = alreadySyncedHistoryIds ?? new Set<string>();
  for (const row of trackRows) {
    syncedIds.add(row.historyId);
  }
  syncedHistoryTrackIdsByUserUid.set(normalizedUserUid, syncedIds);
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
        .filter((name) => name.length > 0)
    )
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
      )`
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_local_cache_updated_at_idx
       ON ${HISTORY_LOCAL_CACHE_TABLE_NAME}(updated_at)`
    );
    await runDuckDbStatement(
      connection,
      `CREATE TABLE IF NOT EXISTS ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME} (
        user_uid VARCHAR NOT NULL,
        history_id VARCHAR NOT NULL,
        timestamp_ms BIGINT NOT NULL,
        day_key_local VARCHAR NOT NULL,
        hour_key_local VARCHAR,
        monster_name VARCHAR NOT NULL,
        monster_name_norm VARCHAR NOT NULL,
        tracked_by_uid VARCHAR,
        tracked_by_nickname VARCHAR NOT NULL,
        PRIMARY KEY (user_uid, history_id)
      )`
    );
    try {
      await runDuckDbStatement(
        connection,
        `ALTER TABLE ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         ADD COLUMN IF NOT EXISTS hour_key_local VARCHAR`
      );
    } catch {
      try {
        await runDuckDbStatement(
          connection,
          `ALTER TABLE ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
           ADD COLUMN hour_key_local VARCHAR`
        );
      } catch (fallbackError) {
        if (!isDuckDbColumnAlreadyExistsError(fallbackError)) {
          throw fallbackError;
        }
      }
    }
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_ts_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, timestamp_ms)`
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_monster_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, monster_name_norm)`
    );
    await runDuckDbStatement(
      connection,
      `CREATE INDEX IF NOT EXISTS history_analytics_tracks_user_day_idx
       ON ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}(user_uid, day_key_local)`
    );
  } finally {
    await closeDuckDbConnection(connection);
  }
}

async function getHistoryLocalCacheDatabase(): Promise<DuckDbDatabase> {
  if (!cachedDatabasePromise) {
    cachedDatabasePromise = (async () => {
      const duckDb = loadDuckDbModule();
      const databasePath = path.join(app.getPath("userData"), HISTORY_LOCAL_CACHE_DUCKDB_FILENAME);
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

export async function readHistoryLocalCacheFromDuckDb(userUid: string): Promise<unknown | null> {
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
        [normalizedUserUid]
      );
      const payloadJson = rows[0]?.payload_json;
      if (typeof payloadJson !== "string") {
        return null;
      }
      const parsedCache = JSON.parse(payloadJson);
      try {
        await syncHistoryAnalyticsTracksFromCache(connection, normalizedUserUid, parsedCache);
      } catch (syncError) {
        console.warn("Failed to sync history analytics tracks during cache read.", syncError);
      }
      return parsedCache;
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to read history local cache from DuckDB.", error);
    return null;
  }
}

export async function writeHistoryLocalCacheToDuckDb(userUid: string, cache: unknown): Promise<void> {
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
        [normalizedUserUid, payloadJson]
      );
      try {
        await syncHistoryAnalyticsTracksFromCache(connection, normalizedUserUid, cache);
      } catch (syncError) {
        console.warn("Failed to sync history analytics tracks during cache write.", syncError);
      }
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to write history local cache to DuckDB.", error);
  }
}

export async function queryStatsOverviewFromDuckDb(
  input: QueryStatsOverviewInput
): Promise<QueryStatsOverviewResult> {
  const normalizedUserUid = input.userUid.trim();
  if (!normalizedUserUid) {
    return buildEmptyStatsOverviewResult();
  }

  const normalizedRangeStartMs =
    typeof input.rangeStartMs === "number" && Number.isFinite(input.rangeStartMs)
      ? Math.max(0, Math.trunc(input.rangeStartMs))
      : null;
  const includeTracksPerDay = Boolean(input.includeTracksPerDay);
  const distributionInterval: StatsDistributionInterval =
    input.distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
      ? STATS_DISTRIBUTION_INTERVAL_HOUR
      : STATS_DISTRIBUTION_INTERVAL_DAY;
  const monsterExcludeClause = createMonsterExcludeClause(input.excludeMonsterNames);

  try {
    const database = await getHistoryLocalCacheDatabase();
    const connection = database.connect();
    try {
      const rangeWhereSqlParts = [`user_uid = ?${monsterExcludeClause.sql}`];
      const rangeWhereParameters: unknown[] = [normalizedUserUid, ...monsterExcludeClause.parameters];
      if (normalizedRangeStartMs !== null) {
        rangeWhereSqlParts.push("timestamp_ms >= ?");
        rangeWhereParameters.push(normalizedRangeStartMs);
      }
      const rangeWhereSql = rangeWhereSqlParts.join(" AND ");

      const allTimeWhereSql = `user_uid = ?${monsterExcludeClause.sql}`;
      const allTimeWhereParameters: unknown[] = [normalizedUserUid, ...monsterExcludeClause.parameters];
      const distributionBucketSql =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? "coalesce(hour_key_local, day_key_local || ' 00:00')"
          : "day_key_local";
      const allTimeCountRows = await readDuckDbRows<AllTimeRangeCountRow>(
        connection,
        `SELECT COUNT(*) AS track_count
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${allTimeWhereSql}`,
        allTimeWhereParameters
      );
      const mostActiveMonsterRows = await readDuckDbRows<MostActiveMonsterRow>(
        connection,
        `SELECT
           monster_name,
           COUNT(*) AS track_count
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${rangeWhereSql}
         GROUP BY monster_name, monster_name_norm
        ORDER BY track_count DESC, monster_name_norm ASC
         LIMIT 1`,
        rangeWhereParameters
      );
      const contributionRows = await readDuckDbRows<DailyContributionRow>(
        connection,
        `SELECT
           ${distributionBucketSql} AS bucket_key_local,
           tracked_by_uid AS person_id,
           tracked_by_nickname AS person_name,
           SUM(1) AS contribution_sum
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${rangeWhereSql}
         GROUP BY 1, tracked_by_uid, tracked_by_nickname
         ORDER BY 1 ASC, contribution_sum DESC, lower(tracked_by_nickname) ASC`,
        rangeWhereParameters
      );

      const totalTracksAllTime = normalizeTrackCount(allTimeCountRows[0]?.track_count);
      const mostActiveMonsterNameRaw = mostActiveMonsterRows[0]?.monster_name;
      const mostActiveMonsterName =
        typeof mostActiveMonsterNameRaw === "string" ? mostActiveMonsterNameRaw.trim() : "";
      const mostActiveMonsterCount = normalizeTrackCount(mostActiveMonsterRows[0]?.track_count);

      const normalizedContributionRows = contributionRows
        .map((row) => {
          const bucket = typeof row.bucket_key_local === "string" ? row.bucket_key_local.trim() : "";
          const personName =
            typeof row.person_name === "string" && row.person_name.trim()
              ? row.person_name.trim()
              : "Unknown User";
          const personId =
            typeof row.person_id === "string" && row.person_id.trim() ? row.person_id.trim() : null;
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
            row
          ): row is {
            bucket: string;
            personId: string | null;
            personName: string;
            contribution: number;
          } => row !== null
        );

      const earliestTrackedBucketKey = normalizedContributionRows[0]?.bucket ?? null;
      const nowTimestampMs = Date.now();
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
              ? parseLocalHourKeyToTimestampMs(earliestTrackedBucketKey) ?? defaultStartBucketTimestampMs
              : parseLocalDayKeyToTimestampMs(earliestTrackedBucketKey) ?? defaultStartBucketTimestampMs
            : defaultStartBucketTimestampMs;
      const contiguousBuckets =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? buildContiguousHourKeys(requestedStartBucketTimestampMs, nowTimestampMs)
          : buildContiguousDayKeys(requestedStartBucketTimestampMs, nowTimestampMs);
      const fallbackBucketKey =
        distributionInterval === STATS_DISTRIBUTION_INTERVAL_HOUR
          ? getLocalHourKeyFromTimestampMs(nowTimestampMs)
          : getLocalDayKeyFromTimestampMs(nowTimestampMs);
      const days = contiguousBuckets.length > 0 ? contiguousBuckets : [fallbackBucketKey];
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

        const personKey = row.personId ? `uid:${row.personId}` : `name:${row.personName.toLowerCase()}`;
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
        .sort((left, right) => right.total - left.total || left.personName.localeCompare(right.personName));
      const totalTracksRange = totalsPerDay.reduce((sum, value) => sum + value, 0);
      const totalAllDays = totalTracksRange;
      const maxDayTotal = totalsPerDay.length > 0 ? Math.max(...totalsPerDay) : 0;
      const daysRecorded = totalsPerDay.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
      const avgPerDay = normalizeAverageValue(days.length > 0 ? totalAllDays / days.length : 0);

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
      const topUsers = sortedSeries.slice(0, STATS_USER_RANKING_LIMIT).map((entry) => ({
        uid: entry.personId,
        nickname: entry.personName,
        count: entry.total,
      }));

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
        distribution,
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
  }
}
