import {
  ChangeEvent,
  FocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EDIT_LOCK_TIMEOUT_MS, Monster, MonsterTableColumnVisibility } from "../types";
import {
  convertHoursMinutesToSeconds,
  convertSecondsToHoursMinutes,
  formatCountdown,
  formatDateTime,
  formatOffsetSeconds,
  getSpawnState,
  isoToLocalInputValue,
  localInputValueToMs,
  localInputValueToIso,
} from "../utils/time";

type MonsterRowProps = {
  monster: Monster;
  nextSpawnMs: number;
  nowMs: number;
  onEditNameRequest: (id: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onNextSpawnTimeChange: (id: string, targetSpawnMs: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onInteraction: (id: string) => void;
  onRowEditingEnd: (id: string) => void;
  isInteractionHighlighted: boolean;
  currentUserUid: string | null;
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
  onNextSpawnTimeChange,
  onOffsetHoursMinutesChange,
  onResetNow,
  onDelete,
  onSetExact,
  onInteraction,
  onRowEditingEnd,
  isInteractionHighlighted,
  currentUserUid,
  categoryColor,
  columnVisibility,
}: MonsterRowProps) {
  const timeRemainingMs = nextSpawnMs - nowMs;
  const timeRemainingSeconds = Math.floor(timeRemainingMs / 1000);
  const spawnState = getSpawnState(nextSpawnMs, nowMs);
  const isReady = spawnState === "ready";
  const hasEditLock = monster.editingByUid !== null;
  const isLockExpired =
    hasEditLock &&
    monster.editingStartedAtMs !== null &&
    nowMs - monster.editingStartedAtMs > EDIT_LOCK_TIMEOUT_MS;
  const isLockedByAnotherUser =
    hasEditLock && !isLockExpired && monster.editingByUid !== currentUserUid;
  const lockBadgeText = isLockedByAnotherUser && monster.editingBy ? `Editing: ${monster.editingBy}` : null;
  const rowRef = useRef<HTMLTableRowElement | null>(null);

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
  const nextSpawnLocal = useMemo(
    () => isoToLocalInputValue(new Date(nextSpawnMs).toISOString()),
    [nextSpawnMs]
  );
  const nextSpawnText = useMemo(() => formatDateTime(nextSpawnMs), [nextSpawnMs]);

  const [respawnHoursInput, setRespawnHoursInput] = useState(() => String(respawnParts.hours));
  const [respawnMinutesInput, setRespawnMinutesInput] = useState(() => String(respawnParts.minutes));
  const [offsetHoursInput, setOffsetHoursInput] = useState(() => String(offsetParts.hours));
  const [offsetMinutesInput, setOffsetMinutesInput] = useState(() => String(offsetParts.minutes));
  const [nextSpawnInput, setNextSpawnInput] = useState(() => nextSpawnLocal);

  const [isRespawnHoursEditing, setIsRespawnHoursEditing] = useState(false);
  const [isRespawnMinutesEditing, setIsRespawnMinutesEditing] = useState(false);
  const [isOffsetHoursEditing, setIsOffsetHoursEditing] = useState(false);
  const [isOffsetMinutesEditing, setIsOffsetMinutesEditing] = useState(false);
  const [isNextSpawnEditing, setIsNextSpawnEditing] = useState(false);
  const previousRespawnPartsRef = useRef(respawnParts);
  const previousOffsetPartsRef = useRef(offsetParts);
  const previousNextSpawnLocalRef = useRef(nextSpawnLocal);
  const skipNextSpawnCommitRef = useRef(false);

  useEffect(() => {
    const previous = previousRespawnPartsRef.current;
    const didServerRespawnChange =
      previous.hours !== respawnParts.hours || previous.minutes !== respawnParts.minutes;

    if (!isRespawnHoursEditing && didServerRespawnChange) {
      setRespawnHoursInput(String(respawnParts.hours));
    }
    if (!isRespawnMinutesEditing && didServerRespawnChange) {
      setRespawnMinutesInput(String(respawnParts.minutes));
    }
    previousRespawnPartsRef.current = respawnParts;
  }, [isRespawnHoursEditing, isRespawnMinutesEditing, respawnParts.hours, respawnParts.minutes]);

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

  useEffect(() => {
    const previous = previousNextSpawnLocalRef.current;
    const didServerNextSpawnChange = previous !== nextSpawnLocal;
    if (!isNextSpawnEditing && didServerNextSpawnChange) {
      setNextSpawnInput(nextSpawnLocal);
    }
    previousNextSpawnLocalRef.current = nextSpawnLocal;
  }, [isNextSpawnEditing, nextSpawnLocal]);

  useEffect(() => {
    return () => {
      onRowEditingEnd(monster.id);
    };
  }, [monster.id, onRowEditingEnd]);

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
    if (isLockedByAnotherUser) {
      return;
    }
    onInteraction(monster.id);
    onResetNow(monster.id);
  }, [isLockedByAnotherUser, monster.id, onInteraction, onResetNow]);

  const handleDelete = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    onInteraction(monster.id);
    onDelete(monster.id);
  }, [isLockedByAnotherUser, monster.id, onDelete, onInteraction]);

  const handleSetExact = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    onInteraction(monster.id);
    onSetExact(monster.id);
  }, [isLockedByAnotherUser, monster.id, onInteraction, onSetExact]);

  const handleEditName = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    onInteraction(monster.id);
    onEditNameRequest(monster.id);
  }, [isLockedByAnotherUser, monster.id, onEditNameRequest, onInteraction]);

  const handleFocusCapture = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    onInteraction(monster.id);
  }, [isLockedByAnotherUser, monster.id, onInteraction]);

  const handleChangeCapture = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    onInteraction(monster.id);
  }, [isLockedByAnotherUser, monster.id, onInteraction]);

  const handleBlurCapture = useCallback(
    (event: FocusEvent<HTMLTableRowElement>) => {
      if (isLockedByAnotherUser) {
        return;
      }

      const nextFocused = event.relatedTarget;
      if (nextFocused instanceof Node && rowRef.current?.contains(nextFocused)) {
        return;
      }

      onRowEditingEnd(monster.id);
    },
    [isLockedByAnotherUser, monster.id, onRowEditingEnd]
  );

  const commitNextSpawnTime = useCallback(
    (nextSpawnLocalInput: string) => {
      const targetSpawnMs = localInputValueToMs(nextSpawnLocalInput);
      if (targetSpawnMs === null) {
        setNextSpawnInput(nextSpawnLocal);
        onRowEditingEnd(monster.id);
        return;
      }

      setNextSpawnInput(isoToLocalInputValue(new Date(targetSpawnMs).toISOString()));
      onNextSpawnTimeChange(monster.id, targetSpawnMs);
    },
    [monster.id, nextSpawnLocal, onNextSpawnTimeChange, onRowEditingEnd]
  );

  const handleNextSpawnChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setNextSpawnInput(event.target.value);
  }, []);

  const handleNextSpawnFocus = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    setIsNextSpawnEditing(true);
    onInteraction(monster.id);
  }, [isLockedByAnotherUser, monster.id, onInteraction]);

  const handleNextSpawnBlur = useCallback(() => {
    setIsNextSpawnEditing(false);

    if (skipNextSpawnCommitRef.current) {
      skipNextSpawnCommitRef.current = false;
      return;
    }

    commitNextSpawnTime(nextSpawnInput);
  }, [commitNextSpawnTime, nextSpawnInput]);

  const handleNextSpawnKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        skipNextSpawnCommitRef.current = true;
        setNextSpawnInput(nextSpawnLocal);
        setIsNextSpawnEditing(false);
        onRowEditingEnd(monster.id);
        event.currentTarget.blur();
      }
    },
    [monster.id, nextSpawnLocal, onRowEditingEnd]
  );

  const handleMouseLeave = useCallback(() => {
    if (isLockedByAnotherUser) {
      return;
    }
    onRowEditingEnd(monster.id);
  }, [isLockedByAnotherUser, monster.id, onRowEditingEnd]);

  const rowClassName = useMemo(() => {
    const classes: string[] = [];
    if (spawnState !== "normal") {
      classes.push(`state-${spawnState}`);
    }
    if (isInteractionHighlighted) {
      classes.push("interaction-locked");
    }
    if (isLockedByAnotherUser) {
      classes.push("editing-locked-other");
    }
    return classes.join(" ") || undefined;
  }, [isInteractionHighlighted, isLockedByAnotherUser, spawnState]);
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
      ref={rowRef}
      className={rowClassName}
      onFocusCapture={handleFocusCapture}
      onChangeCapture={handleChangeCapture}
      onBlurCapture={handleBlurCapture}
      onMouseLeave={handleMouseLeave}
    >
      {columnVisibility.name ? (
        <td className={stickyNameCellClassName}>
          <div className="row-name-cell">
            <span className="row-name-text" style={categoryColor ? { color: categoryColor } : undefined}>
              {monster.name}
            </span>
            {lockBadgeText ? <span className="editing-badge">{lockBadgeText}</span> : null}
            <button
              type="button"
              className="name-edit-btn"
              aria-label="Edit Name"
              title={`Edit name for ${monster.name}`}
              onClick={handleEditName}
              disabled={isLockedByAnotherUser}
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
              disabled={isLockedByAnotherUser}
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
              disabled={isLockedByAnotherUser}
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
            disabled={isLockedByAnotherUser}
          />
        </td>
      ) : null}
      {columnVisibility.offset ? <td>{offsetDisplay}</td> : null}
      {columnVisibility.nextSpawnTime ? (
        <td title={nextSpawnText}>
          <input
            className="table-input"
            type="datetime-local"
            step={60}
            value={nextSpawnInput}
            onChange={handleNextSpawnChange}
            onFocus={handleNextSpawnFocus}
            onBlur={handleNextSpawnBlur}
            onKeyDown={handleNextSpawnKeyDown}
            disabled={isLockedByAnotherUser}
          />
        </td>
      ) : null}
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
              disabled={isLockedByAnotherUser}
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
              disabled={isLockedByAnotherUser}
            />
            <span className="offset-separator">m</span>
          </div>
        </td>
      ) : null}
      {columnVisibility.actions ? (
        <td>
          <div className="row-actions">
            <button type="button" className="btn-track" onClick={handleResetNow} disabled={isLockedByAnotherUser}>
              Track
            </button>
            <button type="button" className="btn-set-exact" onClick={handleSetExact} disabled={isLockedByAnotherUser}>
              Set Exact
            </button>
            <button type="button" className="danger-btn" onClick={handleDelete} disabled={isLockedByAnotherUser}>
              Delete
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
});
