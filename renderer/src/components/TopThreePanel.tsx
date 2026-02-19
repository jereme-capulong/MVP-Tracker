import { ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Monster, TopCount, TrackedByUser } from "../types";
import {
  calculateNextSpawn,
  convertHoursMinutesToSeconds,
  convertSecondsToHoursMinutes,
  formatCountdown,
  formatDateTime,
  READY_BUFFER_MS,
} from "../utils/time";

type TopFivePanelProps = {
  monsters: Monster[];
  topCount: TopCount;
  onTopCountChange: (count: TopCount) => void;
  onTrack: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  trackedByUserMap: Map<string, TrackedByUser>;
};

type TopFiveCardProps = {
  monster: Monster;
  onTrack: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  lastTrackedByUser: TrackedByUser | null;
};

function parseSignedInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "+") {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

const TopFiveCard = memo(function TopFiveCard({
  monster,
  onTrack,
  onDelete,
  onSetExact,
  onOffsetHoursMinutesChange,
  lastTrackedByUser,
}: TopFiveCardProps) {
  const nowMs = useGlobalNow();

  const nextSpawnMs = useMemo(() => calculateNextSpawn(monster), [monster]);
  const spawnText = useMemo(() => formatDateTime(nextSpawnMs), [nextSpawnMs]);
  const timeRemainingMs = nextSpawnMs - nowMs;
  const timeRemainingSeconds = Math.floor(timeRemainingMs / 1000);
  const isReady = timeRemainingMs <= READY_BUFFER_MS;
  const offsetParts = useMemo(
    () => convertSecondsToHoursMinutes(monster.offsetSeconds ?? 0),
    [monster.offsetSeconds]
  );

  const [offsetHoursInput, setOffsetHoursInput] = useState(() => String(offsetParts.hours));
  const [offsetMinutesInput, setOffsetMinutesInput] = useState(() => String(offsetParts.minutes));
  const [isOffsetHoursEditing, setIsOffsetHoursEditing] = useState(false);
  const [isOffsetMinutesEditing, setIsOffsetMinutesEditing] = useState(false);
  const previousOffsetPartsRef = useRef(offsetParts);

  useEffect(() => {
    const previous = previousOffsetPartsRef.current;
    const didServerOffsetChange =
      previous.hours !== offsetParts.hours || previous.minutes !== offsetParts.minutes;

    if (!isOffsetHoursEditing && didServerOffsetChange) {
      setOffsetHoursInput(String(offsetParts.hours));
    }
    if (!isOffsetMinutesEditing && didServerOffsetChange) {
      setOffsetMinutesInput(String(offsetParts.minutes));
    }
    previousOffsetPartsRef.current = offsetParts;
  }, [isOffsetHoursEditing, isOffsetMinutesEditing, offsetParts.hours, offsetParts.minutes]);

  const commitOffset = useCallback(
    (hoursRaw: string, minutesRaw: string) => {
      const parsedHours = parseSignedInteger(hoursRaw) ?? 0;
      const parsedMinutes = parseSignedInteger(minutesRaw) ?? 0;
      const total = convertHoursMinutesToSeconds(parsedHours, parsedMinutes);
      const next = convertSecondsToHoursMinutes(total);
      setOffsetHoursInput(String(next.hours));
      setOffsetMinutesInput(String(next.minutes));
      onOffsetHoursMinutesChange(monster.id, next.hours, next.minutes);
    },
    [monster.id, onOffsetHoursMinutesChange]
  );

  const handleTrack = useCallback(() => {
    onTrack(monster.id);
  }, [monster.id, onTrack]);

  const handleDelete = useCallback(() => {
    onDelete(monster.id);
  }, [monster.id, onDelete]);

  const handleSetExact = useCallback(() => {
    onSetExact(monster.id);
  }, [monster.id, onSetExact]);

  const handleHoursChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setOffsetHoursInput(event.target.value);
  }, []);

  const handleMinutesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setOffsetMinutesInput(event.target.value);
  }, []);

  const handleHoursFocus = useCallback(() => {
    setIsOffsetHoursEditing(true);
  }, []);

  const handleMinutesFocus = useCallback(() => {
    setIsOffsetMinutesEditing(true);
  }, []);

  const handleHoursBlur = useCallback(() => {
    setIsOffsetHoursEditing(false);
    commitOffset(offsetHoursInput, offsetMinutesInput);
  }, [commitOffset, offsetHoursInput, offsetMinutesInput]);

  const handleMinutesBlur = useCallback(() => {
    setIsOffsetMinutesEditing(false);
    commitOffset(offsetHoursInput, offsetMinutesInput);
  }, [commitOffset, offsetHoursInput, offsetMinutesInput]);

  const className = useMemo(() => {
    const classes = ["upcoming-card"];
    if (isReady) {
      classes.push("ready-card");
    }
    return classes.join(" ");
  }, [isReady]);
  const trackedByName = useMemo(() => {
    const trimmed = lastTrackedByUser?.nickname.trim() ?? "";
    return trimmed || "Unknown";
  }, [lastTrackedByUser?.nickname]);
  const trackedByInitial = useMemo(() => trackedByName.charAt(0).toUpperCase(), [trackedByName]);

  return (
    <article className={className}>
      <button
        type="button"
        className="card-delete-icon-btn"
        aria-label={`Delete ${monster.name}`}
        title={`Delete ${monster.name}`}
        onClick={handleDelete}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-1 6h2v9H8V9zm4 0h2v9h-2V9zm4 0h2v9h-2V9z" />
        </svg>
      </button>
      <div className="upcoming-name">{monster.name}</div>
      <div className={`upcoming-countdown ${isReady ? "ready" : ""}`}>{formatCountdown(timeRemainingSeconds)}</div>
      <div className="upcoming-spawn">{spawnText}</div>

      <div className="card-actions-grid">
        <button type="button" className="btn-track" onClick={handleTrack}>
          Track
        </button>
        <button type="button" className="btn-set-exact" onClick={handleSetExact}>
          Set Exact
        </button>
      </div>

      <div className="card-offset-inline">
        <input
          className="table-input table-num inline-offset-input"
          type="number"
          step={1}
          aria-label={`${monster.name} top card offset hours`}
          value={offsetHoursInput}
          onChange={handleHoursChange}
          onFocus={handleHoursFocus}
          onBlur={handleHoursBlur}
        />
        <span className="offset-separator">h</span>
        <input
          className="table-input table-num inline-offset-input"
          type="number"
          step={1}
          aria-label={`${monster.name} top card offset minutes`}
          value={offsetMinutesInput}
          onChange={handleMinutesChange}
          onFocus={handleMinutesFocus}
          onBlur={handleMinutesBlur}
        />
        <span className="offset-separator">m</span>
      </div>
      {monster.lastTrackedByUid ? (
        <div className="card-tracked-by" title={trackedByName}>
          {lastTrackedByUser?.photoURL ? (
            <img className="tracked-by-avatar" src={lastTrackedByUser.photoURL} alt="" aria-hidden="true" />
          ) : (
            <span className="tracked-by-avatar tracked-by-avatar-fallback" aria-hidden="true">
              {trackedByInitial}
            </span>
          )}
          <span className="card-tracked-by-name">{trackedByName}</span>
        </div>
      ) : null}
    </article>
  );
});

export const TopFivePanel = memo(function TopFivePanel({
  monsters,
  topCount,
  onTopCountChange,
  onTrack,
  onDelete,
  onSetExact,
  onOffsetHoursMinutesChange,
  trackedByUserMap,
}: TopFivePanelProps) {
  const handleTopCountChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onTopCountChange(Number(event.target.value) as TopCount);
    },
    [onTopCountChange]
  );

  return (
    <section className="top-three-panel">
      <div className="top-panel-header">
        <h2>Top Upcoming</h2>
        <label className="top-count-control">
          <span>Show Top</span>
          <select value={topCount} onChange={handleTopCountChange}>
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={15}>15</option>
          </select>
        </label>
      </div>
      <div className="top-three-grid">
        {monsters.map((monster) => (
          <TopFiveCard
            key={monster.id}
            monster={monster}
            onTrack={onTrack}
            onDelete={onDelete}
            onSetExact={onSetExact}
            onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
            lastTrackedByUser={
              monster.lastTrackedByUid
                ? (trackedByUserMap.get(monster.lastTrackedByUid) ?? null)
                : null
            }
          />
        ))}
      </div>
    </section>
  );
});
