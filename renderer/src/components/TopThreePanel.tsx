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
  onAdjustOffset: (id: string, deltaSeconds: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onToggleOverride: (id: string, isActive: boolean) => void;
  onInteraction: (id: string) => void;
  activeEditingMonsterId: string | null;
  isInteractionLocked: boolean;
};

type TopFiveCardProps = {
  monster: Monster;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onAdjustOffset: (id: string, deltaSeconds: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onToggleOverride: (id: string, isActive: boolean) => void;
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
  onAdjustOffset,
  onOffsetHoursMinutesChange,
  onToggleOverride,
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
    onInteraction(monster.id)
    onDelete(monster.id);
  }, [monster.id, onDelete, onInteraction]);

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

  const handleOverrideChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onInteraction(monster.id);
      onToggleOverride(monster.id, event.target.checked);
    },
    [monster.id, onInteraction, onToggleOverride]
  );

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
      <div className="upcoming-name">{monster.name}</div>
      <div className={`upcoming-countdown ${isReady ? "ready" : ""}`}>{formatCountdown(timeRemainingSeconds)}</div>
      <div className="upcoming-spawn">{spawnText}</div>

      <div className="card-actions-grid">
        <button type="button" onClick={handleResetNow}>
          Track
        </button>
        <button type="button" className="btn-plus-minute" onClick={handleDelete}>
          Delete
        </button>
        <button type="button" className="btn-plus-minute" onClick={addMinute}>
          +1 Minute
        </button>
        <button type="button" className="btn-minus-minute" onClick={subtractMinute}>
          -1 Minute
        </button>
        <button type="button" className="btn-plus-hour" onClick={addHour}>
          +1 Hour
        </button>
        <button type="button" className="btn-minus-hour" onClick={subtractHour}>
          -1 Hour
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
        <label className={`override-toggle ${monster.isOverrideActive ? "enabled" : ""}`}>
          <input
            type="checkbox"
            checked={monster.isOverrideActive}
            onChange={handleOverrideChange}
          />
          <span>Override Respawn</span>
        </label>
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
  onAdjustOffset,
  onOffsetHoursMinutesChange,
  onToggleOverride,
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
            onAdjustOffset={onAdjustOffset}
            onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
            onToggleOverride={onToggleOverride}
            onInteraction={onInteraction}
            isInteractionHighlighted={isInteractionLocked && activeEditingMonsterId === monster.id}
          />
        ))}
      </div>
    </section>
  );
});
