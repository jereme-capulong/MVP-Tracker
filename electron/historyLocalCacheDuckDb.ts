import { app } from "electron";
import path from "node:path";

const HISTORY_LOCAL_CACHE_DUCKDB_FILENAME = "mvp-tracker-local-cache.duckdb";
const HISTORY_LOCAL_CACHE_TABLE_NAME = "history_local_cache";
const HISTORY_ANALYTICS_TRACKS_TABLE_NAME = "history_analytics_tracks";
const TRACKED_MONSTER_ACTION = "Tracked Monster";

type HistoryAnalyticsTrackRow = {
  historyId: string;
  timestampMs: number;
  dayKeyLocal: string;
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

export type QueryStatsOverviewInput = {
  userUid: string;
  rangeStartMs: number | null;
  includeTracksPerDay: boolean;
  excludeMonsterNames: string[];
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

function normalizeHistoryAnalyticsTrackRows(entries: unknown[]): HistoryAnalyticsTrackRow[] {
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
          monster_name,
          monster_name_norm,
          tracked_by_uid,
          tracked_by_nickname
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        -- Concurrent writers can attempt the same key at the same time.
        ON CONFLICT (user_uid, history_id) DO NOTHING`,
        [
          normalizedUserUid,
          row.historyId,
          row.timestampMs,
          row.dayKeyLocal,
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

  const trackRows = normalizeHistoryAnalyticsTrackRows(entries);
  if (trackRows.length === 0) {
    return;
  }

  await upsertHistoryAnalyticsTrackRows(connection, normalizedUserUid, trackRows);
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
        monster_name VARCHAR NOT NULL,
        monster_name_norm VARCHAR NOT NULL,
        tracked_by_uid VARCHAR,
        tracked_by_nickname VARCHAR NOT NULL,
        PRIMARY KEY (user_uid, history_id)
      )`
    );
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
    return {
      totalTracksRange: 0,
      totalTracksAllTime: 0,
      mostActiveMonster: null,
      tracksPerDay: [],
      topUsers: [],
    };
  }

  const normalizedRangeStartMs =
    typeof input.rangeStartMs === "number" && Number.isFinite(input.rangeStartMs)
      ? Math.max(0, Math.trunc(input.rangeStartMs))
      : null;
  const includeTracksPerDay = Boolean(input.includeTracksPerDay);
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

      const rangeCountRows = await readDuckDbRows<TrackCountRow>(
        connection,
        `SELECT COUNT(*) AS track_count
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${rangeWhereSql}`,
        rangeWhereParameters
      );
      const allTimeCountRows = await readDuckDbRows<TrackCountRow>(
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
      const topUserRows = await readDuckDbRows<TopUserRow>(
        connection,
        `SELECT
           tracked_by_uid AS user_uid,
           tracked_by_nickname AS user_nickname,
           COUNT(*) AS track_count
         FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
         WHERE ${rangeWhereSql}
         GROUP BY tracked_by_uid, tracked_by_nickname
         ORDER BY track_count DESC, lower(tracked_by_nickname) ASC
         LIMIT 5`,
        rangeWhereParameters
      );
      const tracksPerDayRows = includeTracksPerDay
        ? await readDuckDbRows<TracksPerDayRow>(
            connection,
            `SELECT
               day_key_local,
               COUNT(*) AS track_count
             FROM ${HISTORY_ANALYTICS_TRACKS_TABLE_NAME}
             WHERE ${rangeWhereSql}
             GROUP BY day_key_local
             ORDER BY day_key_local DESC`,
            rangeWhereParameters
          )
        : [];

      const totalTracksRange = normalizeTrackCount(rangeCountRows[0]?.track_count);
      const totalTracksAllTime = normalizeTrackCount(allTimeCountRows[0]?.track_count);
      const mostActiveMonsterNameRaw = mostActiveMonsterRows[0]?.monster_name;
      const mostActiveMonsterName =
        typeof mostActiveMonsterNameRaw === "string" ? mostActiveMonsterNameRaw.trim() : "";
      const mostActiveMonsterCount = normalizeTrackCount(mostActiveMonsterRows[0]?.track_count);

      const tracksPerDay = tracksPerDayRows
        .map((row) => {
          const day = typeof row.day_key_local === "string" ? row.day_key_local.trim() : "";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            return null;
          }
          return {
            day,
            count: normalizeTrackCount(row.track_count),
          };
        })
        .filter((row): row is { day: string; count: number } => row !== null);

      const topUsers = topUserRows
        .map((row) => {
          const nickname =
            typeof row.user_nickname === "string" && row.user_nickname.trim()
              ? row.user_nickname.trim()
              : "Unknown User";
          const uid =
            typeof row.user_uid === "string" && row.user_uid.trim() ? row.user_uid.trim() : null;
          return {
            uid,
            nickname,
            count: normalizeTrackCount(row.track_count),
          };
        })
        .filter((row) => row.count > 0);

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
      };
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to query stats overview from DuckDB.", error);
    return {
      totalTracksRange: 0,
      totalTracksAllTime: 0,
      mostActiveMonster: null,
      tracksPerDay: [],
      topUsers: [],
    };
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
  }
}
