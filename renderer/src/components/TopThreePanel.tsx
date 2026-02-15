import { ChangeEvent, memo, useCallback, useEffect, useMemo, useState } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Monster, TopCount } from "../types";
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
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onAdjustOffset: (id: string, deltaSeconds: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onInteraction: (id: string) => void;
  activeEditingMonsterId: string | null;
  isInteractionLocked: boolean;
};

type TopFiveCardProps = {
  monster: Monster;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onAdjustOffset: (id: string, deltaSeconds: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onInteraction: (id: string) => void;
  isInteractionHighlighted: boolean;
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
  onResetNow,
  onDelete,
  onSetExact,
  onAdjustOffset,
  onOffsetHoursMinutesChange,
  onInteraction,
  isInteractionHighlighted,
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

  useEffect(() => {
    if (!isOffsetHoursEditing) {
      setOffsetHoursInput(String(offsetParts.hours));
    }
    if (!isOffsetMinutesEditing) {
      setOffsetMinutesInput(String(offsetParts.minutes));
    }
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

  const handleResetNow = useCallback(() => {
    onInteraction(monster.id);
    onResetNow(monster.id);
  }, [monster.id, onInteraction, onResetNow]);

  const handleDelete = useCallback(() => {
    onInteraction(monster.id);
    onDelete(monster.id);
  }, [monster.id, onDelete, onInteraction]);

  const handleSetExact = useCallback(() => {
    onInteraction(monster.id);
    onSetExact(monster.id);
  }, [monster.id, onInteraction, onSetExact]);

  const addMinute = useCallback(() => {
    onInteraction(monster.id);
    onAdjustOffset(monster.id, 60);
  }, [monster.id, onAdjustOffset, onInteraction]);

  const subtractMinute = useCallback(() => {
    onInteraction(monster.id);
    onAdjustOffset(monster.id, -60);
  }, [monster.id, onAdjustOffset, onInteraction]);

  const addHour = useCallback(() => {
    onInteraction(monster.id);
    onAdjustOffset(monster.id, 3600);
  }, [monster.id, onAdjustOffset, onInteraction]);

  const subtractHour = useCallback(() => {
    onInteraction(monster.id);
    onAdjustOffset(monster.id, -3600);
  }, [monster.id, onAdjustOffset, onInteraction]);

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

  const handleFocusCapture = useCallback(() => {
    onInteraction(monster.id);
  }, [monster.id, onInteraction]);

  const handleChangeCapture = useCallback(() => {
    onInteraction(monster.id);
  }, [monster.id, onInteraction]);

  const className = useMemo(() => {
    const classes = ["upcoming-card"];
    if (isReady) {
      classes.push("ready-card");
    }
    if (isInteractionHighlighted) {
      classes.push("interaction-locked");
    }
    return classes.join(" ");
  }, [isInteractionHighlighted, isReady]);

  return (
    <article
      className={className}
      onFocusCapture={handleFocusCapture}
      onChangeCapture={handleChangeCapture}
    >
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
        <button type="button" onClick={handleResetNow}>
          Track
        </button>
        <button type="button" className="btn-set-exact" onClick={handleSetExact}>
          Set Exact
        </button>
        <button type="button" className="btn-plus-minute" aria-label="Add 1 Minute" onClick={addMinute}>
          +M
        </button>
        <button type="button" className="btn-minus-minute" aria-label="Subtract 1 Minute" onClick={subtractMinute}>
          -M
        </button>
        <button type="button" className="btn-plus-hour" aria-label="Add 1 Hour" onClick={addHour}>
          +HR
        </button>
        <button type="button" className="btn-minus-hour" aria-label="Subtract 1 Hour" onClick={subtractHour}>
          -HR
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
    </article>
  );
});

export const TopFivePanel = memo(function TopFivePanel({
  monsters,
  topCount,
  onTopCountChange,
  onResetNow,
  onDelete,
  onSetExact,
  onAdjustOffset,
  onOffsetHoursMinutesChange,
  onInteraction,
  activeEditingMonsterId,
  isInteractionLocked,
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
            onResetNow={onResetNow}
            onDelete={onDelete}
            onSetExact={onSetExact}
            onAdjustOffset={onAdjustOffset}
            onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
            onInteraction={onInteraction}
            isInteractionHighlighted={isInteractionLocked && activeEditingMonsterId === monster.id}
          />
        ))}
      </div>
    </section>
  );
});
