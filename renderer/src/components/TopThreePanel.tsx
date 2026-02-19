import {
  ChangeEvent,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  memo,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Category, Monster, TopCount, TrackedByUser } from "../types";
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
  onMonsterOffsetFocusChange: (id: string | null) => void;
  trackedByUserMap: Map<string, TrackedByUser>;
  categoryMap: Map<string, Category>;
};

type TopFiveCardProps = {
  monster: Monster;
  onTrack: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onMonsterOffsetFocusChange: (id: string | null) => void;
  lastTrackedByUser: TrackedByUser | null;
  categoryColor?: string;
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
  onMonsterOffsetFocusChange,
  lastTrackedByUser,
  categoryColor,
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
  const skipOffsetBlurCommitRef = useRef(false);
  const offsetHoursInputRef = useRef<HTMLInputElement | null>(null);
  const offsetMinutesInputRef = useRef<HTMLInputElement | null>(null);
  const offsetInputsRef = useRef<HTMLDivElement | null>(null);

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

  const handleTrackClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.detail > 0) {
        // Pointer-triggered click is already handled on mousedown.
        return;
      }
      onTrack(monster.id);
    },
    [monster.id, onTrack]
  );

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

  const handleOffsetInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      skipOffsetBlurCommitRef.current = true;
      const hoursRaw = offsetHoursInputRef.current?.value ?? offsetHoursInput;
      const minutesRaw = offsetMinutesInputRef.current?.value ?? offsetMinutesInput;
      commitOffset(hoursRaw, minutesRaw);
      event.currentTarget.blur();
      onTrack(monster.id);
    },
    [commitOffset, monster.id, offsetHoursInput, offsetMinutesInput, onTrack]
  );

  const handleHoursFocus = useCallback(() => {
    setIsOffsetHoursEditing(true);
    onMonsterOffsetFocusChange(monster.id);
  }, [monster.id, onMonsterOffsetFocusChange]);

  const handleMinutesFocus = useCallback(() => {
    setIsOffsetMinutesEditing(true);
    onMonsterOffsetFocusChange(monster.id);
  }, [monster.id, onMonsterOffsetFocusChange]);
  const clearMonsterFocusIfOffsetExited = useCallback(
    (event: ReactFocusEvent<HTMLInputElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && offsetInputsRef.current?.contains(nextTarget)) {
        return;
      }
      onMonsterOffsetFocusChange(null);
    },
    [onMonsterOffsetFocusChange]
  );

  const handleHoursBlur = useCallback((event: ReactFocusEvent<HTMLInputElement>) => {
    setIsOffsetHoursEditing(false);
    clearMonsterFocusIfOffsetExited(event);

    if (skipOffsetBlurCommitRef.current) {
      skipOffsetBlurCommitRef.current = false;
      return;
    }

    const hoursRaw = offsetHoursInputRef.current?.value ?? offsetHoursInput;
    const minutesRaw = offsetMinutesInputRef.current?.value ?? offsetMinutesInput;
    commitOffset(hoursRaw, minutesRaw);
  }, [
    clearMonsterFocusIfOffsetExited,
    commitOffset,
    offsetHoursInput,
    offsetMinutesInput,
  ]);

  const handleMinutesBlur = useCallback((event: ReactFocusEvent<HTMLInputElement>) => {
    setIsOffsetMinutesEditing(false);
    clearMonsterFocusIfOffsetExited(event);

    if (skipOffsetBlurCommitRef.current) {
      skipOffsetBlurCommitRef.current = false;
      return;
    }

    const hoursRaw = offsetHoursInputRef.current?.value ?? offsetHoursInput;
    const minutesRaw = offsetMinutesInputRef.current?.value ?? offsetMinutesInput;
    commitOffset(hoursRaw, minutesRaw);
  }, [
    clearMonsterFocusIfOffsetExited,
    commitOffset,
    offsetHoursInput,
    offsetMinutesInput,
  ]);

  const handleTrackMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      skipOffsetBlurCommitRef.current = true;
      onTrack(monster.id);
      const hoursRaw = offsetHoursInputRef.current?.value ?? offsetHoursInput;
      const minutesRaw = offsetMinutesInputRef.current?.value ?? offsetMinutesInput;
      commitOffset(hoursRaw, minutesRaw);
    },
    [commitOffset, monster.id, offsetHoursInput, offsetMinutesInput, onTrack]
  );

  const className = useMemo(() => {
    const classes = ["upcoming-card"];
    if (isReady) {
      classes.push("ready-card");
    }
    return classes.join(" ");
  }, [isReady]);
  const trackedByName = useMemo(() => {
    const trimmed = lastTrackedByUser?.nickname.trim() ?? "";
    return trimmed || "-";
  }, [lastTrackedByUser?.nickname]);
  const hasTrackedByInfo = Boolean(monster.lastTrackedByUid && lastTrackedByUser && trackedByName !== "-");
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
      <div className="upcoming-name" style={categoryColor ? { color: categoryColor } : undefined}>
        {monster.name}
      </div>
      <div className={`upcoming-countdown ${isReady ? "ready" : ""}`}>{formatCountdown(timeRemainingSeconds)}</div>
      <div className="upcoming-spawn">{spawnText}</div>

      <div className="card-actions-grid">
        <button
          type="button"
          className="btn-track"
          onMouseDown={handleTrackMouseDown}
          onClick={handleTrackClick}
        >
          Track
        </button>
        <button type="button" className="btn-set-exact" onClick={handleSetExact}>
          Set Exact
        </button>
      </div>

      <div ref={offsetInputsRef} className="card-offset-inline">
        <input
          ref={offsetHoursInputRef}
          className="table-input table-num inline-offset-input"
          type="number"
          step={1}
          aria-label={`${monster.name} top card offset hours`}
          value={offsetHoursInput}
          onChange={handleHoursChange}
          onFocus={handleHoursFocus}
          onBlur={handleHoursBlur}
          onKeyDown={handleOffsetInputKeyDown}
        />
        <span className="offset-separator">h</span>
        <input
          ref={offsetMinutesInputRef}
          className="table-input table-num inline-offset-input"
          type="number"
          step={1}
          aria-label={`${monster.name} top card offset minutes`}
          value={offsetMinutesInput}
          onChange={handleMinutesChange}
          onFocus={handleMinutesFocus}
          onBlur={handleMinutesBlur}
          onKeyDown={handleOffsetInputKeyDown}
        />
        <span className="offset-separator">m</span>
      </div>
      <div className="card-tracked-by" title={`last tracked by: ${trackedByName}`}>
        <span className="card-tracked-by-label">last tracked by:</span>
        {hasTrackedByInfo ? (
          <span className="card-tracked-by-user">
            {lastTrackedByUser?.photoURL ? (
              <img className="tracked-by-avatar" src={lastTrackedByUser.photoURL} alt="" aria-hidden="true" />
            ) : (
              <span className="tracked-by-avatar tracked-by-avatar-fallback" aria-hidden="true">
                {trackedByInitial}
              </span>
            )}
            <span className="card-tracked-by-name">{trackedByName}</span>
          </span>
        ) : (
          <span className="card-tracked-by-name">-</span>
        )}
      </div>
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
  onMonsterOffsetFocusChange,
  trackedByUserMap,
  categoryMap,
}: TopFivePanelProps) {
  const topThreeGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const topThreeGrid = topThreeGridRef.current;
    if (!topThreeGrid) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      const maxScrollLeft = topThreeGrid.scrollWidth - topThreeGrid.clientWidth;
      if (maxScrollLeft <= 0) {
        return;
      }

      const nextScrollLeft = Math.max(0, Math.min(topThreeGrid.scrollLeft + event.deltaY, maxScrollLeft));
      if (nextScrollLeft === topThreeGrid.scrollLeft) {
        return;
      }

      topThreeGrid.scrollLeft = nextScrollLeft;
      event.preventDefault();
    };

    topThreeGrid.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      topThreeGrid.removeEventListener("wheel", handleWheel);
    };
  }, []);

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
      <div ref={topThreeGridRef} className="top-three-grid">
        {monsters.map((monster) => (
          <TopFiveCard
            key={monster.id}
            monster={monster}
            onTrack={onTrack}
            onDelete={onDelete}
            onSetExact={onSetExact}
            onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
            onMonsterOffsetFocusChange={onMonsterOffsetFocusChange}
            lastTrackedByUser={
              monster.lastTrackedByUid
                ? (trackedByUserMap.get(monster.lastTrackedByUid) ?? null)
                : null
            }
            categoryColor={monster.categoryId ? categoryMap.get(monster.categoryId)?.color : undefined}
          />
        ))}
      </div>
    </section>
  );
});
