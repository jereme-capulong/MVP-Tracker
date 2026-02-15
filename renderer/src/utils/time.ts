import { Monster, SetExactMode, TopCount } from "../types";

const SOUND_STORAGE_KEY = "mvp-tracker.sound-enabled.v1";
const TOP_COUNT_STORAGE_KEY = "mvp-tracker.top-count.v1";
const VIEW_MODE_STORAGE_KEY = "mvp-tracker.view-mode.v1";
const TOP_COUNT_VALUES: TopCount[] = [3, 5, 10, 15];

export const READY_BUFFER_MS = 1000;
export const UPCOMING_WINDOW_MS = 5 * 60 * 1000;
export const OVERDUE_WINDOW_MS = 30 * 60 * 1000;

export type ViewMode = "wide" | "portrait";
export type SpawnState = "ready" | "overdue" | "upcoming" | "normal";

export type OffsetSign = 1 | -1;

export type OffsetParts = {
  sign: OffsetSign;
  hours: number;
  minutes: number;
};

export type SignedHoursMinutes = {
  hours: number;
  minutes: number;
};

export function getOffsetSeconds(monster: Monster): number {
  return monster.offsetSeconds ?? 0;
}

export function applyOffset(respawnDurationSeconds: number, offsetSeconds: number): number {
  return respawnDurationSeconds + offsetSeconds;
}

export function getEffectiveRespawnSeconds(monster: Monster): number {
  return applyOffset(monster.respawnDuration, getOffsetSeconds(monster));
}

export function calculateNextSpawn(monster: Monster): number {
  const killedMs = Date.parse(monster.lastKilledTimestamp);
  const totalRespawnSeconds = getEffectiveRespawnSeconds(monster);
  return killedMs + totalRespawnSeconds * 1000;
}

export function calculateTimeRemaining(nextSpawnMs: number, nowMs: number): number {
  return nextSpawnMs - nowMs;
}

export function shouldTriggerReady(previousTimeRemaining: number, currentTimeRemaining: number): boolean {
  return previousTimeRemaining > READY_BUFFER_MS && currentTimeRemaining <= READY_BUFFER_MS;
}

export function getSpawnState(nextSpawnMs: number, nowMs: number): SpawnState {
  const timeRemainingMs = nextSpawnMs - nowMs;
  const overdueMs = nowMs - nextSpawnMs;

  if (timeRemainingMs <= READY_BUFFER_MS && overdueMs <= OVERDUE_WINDOW_MS) {
    return "ready";
  }
  if (overdueMs > OVERDUE_WINDOW_MS) {
    return "overdue";
  }
  if (timeRemainingMs <= UPCOMING_WINDOW_MS) {
    return "upcoming";
  }
  return "normal";
}

// Backward-compatible alias used across existing components.
export function getNextSpawnMs(monster: Monster): number {
  return calculateNextSpawn(monster);
}

export function getTimeRemainingMs(monster: Monster, nowMs: number): number {
  return calculateTimeRemaining(calculateNextSpawn(monster), nowMs);
}

export function getTimeRemainingSeconds(monster: Monster, nowMs: number): number {
  return Math.floor(getTimeRemainingMs(monster, nowMs) / 1000);
}

export function convertHoursMinutesToSeconds(hours: number, minutes: number): number {
  const safeHours = Number.isFinite(hours) ? Math.trunc(hours) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.trunc(minutes) : 0;
  return safeHours * 3600 + safeMinutes * 60;
}

export function calculateSetExactTargetSpawnMs(
  mode: SetExactMode,
  hours: number,
  minutes: number,
  nowMs: number
): number {
  const safeHours = Math.max(0, Math.min(23, Math.trunc(hours)));
  const safeMinutes = Math.max(0, Math.min(59, Math.trunc(minutes)));

  if (mode === "exactRespawn") {
    const now = new Date(nowMs);
    const target = new Date(nowMs);
    target.setHours(safeHours, safeMinutes, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  const exactDurationSeconds = convertHoursMinutesToSeconds(safeHours, safeMinutes);
  return nowMs + exactDurationSeconds * 1000;
}

export function calculateLastKilledTimestampForTargetSpawn(monster: Monster, targetSpawnMs: number): string {
  const effectiveRespawnMs = getEffectiveRespawnSeconds(monster) * 1000;
  return new Date(targetSpawnMs - effectiveRespawnMs).toISOString();
}

export function convertSecondsToHoursMinutes(totalSeconds: number): SignedHoursMinutes {
  if (!Number.isFinite(totalSeconds) || totalSeconds === 0) {
    return { hours: 0, minutes: 0 };
  }

  const sign = totalSeconds < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(totalSeconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);

  if (hours > 0) {
    return { hours: sign * hours, minutes: sign * minutes };
  }
  return { hours: 0, minutes: sign * minutes };
}

export function offsetSecondsToParts(offsetSeconds: number): OffsetParts {
  const sign: OffsetSign = offsetSeconds < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(offsetSeconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  return { sign, hours, minutes };
}

export function offsetPartsToSeconds(sign: OffsetSign, hours: number, minutes: number): number {
  const safeHours = Math.max(0, Math.trunc(hours));
  const safeMinutes = Math.min(59, Math.max(0, Math.trunc(minutes)));
  const total = safeHours * 3600 + safeMinutes * 60;
  return sign * total;
}

export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "READY";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDateTime(value: string | number): string {
  const date = new Date(value);
  return date.toLocaleString();
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (secs === 0) {
    return `${mins}m`;
  }
  return `${mins}m ${secs}s`;
}

export function formatOffsetSeconds(offsetSeconds: number): string {
  const abs = Math.abs(Math.trunc(offsetSeconds));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const prefix = offsetSeconds < 0 ? "-" : "+";
  return `${prefix}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

export function nowAsLocalInputValue(): string {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export function localInputValueToIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

export function isoToLocalInputValue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return nowAsLocalInputValue();
  }
  const tzOffsetMs = parsed.getTimezoneOffset() * 60000;
  return new Date(parsed.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export function loadSoundEnabled(): boolean {
  const raw = localStorage.getItem(SOUND_STORAGE_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "1";
}

export function saveSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_STORAGE_KEY, enabled ? "1" : "0");
}

export function loadTopCount(): TopCount {
  const raw = Number(localStorage.getItem(TOP_COUNT_STORAGE_KEY));
  return TOP_COUNT_VALUES.includes(raw as TopCount) ? (raw as TopCount) : 5;
}

export function saveTopCount(count: TopCount): void {
  localStorage.setItem(TOP_COUNT_STORAGE_KEY, String(count));
}

export function loadViewMode(): ViewMode {
  return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "portrait" ? "portrait" : "wide";
}

export function saveViewMode(mode: ViewMode): void {
  localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
}

export function makeMonster(
  name: string,
  respawnDurationMinutes: number,
  lastKilledTimestamp: string
): Monster {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    respawnDuration: Math.max(1, Math.round(respawnDurationMinutes * 60)),
    lastKilledTimestamp,
    offsetSeconds: 0,
    hasNotifiedReady: false,
  };
}
