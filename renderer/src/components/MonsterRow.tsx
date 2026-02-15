import { ChangeEvent, memo, useCallback, useEffect, useMemo, useState } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Monster } from "../types";
import {
  calculateNextSpawn,
  convertHoursMinutesToSeconds,
  convertSecondsToHoursMinutes,
  formatCountdown,
  formatDateTime,
  formatOffsetSeconds,
  isoToLocalInputValue,
  localInputValueToIso,
  READY_BUFFER_MS,
} from "../utils/time";

type MonsterRowProps = {
  monster: Monster;
  onNameChange: (id: string, value: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
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

function parseNonNegativeInteger(value: string): number | null {
  const parsed = parseSignedInteger(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
}

export const MonsterRow = memo(function MonsterRow({
  monster,
  onNameChange,
  onRespawnHoursMinutesChange,
  onLastKilledChange,
  onOffsetHoursMinutesChange,
  onResetNow,
  onDelete,
  onSetExact,
  onInteraction,
  isInteractionHighlighted,
}: MonsterRowProps) {
  const nowMs = useGlobalNow();

  const nextSpawnMs = useMemo(() => calculateNextSpawn(monster), [monster]);
  const timeRemainingMs = nextSpawnMs - nowMs;
  const timeRemainingSeconds = Math.floor(timeRemainingMs / 1000);
  const isReady = timeRemainingMs <= READY_BUFFER_MS;

  const respawnParts = useMemo(() => {
    const totalMinutes = Math.max(1, Math.round(monster.respawnDuration / 60));
    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    };
  }, [monster.respawnDuration]);
  const lastKilledLocal = useMemo(
    () => isoToLocalInputValue(monster.lastKilledTimestamp),
    [monster.lastKilledTimestamp]
  );
  const offsetParts = useMemo(
    () => convertSecondsToHoursMinutes(monster.offsetSeconds ?? 0),
    [monster.offsetSeconds]
  );
  const nextSpawnText = useMemo(() => formatDateTime(nextSpawnMs), [nextSpawnMs]);

  const [respawnHoursInput, setRespawnHoursInput] = useState(() => String(respawnParts.hours));
  const [respawnMinutesInput, setRespawnMinutesInput] = useState(() => String(respawnParts.minutes));
  const [offsetHoursInput, setOffsetHoursInput] = useState(() => String(offsetParts.hours));
  const [offsetMinutesInput, setOffsetMinutesInput] = useState(() => String(offsetParts.minutes));

  const [isRespawnHoursEditing, setIsRespawnHoursEditing] = useState(false);
  const [isRespawnMinutesEditing, setIsRespawnMinutesEditing] = useState(false);
  const [isOffsetHoursEditing, setIsOffsetHoursEditing] = useState(false);
  const [isOffsetMinutesEditing, setIsOffsetMinutesEditing] = useState(false);

  useEffect(() => {
    if (!isRespawnHoursEditing) {
      setRespawnHoursInput(String(respawnParts.hours));
    }
    if (!isRespawnMinutesEditing) {
      setRespawnMinutesInput(String(respawnParts.minutes));
    }
  }, [isRespawnHoursEditing, isRespawnMinutesEditing, respawnParts.hours, respawnParts.minutes]);

  useEffect(() => {
    if (!isOffsetHoursEditing) {
      setOffsetHoursInput(String(offsetParts.hours));
    }
    if (!isOffsetMinutesEditing) {
      setOffsetMinutesInput(String(offsetParts.minutes));
    }
  }, [isOffsetHoursEditing, isOffsetMinutesEditing, offsetParts.hours, offsetParts.minutes]);

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onNameChange(monster.id, event.target.value);
    },
    [monster.id, onNameChange]
  );

  const commitRespawnDuration = useCallback(
    (hoursRaw: string, minutesRaw: string) => {
      const parsedHours = parseNonNegativeInteger(hoursRaw) ?? 0;
      const parsedMinutes = parseNonNegativeInteger(minutesRaw) ?? 0;
      const normalizedTotalMinutes = Math.max(1, parsedHours * 60 + parsedMinutes);
      const normalizedHours = Math.floor(normalizedTotalMinutes / 60);
      const normalizedMinutes = normalizedTotalMinutes % 60;

      setRespawnHoursInput(String(normalizedHours));
      setRespawnMinutesInput(String(normalizedMinutes));
      onRespawnHoursMinutesChange(monster.id, normalizedHours, normalizedMinutes);
    },
    [monster.id, onRespawnHoursMinutesChange]
  );

  const handleRespawnHoursChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRespawnHoursInput(event.target.value);
  }, []);

  const handleRespawnMinutesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRespawnMinutesInput(event.target.value);
  }, []);

  const handleRespawnHoursFocus = useCallback(() => {
    setIsRespawnHoursEditing(true);
  }, []);

  const handleRespawnMinutesFocus = useCallback(() => {
    setIsRespawnMinutesEditing(true);
  }, []);

  const handleRespawnHoursBlur = useCallback(() => {
    setIsRespawnHoursEditing(false);
    commitRespawnDuration(respawnHoursInput, respawnMinutesInput);
  }, [commitRespawnDuration, respawnHoursInput, respawnMinutesInput]);

  const handleRespawnMinutesBlur = useCallback(() => {
    setIsRespawnMinutesEditing(false);
    commitRespawnDuration(respawnHoursInput, respawnMinutesInput);
  }, [commitRespawnDuration, respawnHoursInput, respawnMinutesInput]);

  const handleLastKilledChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      if (!value) {
        return;
      }
      onLastKilledChange(monster.id, localInputValueToIso(value));
    },
    [monster.id, onLastKilledChange]
  );

  const commitOffset = useCallback(
    (hoursRaw: string, minutesRaw: string) => {
      const parsedHours = parseSignedInteger(hoursRaw) ?? 0;
      const parsedMinutes = parseSignedInteger(minutesRaw) ?? 0;
      const normalizedTotalSeconds = convertHoursMinutesToSeconds(parsedHours, parsedMinutes);
      const normalized = convertSecondsToHoursMinutes(normalizedTotalSeconds);

      setOffsetHoursInput(String(normalized.hours));
      setOffsetMinutesInput(String(normalized.minutes));
      onOffsetHoursMinutesChange(monster.id, normalized.hours, normalized.minutes);
    },
    [monster.id, onOffsetHoursMinutesChange]
  );

  const handleOffsetHoursChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setOffsetHoursInput(event.target.value);
  }, []);

  const handleOffsetMinutesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setOffsetMinutesInput(event.target.value);
  }, []);

  const handleOffsetHoursFocus = useCallback(() => {
    setIsOffsetHoursEditing(true);
  }, []);

  const handleOffsetMinutesFocus = useCallback(() => {
    setIsOffsetMinutesEditing(true);
  }, []);

  const handleOffsetHoursBlur = useCallback(() => {
    setIsOffsetHoursEditing(false);
    commitOffset(offsetHoursInput, offsetMinutesInput);
  }, [commitOffset, offsetHoursInput, offsetMinutesInput]);

  const handleOffsetMinutesBlur = useCallback(() => {
    setIsOffsetMinutesEditing(false);
    commitOffset(offsetHoursInput, offsetMinutesInput);
  }, [commitOffset, offsetHoursInput, offsetMinutesInput]);

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

  const handleFocusCapture = useCallback(() => {
    onInteraction(monster.id);
  }, [monster.id, onInteraction]);

  const handleChangeCapture = useCallback(() => {
    onInteraction(monster.id);
  }, [monster.id, onInteraction]);

  const rowClassName = useMemo(() => {
    const classes: string[] = [];
    if (isReady) {
      classes.push("ready-row");
    }
    if (isInteractionHighlighted) {
      classes.push("interaction-locked");
    }
    return classes.join(" ") || undefined;
  }, [isInteractionHighlighted, isReady]);

  const offsetDisplay = useMemo(() => formatOffsetSeconds(monster.offsetSeconds ?? 0), [monster.offsetSeconds]);

  return (
    <tr
      className={rowClassName}
      onFocusCapture={handleFocusCapture}
      onChangeCapture={handleChangeCapture}
    >
      <td className="sticky-name-col">
        <input className="table-input" value={monster.name} onChange={handleNameChange} maxLength={80} />
      </td>
      <td>
        <div className="inline-offset-group">
          <input
            className="table-input table-num inline-offset-input"
            type="number"
            min={0}
            aria-label={`${monster.name} respawn hours`}
            value={respawnHoursInput}
            onChange={handleRespawnHoursChange}
            onFocus={handleRespawnHoursFocus}
            onBlur={handleRespawnHoursBlur}
          />
          <span className="offset-separator">h</span>
          <input
            className="table-input table-num inline-offset-input"
            type="number"
            min={0}
            aria-label={`${monster.name} respawn minutes`}
            value={respawnMinutesInput}
            onChange={handleRespawnMinutesChange}
            onFocus={handleRespawnMinutesFocus}
            onBlur={handleRespawnMinutesBlur}
          />
          <span className="offset-separator">m</span>
        </div>
      </td>
      <td>
        <input
          className="table-input"
          type="datetime-local"
          step={60}
          value={lastKilledLocal}
          onChange={handleLastKilledChange}
        />
      </td>
      <td>{offsetDisplay}</td>
      <td>{nextSpawnText}</td>
      <td className={isReady ? "ready" : undefined}>{formatCountdown(timeRemainingSeconds)}</td>
      <td>
        <div className="inline-offset-group">
          <input
            className="table-input table-num inline-offset-input"
            aria-label={`${monster.name} offset hours`}
            type="number"
            step={1}
            value={offsetHoursInput}
            onChange={handleOffsetHoursChange}
            onFocus={handleOffsetHoursFocus}
            onBlur={handleOffsetHoursBlur}
          />
          <span className="offset-separator">h</span>
          <input
            className="table-input table-num inline-offset-input"
            aria-label={`${monster.name} offset minutes`}
            type="number"
            step={1}
            value={offsetMinutesInput}
            onChange={handleOffsetMinutesChange}
            onFocus={handleOffsetMinutesFocus}
            onBlur={handleOffsetMinutesBlur}
          />
          <span className="offset-separator">m</span>
        </div>
      </td>
      <td>
        <div className="row-actions">
          <button type="button" onClick={handleResetNow}>
            Track
          </button>
          <button type="button" onClick={handleSetExact}>
            Set Exact
          </button>
          <button type="button" className="danger-btn" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
});
