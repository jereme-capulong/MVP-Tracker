export type Monster = {
  id: string;
  name: string;
  respawnDuration: number;
  lastKilledTimestamp: string;
  offsetSeconds?: number;
  categoryId: string | null;
  editingBy: string | null;
  editingByUid: string | null;
  editingStartedAtMs: number | null;
  hasNotifiedReady: boolean;
};

export const EDIT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export type Category = {
  id: string;
  name: string;
  color: string;
};

export type SetExactMode = "exactRespawn" | "exactTilNext";

export type TopCount = 3 | 5 | 10 | 15;

export type MonsterInput = {
  name: string;
  respawnDurationMinutes: number;
  lastKilledTimestamp: string;
  categoryId: string | null;
};

export type MonsterEditInput = {
  id: string;
  name: string;
  respawnDurationMinutes: number;
  lastKilledTimestamp: string;
  offsetSeconds: number;
  categoryId: string | null;
};

export type MonsterTableColumnKey =
  | "name"
  | "respawnDuration"
  | "lastKilled"
  | "offset"
  | "nextSpawnTime"
  | "timeRemaining"
  | "offsetEdit"
  | "actions";

export type MonsterTableColumnVisibility = Record<MonsterTableColumnKey, boolean>;
