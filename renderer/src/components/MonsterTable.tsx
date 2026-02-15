import { ChangeEvent, memo, useMemo, useState } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Monster } from "../types";
import { calculateNextSpawn, READY_BUFFER_MS } from "../utils/time";
import { MonsterRow } from "./MonsterRow";

type ReadyFilter = "all" | "ready" | "notReady";

type MonsterTableProps = {
  monsters: Monster[];
  onNameChange: (id: string, value: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  onInteraction: (id: string) => void;
  activeEditingMonsterId: string | null;
  isInteractionLocked: boolean;
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
  onNameChange,
  onRespawnHoursMinutesChange,
  onLastKilledChange,
  onOffsetHoursMinutesChange,
  onResetNow,
  onDelete,
  onSetExact,
  onInteraction,
  activeEditingMonsterId,
  isInteractionLocked,
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
      })),
    [monsters]
  );

  const staticFilteredMonsters = useMemo(() => {
    if (!normalizedSearchTerm && minRespawnHours === null && maxRespawnHours === null) {
      return monsters;
    }

    return indexedMonsters.flatMap(({ monster, normalizedName, respawnHours }) => {
      if (normalizedSearchTerm && !normalizedName.includes(normalizedSearchTerm)) {
        return [];
      }
      if (minRespawnHours !== null && respawnHours < minRespawnHours) {
        return [];
      }
      if (maxRespawnHours !== null && respawnHours > maxRespawnHours) {
        return [];
      }
      return [monster];
    });
  }, [indexedMonsters, maxRespawnHours, minRespawnHours, monsters, normalizedSearchTerm]);

  const readyFilteredMonsters = useMemo(() => {
    if (readyFilter === "all") {
      return staticFilteredMonsters;
    }

    return staticFilteredMonsters.flatMap((monster) => {
      const isReady = calculateNextSpawn(monster) - nowMs <= READY_BUFFER_MS;
      if (readyFilter === "ready" && isReady) {
        return [monster];
      }
      if (readyFilter === "notReady" && !isReady) {
        return [monster];
      }
      return [];
    });
  }, [nowMs, readyFilter, staticFilteredMonsters]);

  const handleSearchTermChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
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
      <h2>All Monsters</h2>
      <div className="table-filter-bar">
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
            {readyFilteredMonsters.map((monster) => (
              <MonsterRow
                key={monster.id}
                monster={monster}
                onNameChange={onNameChange}
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
