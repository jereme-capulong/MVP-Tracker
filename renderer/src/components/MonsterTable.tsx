import { ChangeEvent, memo, useMemo, useState } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Category, Monster } from "../types";
import { calculateNextSpawn, getSpawnState, MonsterSortOption } from "../utils/time";
import { MonsterRow } from "./MonsterRow";

type ReadyFilter = "all" | "ready" | "notReady";

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
  activeEditingMonsterId: string | null;
  isInteractionLocked: boolean;
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
  activeEditingMonsterId,
  isInteractionLocked,
  categoryMap,
  onOpenAddMonster,
  onOpenCategories,
}: MonsterTableProps) {
  const nowMs = useGlobalNow();
  const [searchTerm, setSearchTerm] = useState("");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("all");
  const [minRespawnHoursInput, setMinRespawnHoursInput] = useState("");
  const [maxRespawnHoursInput, setMaxRespawnHoursInput] = useState("");

  const normalizedSearchTerm = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const minRespawnHours = useMemo(
    () => parseOptionalHours(minRespawnHoursInput),
    [minRespawnHoursInput]
  );
  const maxRespawnHours = useMemo(
    () => parseOptionalHours(maxRespawnHoursInput),
    [maxRespawnHoursInput]
  );

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
    readyFilter,
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

  const handleSearchTermChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const handleSortOptionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onSortOptionChange(event.target.value as MonsterSortOption);
  };

  const handleReadyFilterChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setReadyFilter(event.target.value as ReadyFilter);
  };

  const handleMinRespawnHoursChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMinRespawnHoursInput(event.target.value);
  };

  const handleMaxRespawnHoursChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMaxRespawnHoursInput(event.target.value);
  };

  return (
    <section className="panel table-panel">
      <div className="table-panel-header">
        <h2>All Monsters</h2>
        <div className="table-panel-actions">
          <button type="button" onClick={onOpenAddMonster}>
            Add Monster
          </button>
          <button type="button" onClick={onOpenCategories}>
            Categories
          </button>
        </div>
      </div>
      <div className="table-filter-bar">
        <label className="table-filter-field">
          <span>Sort By</span>
          <select value={sortOption} onChange={handleSortOptionChange}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="table-filter-field">
          <span>Search Name</span>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchTermChange}
            placeholder="Search monsters..."
          />
        </label>

        <label className="table-filter-field">
          <span>READY State</span>
          <select value={readyFilter} onChange={handleReadyFilterChange}>
            <option value="all">All</option>
            <option value="ready">Ready only</option>
            <option value="notReady">Not ready</option>
          </select>
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="sticky-name-col">Name</th>
              <th>Respawn Duration</th>
              <th>Last Killed</th>
              <th>Offset</th>
              <th>Next Spawn Time</th>
              <th>Time Remaining</th>
              <th>Offset Edit</th>
              <th>Actions</th>
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
                onEditNameRequest={onEditNameRequest}
                onRespawnHoursMinutesChange={onRespawnHoursMinutesChange}
                onLastKilledChange={onLastKilledChange}
                onOffsetHoursMinutesChange={onOffsetHoursMinutesChange}
                onResetNow={onResetNow}
                onDelete={onDelete}
                onSetExact={onSetExact}
                onInteraction={onInteraction}
                isInteractionHighlighted={
                  isInteractionLocked && activeEditingMonsterId === monster.id
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});
