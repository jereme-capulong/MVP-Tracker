import { app } from "electron";
import path from "node:path";

const HISTORY_LOCAL_CACHE_DUCKDB_FILENAME = "mvp-tracker-local-cache.duckdb";
const HISTORY_LOCAL_CACHE_TABLE_NAME = "history_local_cache";

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
      return JSON.parse(payloadJson);
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
        `INSERT INTO ${HISTORY_LOCAL_CACHE_TABLE_NAME} (user_uid, payload_json, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (user_uid) DO UPDATE
         SET payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`,
        [normalizedUserUid, payloadJson]
      );
    } finally {
      await closeDuckDbConnection(connection);
    }
  } catch (error) {
    console.error("Failed to write history local cache to DuckDB.", error);
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
