import {
  ChangeEvent,
  memo,
  MouseEvent as ReactMouseEvent,
  UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import {
  Category,
  Monster,
  MonsterTableColumnKey,
  MonsterTableColumnVisibility,
  TrackedByUser,
} from "../types";
import { calculateNextSpawn, getSpawnState, MonsterSortOption, UPCOMING_WINDOW_MS } from "../utils/time";
import { MonsterRow } from "./MonsterRow";

type ReadyFilter = "all" | "allReady" | "readyNew" | "readyOld" | "upcoming" | "notReady";
type CategoryFilter = "all" | "none" | string;

const CATEGORY_FILTER_ALL = "all";
const CATEGORY_FILTER_NONE = "none";
const CATEGORY_FILTER_PREFIX = "category:";
const COLUMN_VISIBILITY_STORAGE_KEY = "mvpTracker.monsterTableColumnVisibility.v1";
const DEFAULT_VIRTUAL_ROW_HEIGHT = 44;
const VIRTUAL_OVERSCAN_ROWS = 8;

const DEFAULT_COLUMN_VISIBILITY: MonsterTableColumnVisibility = {
  name: true,
  respawnDuration: true,
  lastKilled: true,
  offset: true,
  nextSpawnTime: true,
  lastTrackedBy: true,
  timeRemaining: true,
  offsetEdit: true,
  actions: true,
};

const TABLE_COLUMNS: Array<{ key: MonsterTableColumnKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "respawnDuration", label: "Respawn Duration" },
  { key: "lastKilled", label: "Last Killed" },
  { key: "offset", label: "Offset" },
  { key: "nextSpawnTime", label: "Next Spawn Time" },
  { key: "lastTrackedBy", label: "Last Tracked By" },
  { key: "timeRemaining", label: "Time Remaining" },
  { key: "offsetEdit", label: "Offset Edit" },
  { key: "actions", label: "Actions" },
];

function getDefaultColumnVisibility(): MonsterTableColumnVisibility {
  return { ...DEFAULT_COLUMN_VISIBILITY };
}

function readColumnVisibilityFromStorage(): MonsterTableColumnVisibility {
  if (typeof window === "undefined") {
    return getDefaultColumnVisibility();
  }

  try {
    const stored = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!stored) {
      return getDefaultColumnVisibility();
    }

    const parsed = JSON.parse(stored) as Partial<Record<MonsterTableColumnKey, unknown>>;
    return {
      name: parsed.name !== false,
      respawnDuration: parsed.respawnDuration !== false,
      lastKilled: parsed.lastKilled !== false,
      offset: parsed.offset !== false,
      nextSpawnTime: parsed.nextSpawnTime !== false,
      lastTrackedBy: parsed.lastTrackedBy !== false,
      timeRemaining: parsed.timeRemaining !== false,
      offsetEdit: parsed.offsetEdit !== false,
      actions: parsed.actions !== false,
    };
  } catch {
    return getDefaultColumnVisibility();
  }
}

type IndexedMonster = {
  monster: Monster;
  normalizedName: string;
  respawnHours: number;
  nextSpawnMs: number;
  lastKilledMs: number;
};

type OffsetMinutesFocusRequest = {
  rowIndex: number;
  requestId: number;
};

const SORT_OPTIONS: Array<{ value: MonsterSortOption; label: string }> = [
  { value: "timeAsc", label: "Time Ascending" },
  { value: "timeDesc", label: "Time Descending" },
  { value: "nameAsc", label: "Name Ascending" },
  { value: "nameDesc", label: "Name Descending" },
  { value: "respawnAsc", label: "Respawn Duration Ascending" },
  { value: "respawnDesc", label: "Respawn Duration Descending" },
  { value: "lastKilledAsc", label: "Last Killed Ascending" },
  { value: "lastKilledDesc", label: "Last Killed Descending" },
];

