export type Monster = {
  id: string;
  name: string;
  respawnDuration: number;
  lastKilledTimestamp: string;
  lastTrackedByUid: string | null;
  offsetSeconds?: number;
  categoryId: string | null;
  hasNotifiedReady: boolean;
};

export type TrackedByUser = {
  nickname: string;
  photoURL: string | null;
};

export type Category = {
  id: string;
  name: string;
  color: string;
};

export type MonsterHistoryEntry = {
  id: string;
  timestampIso: string;
  userUid: string | null;
  userNickname: string;
  monsterId: string | null;
  monsterName: string;
  action: string;
  previousValue: string;
  currentValue: string;
};

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
  | "lastTrackedBy"
  | "timeRemaining"
  | "offsetEdit"
  | "actions";

export type MonsterTableColumnVisibility = Record<MonsterTableColumnKey, boolean>;
