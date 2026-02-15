export type Monster = {
  id: string;
  name: string;
  respawnDuration: number;
  lastKilledTimestamp: string;
  offsetSeconds?: number;
  hasNotifiedReady: boolean;
};

export type SetExactMode = "exactRespawn" | "exactTilNext";

export type TopCount = 3 | 5 | 10 | 15;

export type MonsterInput = {
  name: string;
  respawnDurationMinutes: number;
  lastKilledTimestamp: string;
};

export type MonsterEditInput = {
  id: string;
  name: string;
  respawnDurationMinutes: number;
  lastKilledTimestamp: string;
  offsetSeconds: number;
};