function compareNumbers(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareIndexedMonsters(a: IndexedMonster, b: IndexedMonster, sortOption: MonsterSortOption): number {
  switch (sortOption) {
    case "timeAsc":
      return compareNumbers(a.nextSpawnMs, b.nextSpawnMs);
    case "timeDesc":
      return compareNumbers(b.nextSpawnMs, a.nextSpawnMs);
    case "nameAsc":
      return compareText(a.normalizedName, b.normalizedName);
    case "nameDesc":
      return compareText(b.normalizedName, a.normalizedName);
    case "respawnAsc":
      return compareNumbers(a.monster.respawnDuration, b.monster.respawnDuration);
    case "respawnDesc":
      return compareNumbers(b.monster.respawnDuration, a.monster.respawnDuration);
    case "lastKilledAsc":
      return compareNumbers(a.lastKilledMs, b.lastKilledMs);
    case "lastKilledDesc":
      return compareNumbers(b.lastKilledMs, a.lastKilledMs);
    default:
      return 0;
  }
}

function matchesReadyFilter(readyFilter: ReadyFilter, nextSpawnMs: number, nowMs: number): boolean {
  if (readyFilter === "all") {
    return true;
  }

  const timeRemainingMs = nextSpawnMs - nowMs;
  const spawnState = getSpawnState(nextSpawnMs, nowMs);

  switch (readyFilter) {
    case "allReady":
      return nextSpawnMs <= nowMs;
    case "readyNew":
      return spawnState === "ready";
    case "readyOld":
      return spawnState === "overdue";
    case "upcoming":
      return spawnState === "upcoming";
    case "notReady":
      return timeRemainingMs > UPCOMING_WINDOW_MS;
    default:
      return true;
  }
}

type MonsterTableProps = {
  monsters: Monster[];
  sortOption: MonsterSortOption;
  onCategoryFilterSelectionChange: (categoryId: string | null) => void;
  onSortOptionChange: (sortOption: MonsterSortOption) => void;
  onEditNameRequest: (id: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onNextSpawnTimeChange: (id: string, targetSpawnMs: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  focusedMonsterId: string | null;
  onFocusedMonsterChange: (id: string | null) => void;
  categoryMap: Map<string, Category>;
  trackedByUserMap: Map<string, TrackedByUser>;
  onOpenAddMonster: () => void;
  onOpenCategories: () => void;
};

function parseOptionalHours(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export const MonsterTable = memo(function MonsterTable({
  monsters,
  sortOption,
  onCategoryFilterSelectionChange,
  onSortOptionChange,
  onEditNameRequest,
  onRespawnHoursMinutesChange,
  onLastKilledChange,
  onNextSpawnTimeChange,
  onOffsetHoursMinutesChange,
  onResetNow,
  onDelete,
  onSetExact,
  focusedMonsterId,
  onFocusedMonsterChange,
  categoryMap,
  trackedByUserMap,
  onOpenAddMonster,
  onOpenCategories,
}: MonsterTableProps) {
  const nowMs = useGlobalNow();
  const [searchTerm, setSearchTerm] = useState("");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(CATEGORY_FILTER_ALL);
  const [minRespawnHoursInput, setMinRespawnHoursInput] = useState("");
  const [maxRespawnHoursInput, setMaxRespawnHoursInput] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<MonsterTableColumnVisibility>(() =>
    readColumnVisibilityFromStorage()
  );
  const [isColumnMenuOpen, setIsColumnMenuOpen] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const hasMeasuredVirtualRowHeightRef = useRef(false);
  const [firstVisibleRowIndex, setFirstVisibleRowIndex] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [virtualRowHeight, setVirtualRowHeight] = useState(DEFAULT_VIRTUAL_ROW_HEIGHT);
  const offsetMinutesFocusRequestIdRef = useRef(0);
  const lastHandledOffsetMinutesFocusRequestIdRef = useRef(0);
  const [offsetMinutesFocusRequest, setOffsetMinutesFocusRequest] =
    useState<OffsetMinutesFocusRequest | null>(null);

  const normalizedSearchTerm = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const minRespawnHours = useMemo(
    () => parseOptionalHours(minRespawnHoursInput),
    [minRespawnHoursInput]
  );
  const maxRespawnHours = useMemo(
    () => parseOptionalHours(maxRespawnHoursInput),
    [maxRespawnHoursInput]
  );
  const categoryFilterOptions = useMemo(
    () =>
      [...categoryMap.values()].map((category) => ({
        value: `${CATEGORY_FILTER_PREFIX}${category.id}`,
        label: category.name,
        color: category.color,
      })),
    [categoryMap]
  );
  const selectedCategoryId = useMemo(() => {
    if (!categoryFilter.startsWith(CATEGORY_FILTER_PREFIX)) {
      return null;
    }
    const next = categoryFilter.slice(CATEGORY_FILTER_PREFIX.length);
    return next || null;
  }, [categoryFilter]);
  const selectedCategoryTextColor = useMemo(() => {
    if (!selectedCategoryId) {
      return undefined;
    }
    return categoryMap.get(selectedCategoryId)?.color;
  }, [categoryMap, selectedCategoryId]);
  const readyFilterStateClassName = useMemo(() => {
    switch (readyFilter) {
      case "readyNew":
        return "state-ready";
      case "readyOld":
        return "state-overdue";
      case "upcoming":
        return "state-upcoming";
      default:
        return undefined;
    }
  }, [readyFilter]);
  const readyFilterSelectWrapClassName = useMemo(() => {
    const classes = ["table-filter-select-wrap", "ready-filter-select-wrap"];
    if (readyFilterStateClassName) {
      classes.push(readyFilterStateClassName);
    }
    return classes.join(" ");
  }, [readyFilterStateClassName]);
  const readyFilterSelectClassName = useMemo(() => {
    const classes = ["table-filter-select", "ready-filter-select"];
    if (readyFilterStateClassName) {
      classes.push(readyFilterStateClassName);
    }
    return classes.join(" ");
  }, [readyFilterStateClassName]);
  useEffect(() => {
    if (!selectedCategoryId) {
      return;
    }
    if (!categoryMap.has(selectedCategoryId)) {
      setCategoryFilter(CATEGORY_FILTER_ALL);
    }
  }, [categoryMap, selectedCategoryId]);

  useEffect(() => {
    onCategoryFilterSelectionChange(selectedCategoryId);
  }, [onCategoryFilterSelectionChange, selectedCategoryId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(columnVisibility));
    } catch {
      // Ignore storage failures so table rendering is never blocked.
    }
  }, [columnVisibility]);

  useEffect(() => {
    if (!isColumnMenuOpen) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!columnMenuRef.current?.contains(target)) {
        setIsColumnMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsColumnMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isColumnMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const unsubscribe = window.electronAPI?.onFocusOffsetMinutesByIndex?.((rowIndex) => {
      offsetMinutesFocusRequestIdRef.current += 1;
      setOffsetMinutesFocusRequest({
        rowIndex,
        requestId: offsetMinutesFocusRequestIdRef.current,
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const indexedMonsters = useMemo(
    () =>
      monsters.map((monster) => ({
        monster,
        normalizedName: monster.name.toLowerCase(),
        respawnHours: monster.respawnDuration / 3600,
        nextSpawnMs: calculateNextSpawn(monster),
        lastKilledMs: Date.parse(monster.lastKilledTimestamp),
      })),
    [monsters]
  );

  const filteredMonsters = useMemo(() => {
    const next: IndexedMonster[] = [];

    for (const indexedMonster of indexedMonsters) {
      const { normalizedName, respawnHours } = indexedMonster;
      if (normalizedSearchTerm && !normalizedName.includes(normalizedSearchTerm)) {
        continue;
      }
      if (categoryFilter === CATEGORY_FILTER_NONE && indexedMonster.monster.categoryId !== null) {
        continue;
      }
      if (
        selectedCategoryId !== null &&
        indexedMonster.monster.categoryId !== selectedCategoryId
      ) {
        continue;
      }
      if (minRespawnHours !== null && respawnHours < minRespawnHours) {
        continue;
      }
      if (maxRespawnHours !== null && respawnHours > maxRespawnHours) {
        continue;
      }
      if (matchesReadyFilter(readyFilter, indexedMonster.nextSpawnMs, nowMs)) {
        next.push(indexedMonster);
      }
    }

    return next;
  }, [
    indexedMonsters,
    maxRespawnHours,
    minRespawnHours,
    normalizedSearchTerm,
    categoryFilter,
    readyFilter,
    nowMs,
    selectedCategoryId,
  ]);

  const sortedMonsters = useMemo(() => {
    const next = [...filteredMonsters];
    next.sort((a, b) => {
      const compared = compareIndexedMonsters(a, b, sortOption);
      if (compared !== 0) {
        return compared;
      }
      const byName = compareText(a.normalizedName, b.normalizedName);
      if (byName !== 0) {
        return byName;
      }
      return a.monster.id.localeCompare(b.monster.id);
    });
    return next;
  }, [filteredMonsters, sortOption]);

  const visibleColumnCount = useMemo(
    () =>
      TABLE_COLUMNS.reduce((count, column) => {
        return columnVisibility[column.key] ? count + 1 : count;
      }, 0),
    [columnVisibility]
  );

  const virtualWindow = useMemo(() => {
    const totalRows = sortedMonsters.length;
    const safeRowHeight = Math.max(1, virtualRowHeight);
    const viewportRows = Math.max(
      1,
      Math.ceil((tableViewportHeight > 0 ? tableViewportHeight : safeRowHeight * 12) / safeRowHeight)
    );
    const clampedFirstVisibleIndex = Math.max(0, Math.min(firstVisibleRowIndex, totalRows));
    const startIndex = Math.max(0, clampedFirstVisibleIndex - VIRTUAL_OVERSCAN_ROWS);
    const endIndex = Math.min(totalRows, clampedFirstVisibleIndex + viewportRows + VIRTUAL_OVERSCAN_ROWS);

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * safeRowHeight,
      bottomSpacerHeight: Math.max(0, (totalRows - endIndex) * safeRowHeight),
    };
  }, [firstVisibleRowIndex, sortedMonsters.length, tableViewportHeight, virtualRowHeight]);

  const visibleMonsters = useMemo(
    () => sortedMonsters.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [sortedMonsters, virtualWindow.endIndex, virtualWindow.startIndex]
  );

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) {
      return;
    }

    const syncViewportHeight = () => {
      setTableViewportHeight(tableWrap.clientHeight);
    };

    syncViewportHeight();
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(syncViewportHeight);
      resizeObserver.observe(tableWrap);
    }
    window.addEventListener("resize", syncViewportHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncViewportHeight);
    };
  }, []);

  useEffect(() => {
    if (hasMeasuredVirtualRowHeightRef.current || sortedMonsters.length === 0) {
      return;
    }

    const tableWrap = tableWrapRef.current;
    if (!tableWrap) {
      return;
    }

    const firstRow = tableWrap.querySelector("tbody tr:not(.virtual-spacer-row)") as
      | HTMLTableRowElement
      | null;
    if (!firstRow) {
      return;
    }

    const measuredHeight = Math.round(firstRow.getBoundingClientRect().height);
    if (measuredHeight > 0) {
      hasMeasuredVirtualRowHeightRef.current = true;
      setVirtualRowHeight(measuredHeight);
    }
  }, [sortedMonsters.length]);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) {
      return;
    }

    const safeRowHeight = Math.max(1, virtualRowHeight);
    const maxScrollTop = Math.max(0, sortedMonsters.length * safeRowHeight - tableWrap.clientHeight);
    if (tableWrap.scrollTop > maxScrollTop) {
      tableWrap.scrollTop = maxScrollTop;
    }
    const clampedFirstVisibleIndex = Math.floor(tableWrap.scrollTop / safeRowHeight);
    setFirstVisibleRowIndex((current) =>
      current === clampedFirstVisibleIndex ? current : clampedFirstVisibleIndex
    );
  }, [sortedMonsters.length, virtualRowHeight]);

  useEffect(() => {
    if (!offsetMinutesFocusRequest) {
      return;
    }

    const { rowIndex, requestId } = offsetMinutesFocusRequest;
    if (lastHandledOffsetMinutesFocusRequestIdRef.current === requestId) {
      return;
    }
    lastHandledOffsetMinutesFocusRequestIdRef.current = requestId;

    if (rowIndex < 0 || rowIndex >= sortedMonsters.length) {
      return;
    }

    const tableWrap = tableWrapRef.current;
    if (!tableWrap) {
      return;
    }

    const safeRowHeight = Math.max(1, virtualRowHeight);
    const maxScrollTop = Math.max(0, sortedMonsters.length * safeRowHeight - tableWrap.clientHeight);
    const targetScrollTop = Math.max(0, Math.min(rowIndex * safeRowHeight, maxScrollTop));
    if (Math.abs(tableWrap.scrollTop - targetScrollTop) > 1) {
      tableWrap.scrollTop = targetScrollTop;
    }

    const clampedFirstVisibleIndex = Math.floor(tableWrap.scrollTop / safeRowHeight);
    setFirstVisibleRowIndex((current) =>
      current === clampedFirstVisibleIndex ? current : clampedFirstVisibleIndex
    );

    let frameId: number | null = null;
    let attempts = 0;
    const maxAttempts = 8;
    const selector = `input[data-offset-minutes-row-index="${rowIndex}"]`;

    const focusInput = () => {
      const offsetMinutesInput = tableWrap.querySelector(selector);
      if (offsetMinutesInput instanceof HTMLInputElement) {
        offsetMinutesInput.focus();
        offsetMinutesInput.select();
        return;
      }

      attempts += 1;
      if (attempts >= maxAttempts) {
        return;
      }
      frameId = window.requestAnimationFrame(focusInput);
    };

    frameId = window.requestAnimationFrame(focusInput);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [offsetMinutesFocusRequest, sortedMonsters.length, virtualRowHeight]);

  const handleSearchTermChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  }, []);

  const handleSortOptionChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    onSortOptionChange(event.target.value as MonsterSortOption);
  }, [onSortOptionChange]);

  const handleReadyFilterChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setReadyFilter(event.target.value as ReadyFilter);
  }, []);
  const handleCategoryFilterChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setCategoryFilter(event.target.value);
  }, []);

  const handleMinRespawnHoursChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setMinRespawnHoursInput(event.target.value);
  }, []);

  const handleMaxRespawnHoursChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setMaxRespawnHoursInput(event.target.value);
  }, []);

  const handleColumnMenuToggle = useCallback(() => {
    setIsColumnMenuOpen((current) => !current);
  }, []);

  const handleColumnMenuItemClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const columnKey = event.currentTarget.dataset.columnKey as MonsterTableColumnKey | undefined;
    if (!columnKey) {
      return;
    }
    setColumnVisibility((current) => ({
      ...current,
      [columnKey]: !current[columnKey],
    }));
  }, []);

  const handleTableScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const safeRowHeight = Math.max(1, virtualRowHeight);
    const nextFirstVisibleIndex = Math.floor(event.currentTarget.scrollTop / safeRowHeight);
    setFirstVisibleRowIndex((current) =>
      current === nextFirstVisibleIndex ? current : nextFirstVisibleIndex
    );
  }, [virtualRowHeight]);

  return (
    <section className="panel table-panel">
      <div className="table-panel-header">
        <h2>All Monsters</h2>
        <div className="table-panel-actions">
          <button
            type="button"
            className="table-panel-action-btn table-add-monster-btn"
            onClick={onOpenAddMonster}
          >
            Add Monster
          </button>
          <button
            type="button"
            className="table-panel-action-btn table-categories-btn"
            onClick={onOpenCategories}
          >
            Categories
          </button>
        </div>
      </div>
      <div className="table-filter-bar">
        <div className="table-filter-top-row">
          <label className="table-filter-field table-filter-search">
            <span>Search Name</span>
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchTermChange}
              placeholder="Search monsters..."
            />
          </label>
          <div className="table-column-menu" ref={columnMenuRef}>
            <button
              type="button"
              className="table-column-menu-trigger"
              onClick={handleColumnMenuToggle}
              aria-expanded={isColumnMenuOpen}
              aria-haspopup="true"
            >
              Toggle Columns
            </button>
            {isColumnMenuOpen ? (
              <div className="table-column-menu-popover" role="menu" aria-label="Toggle table columns">
                {TABLE_COLUMNS.map((column) => (
                  <button
                    key={column.key}
                    type="button"
                    className="table-column-menu-item"
                    data-column-key={column.key}
                    onClick={handleColumnMenuItemClick}
                    role="menuitemcheckbox"
                    aria-checked={columnVisibility[column.key]}
                  >
                    <span className="table-column-menu-check" aria-hidden="true">
                      {columnVisibility[column.key] ? "\u2713" : ""}
                    </span>
                    <span>{column.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="table-filter-options">
          <label className="table-filter-field">
            <span>Sort By</span>
            <span className="table-filter-select-wrap">
              <select className="table-filter-select" value={sortOption} onChange={handleSortOptionChange}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="table-filter-field">
            <span>Category</span>
            <span className="table-filter-select-wrap">
              <select
                className="table-filter-select"
                value={categoryFilter}
                onChange={handleCategoryFilterChange}
                style={selectedCategoryTextColor ? { color: selectedCategoryTextColor } : undefined}
              >
                <option value={CATEGORY_FILTER_ALL}>All</option>
                <option value={CATEGORY_FILTER_NONE}>None</option>
                {categoryFilterOptions.map((categoryOption) => (
                  <option
                    key={categoryOption.value}
                    value={categoryOption.value}
                    style={{ color: categoryOption.color }}
                  >
                    {categoryOption.label}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="table-filter-field">
            <span>READY State</span>
            <span className={readyFilterSelectWrapClassName}>
              <select className={readyFilterSelectClassName} value={readyFilter} onChange={handleReadyFilterChange}>
                <option value="all">All</option>
                <option value="allReady">All Ready</option>
                <option value="readyNew" style={{ color: "#bcecd6", backgroundColor: "#102319" }}>
                  Ready (New)
                </option>
                <option value="readyOld" style={{ color: "#c7d0db", backgroundColor: "#1a222d" }}>
                  Ready (Overdue)
                </option>
                <option value="upcoming" style={{ color: "#f1c183", backgroundColor: "#2b1e11" }}>
                  Upcoming
                </option>
                <option value="notReady">Not Ready</option>
              </select>
            </span>
          </label>

          <label className="table-filter-field">
            <span>Min Respawn (hours)</span>
            <input
              type="number"
              min={0}
              step={0.25}
              value={minRespawnHoursInput}
              onChange={handleMinRespawnHoursChange}
              placeholder="Optional"
            />
          </label>

          <label className="table-filter-field">
            <span>Max Respawn (hours)</span>
            <input
              type="number"
              min={0}
              step={0.25}
              value={maxRespawnHoursInput}
              onChange={handleMaxRespawnHoursChange}
              placeholder="Optional"
            />
          </label>
        </div>
      </div>

      <div ref={tableWrapRef} className="table-wrap" onScroll={handleTableScroll}>
        <table>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((column) =>
                columnVisibility[column.key] ? (
                  <th
                    key={column.key}
                    className={
                      [
                        column.key === "name" ? "sticky-name-col" : "",
                        column.key === "lastKilled" || column.key === "nextSpawnTime"
                          ? "table-col-datetime"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    {column.label}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {visibleColumnCount > 0 && virtualWindow.topSpacerHeight > 0 ? (
              <tr className="virtual-spacer-row" aria-hidden="true">
                <td colSpan={visibleColumnCount} style={{ height: `${virtualWindow.topSpacerHeight}px` }} />
              </tr>
            ) : null}
            {visibleMonsters.map(({ monster, nextSpawnMs }, visibleRowIndex) => (
              <MonsterRow
                key={monster.id}
                monster={monster}
                nextSpawnMs={nextSpawnMs}
                nowMs={nowMs}
                tableRowIndex={virtualWindow.startIndex + visibleRowIndex}
                categoryColor={monster.categoryId ? categoryMap.get(monster.categoryId)?.color : undefined}
                lastTrackedByUser={
                  monster.lastTrackedByUid
                    ? (trackedByUserMap.get(monster.lastTrackedByUid) ?? null)
                    : null
                }
                columnVisibility={columnVisibility}
                onEditNameRequest={onEditNameRequest}
                onRespawnHoursMinutesChange={onRespawnHoursMinutesChange}
                onLastKilledChange={onLastKilledChange}
                onNextSpawnTimeChange={onNextSpawnTimeChange}
                onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
                onResetNow={onResetNow}
                onDelete={onDelete}
                onSetExact={onSetExact}
                isFocusOutlined={focusedMonsterId === monster.id}
                onFocusedMonsterChange={onFocusedMonsterChange}
              />
            ))}
            {visibleColumnCount > 0 && virtualWindow.bottomSpacerHeight > 0 ? (
              <tr className="virtual-spacer-row" aria-hidden="true">
                <td
                  colSpan={visibleColumnCount}
                  style={{ height: `${virtualWindow.bottomSpacerHeight}px` }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
});
