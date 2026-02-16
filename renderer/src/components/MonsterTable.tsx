import {
  ChangeEvent,
  memo,
  MouseEvent as ReactMouseEvent,
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
} from "../types";
import { calculateNextSpawn, getSpawnState, MonsterSortOption } from "../utils/time";
import { MonsterRow } from "./MonsterRow";

type ReadyFilter = "all" | "ready" | "notReady";
type CategoryFilter = "all" | "none" | string;

const CATEGORY_FILTER_ALL = "all";
const CATEGORY_FILTER_NONE = "none";
const CATEGORY_FILTER_PREFIX = "category:";
const COLUMN_VISIBILITY_STORAGE_KEY = "mvpTracker.monsterTableColumnVisibility.v1";

const DEFAULT_COLUMN_VISIBILITY: MonsterTableColumnVisibility = {
  name: true,
  respawnDuration: true,
  lastKilled: true,
  offset: true,
  nextSpawnTime: true,
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

type MonsterTableProps = {
  monsters: Monster[];
  sortOption: MonsterSortOption;
  lockedOrderIds: string[];
  onSortOptionChange: (sortOption: MonsterSortOption) => void;
  onEditNameRequest: (id: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onInteraction: (id: string) => void;
  onRowEditingEnd: (id: string) => void;
  activeEditingMonsterId: string | null;
  isInteractionLocked: boolean;
  currentUserUid: string | null;
  categoryMap: Map<string, Category>;
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
  lockedOrderIds,
  onSortOptionChange,
  onEditNameRequest,
  onRespawnHoursMinutesChange,
  onLastKilledChange,
  onOffsetHoursMinutesChange,
  onResetNow,
  onDelete,
  onSetExact,
  onInteraction,
  onRowEditingEnd,
  activeEditingMonsterId,
  isInteractionLocked,
  currentUserUid,
  categoryMap,
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

  useEffect(() => {
    if (!selectedCategoryId) {
      return;
    }
    if (!categoryMap.has(selectedCategoryId)) {
      setCategoryFilter(CATEGORY_FILTER_ALL);
    }
  }, [categoryMap, selectedCategoryId]);

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
    return indexedMonsters.flatMap((indexedMonster) => {
      const { normalizedName, respawnHours } = indexedMonster;
      if (normalizedSearchTerm && !normalizedName.includes(normalizedSearchTerm)) {
        return [];
      }
      if (categoryFilter === CATEGORY_FILTER_NONE && indexedMonster.monster.categoryId !== null) {
        return [];
      }
      if (
        selectedCategoryId !== null &&
        indexedMonster.monster.categoryId !== selectedCategoryId
      ) {
        return [];
      }
      if (minRespawnHours !== null && respawnHours < minRespawnHours) {
        return [];
      }
      if (maxRespawnHours !== null && respawnHours > maxRespawnHours) {
        return [];
      }
      if (readyFilter === "all") {
        return [indexedMonster];
      }

      const isReady = getSpawnState(indexedMonster.nextSpawnMs, nowMs) === "ready";
      if (readyFilter === "ready" && isReady) {
        return [indexedMonster];
      }
      if (readyFilter === "notReady" && !isReady) {
        return [indexedMonster];
      }
      return [];
    });
  }, [
    indexedMonsters,
    maxRespawnHours,
    minRespawnHours,
    normalizedSearchTerm,
    nowMs,
    categoryFilter,
    readyFilter,
    selectedCategoryId,
  ]);

  const sortedMonsters = useMemo(() => {
    if (isInteractionLocked) {
      const byId = new Map(filteredMonsters.map((entry) => [entry.monster.id, entry]));
      const lockedSet = new Set<string>();
      const preserved = lockedOrderIds.flatMap((id) => {
        const entry = byId.get(id);
        if (!entry) {
          return [];
        }
        lockedSet.add(id);
        return [entry];
      });
      const appended = filteredMonsters.filter((entry) => !lockedSet.has(entry.monster.id));
      return [...preserved, ...appended];
    }

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
  }, [filteredMonsters, isInteractionLocked, lockedOrderIds, sortOption]);

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
            <span className="table-filter-select-wrap">
              <select className="table-filter-select" value={readyFilter} onChange={handleReadyFilterChange}>
                <option value="all">All</option>
                <option value="ready">Ready only</option>
                <option value="notReady">Not ready</option>
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((column) =>
                columnVisibility[column.key] ? (
                  <th key={column.key} className={column.key === "name" ? "sticky-name-col" : undefined}>
                    {column.label}
                  </th>
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {sortedMonsters.map(({ monster, nextSpawnMs }) => (
              <MonsterRow
                key={monster.id}
                monster={monster}
                nextSpawnMs={nextSpawnMs}
                nowMs={nowMs}
                categoryColor={monster.categoryId ? categoryMap.get(monster.categoryId)?.color : undefined}
                columnVisibility={columnVisibility}
                onEditNameRequest={onEditNameRequest}
                onRespawnHoursMinutesChange={onRespawnHoursMinutesChange}
                onLastKilledChange={onLastKilledChange}
                onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
                onResetNow={onResetNow}
                onDelete={onDelete}
                onSetExact={onSetExact}
                onInteraction={onInteraction}
                onRowEditingEnd={onRowEditingEnd}
                isInteractionHighlighted={
                  isInteractionLocked && activeEditingMonsterId === monster.id
                }
                currentUserUid={currentUserUid}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});
