import { ChangeEvent, memo, useCallback, useEffect, useMemo, useState } from "react";
import { Monster, MonsterTableColumnVisibility } from "../types";
import {
  convertHoursMinutesToSeconds,
  convertSecondsToHoursMinutes,
  formatCountdown,
  formatDateTime,
  formatOffsetSeconds,
  getSpawnState,
  isoToLocalInputValue,
  localInputValueToIso,
} from "../utils/time";

type MonsterRowProps = {
  monster: Monster;
  nextSpawnMs: number;
  nowMs: number;
  onEditNameRequest: (id: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onInteraction: (id: string) => void;
  isInteractionHighlighted: boolean;
  categoryColor?: string;
  columnVisibility: MonsterTableColumnVisibility;
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
  nextSpawnMs,
  nowMs,
  onEditNameRequest,
  onRespawnHoursMinutesChange,
  onLastKilledChange,
  onOffsetHoursMinutesChange,
  onResetNow,
  onDelete,
  onSetExact,
  onInteraction,
  isInteractionHighlighted,
  categoryColor,
  columnVisibility,
}: MonsterRowProps) {
  const timeRemainingMs = nextSpawnMs - nowMs;
  const timeRemainingSeconds = Math.floor(timeRemainingMs / 1000);
  const spawnState = getSpawnState(nextSpawnMs, nowMs);
  const isReady = spawnState === "ready";

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

  const handleEditName = useCallback(() => {
    onInteraction(monster.id);
    onEditNameRequest(monster.id);
  }, [monster.id, onEditNameRequest, onInteraction]);

  const handleFocusCapture = useCallback(() => {
    onInteraction(monster.id);
  }, [monster.id, onInteraction]);

  const handleChangeCapture = useCallback(() => {
    onInteraction(monster.id);
  }, [monster.id, onInteraction]);

  const rowClassName = useMemo(() => {
    const classes: string[] = [];
    if (spawnState !== "normal") {
      classes.push(`state-${spawnState}`);
    }
    if (isInteractionHighlighted) {
      classes.push("interaction-locked");
    }
    return classes.join(" ") || undefined;
  }, [isInteractionHighlighted, spawnState]);
  const stickyNameCellClassName = useMemo(() => {
    const classes = ["sticky-name-col"];
    if (spawnState !== "normal") {
      classes.push(`state-${spawnState}`);
    }
    return classes.join(" ");
  }, [spawnState]);

  const offsetDisplay = useMemo(() => formatOffsetSeconds(monster.offsetSeconds ?? 0), [monster.offsetSeconds]);

  return (
    <tr
      className={rowClassName}
      onFocusCapture={handleFocusCapture}
      onChangeCapture={handleChangeCapture}
    >
      {columnVisibility.name ? (
        <td className={stickyNameCellClassName}>
          <div className="row-name-cell">
            <span className="row-name-text" style={categoryColor ? { color: categoryColor } : undefined}>
              {monster.name}
            </span>
            <button
              type="button"
              className="name-edit-btn"
              aria-label="Edit Name"
              title={`Edit name for ${monster.name}`}
              onClick={handleEditName}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M4 17.25V20h2.75L17.8 8.94l-2.75-2.75L4 17.25zm15.71-9.04a1.004 1.004 0 0 0 0-1.42l-2.5-2.5a1.004 1.004 0 0 0-1.42 0l-1.55 1.55 3.92 3.92 1.55-1.55z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </td>
      ) : null}
      {columnVisibility.respawnDuration ? (
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
      ) : null}
      {columnVisibility.lastKilled ? (
        <td>
          <input
            className="table-input"
            type="datetime-local"
            step={60}
            value={lastKilledLocal}
            onChange={handleLastKilledChange}
          />
        </td>
      ) : null}
      {columnVisibility.offset ? <td>{offsetDisplay}</td> : null}
      {columnVisibility.nextSpawnTime ? <td>{nextSpawnText}</td> : null}
      {columnVisibility.timeRemaining ? (
        <td className={isReady ? "ready" : undefined}>{formatCountdown(timeRemainingSeconds)}</td>
      ) : null}
      {columnVisibility.offsetEdit ? (
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
      ) : null}
      {columnVisibility.actions ? (
        <td>
          <div className="row-actions">
            <button type="button" className="btn-track" onClick={handleResetNow}>
              Track
            </button>
            <button type="button" className="btn-set-exact" onClick={handleSetExact}>
              Set Exact
            </button>
            <button type="button" className="danger-btn" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
});
