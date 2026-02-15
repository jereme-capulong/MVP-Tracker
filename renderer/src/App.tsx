import { useCallback, useEffect, useMemo, useState } from "react";
import { AddMonsterForm } from "./components/AddMonsterForm";
import { ConfirmModal } from "./components/ConfirmModal";
import { MonsterTable } from "./components/MonsterTable";
import { ReadyNotificationManager } from "./components/ReadyNotificationManager";
import { SetExactModal } from "./components/SetExactModal";
import { TopControlsBar } from "./components/TopControlsBar";
import { TopFivePanel } from "./components/TopThreePanel";
import { useInteractionLock } from "./hooks/useInteractionLock";
import { Monster, MonsterInput, SetExactMode, TopCount } from "./types";
import {
  calculateLastKilledTimestampForTargetSpawn,
  calculateNextSpawn,
  calculateSetExactTargetSpawnMs,
  clearMonsters,
  convertHoursMinutesToSeconds,
  loadMonsters,
  loadSoundEnabled,
  loadTopCount,
  loadViewMode,
  makeMonster,
  saveMonsters,
  saveSoundEnabled,
  saveTopCount,
  saveViewMode,
  ViewMode,
} from "./utils/time";

type InteractionSurface = "table" | "top5";

function parseImportCsv(csvText: string, lastKilledTimestamp: string): Monster[] {
  const imported: Monster[] = [];
  const lines = csvText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const cells = line.split(",");
    if (cells.length < 2) {
      continue;
    }

    const name = cells[0].trim();
    const respawnMinutesRaw = cells[1].trim();

    if (
      name.toLowerCase() === "name" &&
      respawnMinutesRaw.toLowerCase() === "respawnminutes"
    ) {
      continue;
    }

    const respawnMinutes = Number(respawnMinutesRaw);
    if (!name || !Number.isFinite(respawnMinutes) || respawnMinutes <= 0) {
      continue;
    }

    imported.push(makeMonster(name, respawnMinutes, lastKilledTimestamp));
  }

  return imported;
}

export function App() {
  // Monsters are kept in one top-level state store to keep updates predictable.
  const [monsters, setMonsters] = useState<Monster[]>(() => loadMonsters());
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const [pendingDeleteMonsterId, setPendingDeleteMonsterId] = useState<string | null>(null);
  const [setExactMonsterId, setSetExactMonsterId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadSoundEnabled());
  const [topCount, setTopCount] = useState<TopCount>(() => loadTopCount());
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadViewMode());
  const [activeEditingMonsterId, setActiveEditingMonsterId] = useState<string | null>(null);
  const [activeInteractionSurface, setActiveInteractionSurface] = useState<InteractionSurface | null>(null);

  const sortedMonsters = useMemo(
    () => [...monsters].sort((a, b) => calculateNextSpawn(a) - calculateNextSpawn(b)),
    [monsters]
  );
  const sortedMonsterIds = useMemo(() => sortedMonsters.map((monster) => monster.id), [sortedMonsters]);
  const liveMonsterIds = useMemo(() => monsters.map((monster) => monster.id), [monsters]);
  const monsterById = useMemo(
    () => new Map(monsters.map((monster) => [monster.id, monster])),
    [monsters]
  );
  const pendingDeleteMonster = useMemo(
    () =>
      pendingDeleteMonsterId ? (monsterById.get(pendingDeleteMonsterId) ?? null) : null,
    [monsterById, pendingDeleteMonsterId]
  );
  const setExactMonster = useMemo(
    () => (setExactMonsterId ? (monsterById.get(setExactMonsterId) ?? null) : null),
    [monsterById, setExactMonsterId]
  );

  const { isInteractionLocked, lockedOrderIds, triggerInteractionLock } = useInteractionLock({
    sortedIds: sortedMonsterIds,
    liveIds: liveMonsterIds,
  });

  useEffect(() => {
    if (isInteractionLocked) {
      return;
    }
    setActiveEditingMonsterId(null);
    setActiveInteractionSurface(null);
  }, [isInteractionLocked]);

  useEffect(() => {
    if (pendingDeleteMonsterId && !monsterById.has(pendingDeleteMonsterId)) {
      setPendingDeleteMonsterId(null);
    }
    if (setExactMonsterId && !monsterById.has(setExactMonsterId)) {
      setSetExactMonsterId(null);
    }
  }, [monsterById, pendingDeleteMonsterId, setExactMonsterId]);

  const visualOrderIds = useMemo(() => {
    if (!isInteractionLocked) {
      return sortedMonsterIds;
    }

    const lockedSet = new Set(lockedOrderIds);
    const preserved = lockedOrderIds.filter((id) => monsterById.has(id));
    const appended = sortedMonsterIds.filter((id) => !lockedSet.has(id));

    return [...preserved, ...appended];
  }, [isInteractionLocked, lockedOrderIds, monsterById, sortedMonsterIds]);

  const renderedMonsters = useMemo(
    () =>
      visualOrderIds.flatMap((id) => {
        const monster = monsterById.get(id);
        return monster ? [monster] : [];
      }),
    [monsterById, visualOrderIds]
  );

  const unlockedTopMonsters = useMemo(() => sortedMonsters.slice(0, topCount), [sortedMonsters, topCount]);
  const topMonsters = useMemo(
    () => (isInteractionLocked ? renderedMonsters.slice(0, topCount) : unlockedTopMonsters),
    [isInteractionLocked, renderedMonsters, topCount, unlockedTopMonsters]
  );

  const updateAndPersist = useCallback((updater: (prev: Monster[]) => Monster[]) => {
    setMonsters((prev) => {
      const next = updater(prev);
      saveMonsters(next);
      return next;
    });
  }, []);

  const updateMonsterById = useCallback(
    (id: string, updater: (monster: Monster) => Monster) => {
      updateAndPersist((prev) => {
        let changed = false;
        const next = prev.map((monster) => {
          if (monster.id !== id) {
            return monster;
          }
          const updated = updater(monster);
          if (updated !== monster) {
            changed = true;
          }
          return updated;
        });
        return changed ? next : prev;
      });
    },
    [updateAndPersist]
  );

  const handleCreateMonster = useCallback(
    (input: MonsterInput) => {
      const created = makeMonster(input.name, input.respawnDurationMinutes, input.lastKilledTimestamp);
      updateAndPersist((prev) => [...prev, created]);
    },
    [updateAndPersist]
  );

  const handleNameChange = useCallback(
    (id: string, value: string) => {
      updateMonsterById(id, (monster) =>
        monster.name === value ? monster : { ...monster, name: value }
      );
    },
    [updateMonsterById]
  );

  const handleRespawnHoursMinutesChange = useCallback(
    (id: string, hours: number, minutes: number) => {
      const safeHours = Math.max(0, Math.trunc(hours));
      const safeMinutes = Math.max(0, Math.trunc(minutes));
      const respawnDuration = Math.max(60, safeHours * 3600 + safeMinutes * 60);
      updateMonsterById(id, (monster) =>
        monster.respawnDuration === respawnDuration
          ? monster
          : { ...monster, respawnDuration, hasNotifiedReady: false }
      );
    },
    [updateMonsterById]
  );

  const handleLastKilledChange = useCallback(
    (id: string, iso: string) => {
      updateMonsterById(id, (monster) =>
        monster.lastKilledTimestamp === iso
          ? monster
          : { ...monster, lastKilledTimestamp: iso, hasNotifiedReady: false }
      );
    },
    [updateMonsterById]
  );

  const handleOffsetHoursMinutesChange = useCallback(
    (id: string, hours: number, minutes: number) => {
      const offsetSeconds = convertHoursMinutesToSeconds(hours, minutes);
      updateMonsterById(id, (monster) =>
        (monster.offsetSeconds ?? 0) === offsetSeconds
          ? monster
          : { ...monster, offsetSeconds, hasNotifiedReady: false }
      );
    },
    [updateMonsterById]
  );

  const handleTableInteraction = useCallback(
    (id: string) => {
      setActiveEditingMonsterId(id);
      setActiveInteractionSurface("table");
      triggerInteractionLock();
    },
    [triggerInteractionLock]
  );

  const handleTopFiveInteraction = useCallback(
    (id: string) => {
      setActiveEditingMonsterId(id);
      setActiveInteractionSurface("top5");
      triggerInteractionLock();
    },
    [triggerInteractionLock]
  );

  const handleAdjustOffset = useCallback(
    (id: string, deltaSeconds: number) => {
      updateMonsterById(id, (monster) => {
        const offsetSeconds = (monster.offsetSeconds ?? 0) + deltaSeconds;
        return { ...monster, offsetSeconds, hasNotifiedReady: false };
      });
    },
    [updateMonsterById]
  );

  const handleResetNow = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      updateMonsterById(id, (monster) => ({
        ...monster,
        lastKilledTimestamp: nowIso,
        hasNotifiedReady: false,
      }));
    },
    [updateMonsterById]
  );

  const handleDeleteMonsterRequest = useCallback((id: string) => {
    setPendingDeleteMonsterId(id);
  }, []);

  const handleDeleteMonsterCancel = useCallback(() => {
    setPendingDeleteMonsterId(null);
  }, []);

  const handleDeleteMonsterConfirm = useCallback(() => {
    if (!pendingDeleteMonsterId) {
      return;
    }

    triggerInteractionLock();
    updateAndPersist((prev) => prev.filter((monster) => monster.id !== pendingDeleteMonsterId));
    setPendingDeleteMonsterId(null);
  }, [pendingDeleteMonsterId, triggerInteractionLock, updateAndPersist]);

  const handleSetExactRequest = useCallback((id: string) => {
    setSetExactMonsterId(id);
  }, []);

  const handleSetExactCancel = useCallback(() => {
    setSetExactMonsterId(null);
  }, []);

  const handleSetExactConfirm = useCallback(
    (hours: number, minutes: number, mode: SetExactMode) => {
      if (!setExactMonsterId) {
        return;
      }

      const nowMs = Date.now();

      triggerInteractionLock();
      updateMonsterById(setExactMonsterId, (monster) => {
        const targetSpawnMs = calculateSetExactTargetSpawnMs(mode, hours, minutes, nowMs);
        const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
          monster,
          targetSpawnMs
        );

        if (
          monster.lastKilledTimestamp === nextLastKilledTimestamp &&
          !monster.hasNotifiedReady
        ) {
          return monster;
        }

        return {
          ...monster,
          lastKilledTimestamp: nextLastKilledTimestamp,
          hasNotifiedReady: false,
        };
      });

      setSetExactMonsterId(null);
    },
    [setExactMonsterId, triggerInteractionLock, updateMonsterById]
  );

  const handleMarkReadyNotified = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      updateAndPersist((prev) => {
        let changed = false;
        const next = prev.map((monster) => {
          if (!idSet.has(monster.id) || monster.hasNotifiedReady) {
            return monster;
          }
          changed = true;
          return { ...monster, hasNotifiedReady: true };
        });
        return changed ? next : prev;
      });
    },
    [updateAndPersist]
  );

  const handleResetAll = useCallback(() => {
    const nowIso = new Date().toISOString();
    updateAndPersist((prev) =>
      prev.map((monster) => ({
        ...monster,
        lastKilledTimestamp: nowIso,
        offsetSeconds: 0,
        hasNotifiedReady: false,
      }))
    );
  }, [updateAndPersist]);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      saveSoundEnabled(next);
      return next;
    });
  }, []);

  const handleTopCountChange = useCallback((count: TopCount) => {
    setTopCount(count);
    saveTopCount(count);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  }, []);

  const handleImportCsv = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.importCsv) {
      return;
    }

    const csvText = await api.importCsv();
    if (!csvText) {
      return;
    }

    const nowIso = new Date().toISOString();
    const imported = parseImportCsv(csvText, nowIso);
    if (imported.length === 0) {
      return;
    }

    updateAndPersist((prev) => [...prev, ...imported]);
  }, [updateAndPersist]);

  const handleClearAllRequest = useCallback(() => {
    setIsClearAllOpen(true)
  }, []);

  const handleClearAllCancel = useCallback(() => {
    setIsClearAllOpen(false);
  }, []);

  const handleClearAllConfirm = useCallback(() => {
    setMonsters([]);
    clearMonsters();
    setIsClearAllOpen(false);
  }, []);

  return (
    <main className={`app-shell ${viewMode === "portrait" ? "view-portrait" : "view-wide"}`}>
      <header className="header-row">
        <h1>MVP Tracker</h1>
        <TopControlsBar
          hasMonsters={monsters.length > 0}
          soundEnabled={soundEnabled}
          viewMode={viewMode}
          onToggleSound={handleToggleSound}
          onViewModeChange={handleViewModeChange}
          onResetAll={handleResetAll}
          onClearAll={handleClearAllRequest}
          onImportCsv={handleImportCsv}
        />
      </header>

      <TopFivePanel
        monsters={topMonsters}
        topCount={topCount}
        onTopCountChange={handleTopCountChange}
        onResetNow={handleResetNow}
        onDelete={handleDeleteMonsterRequest}
        onSetExact={handleSetExactRequest}
        onAdjustOffset={handleAdjustOffset}
        onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
        onInteraction={handleTopFiveInteraction}
        activeEditingMonsterId={activeInteractionSurface === "top5" ? activeEditingMonsterId : null}
        isInteractionLocked={isInteractionLocked}
      />

      <div className="content-grid">
        <AddMonsterForm onCreate={handleCreateMonster} />
        <MonsterTable
          monsters={renderedMonsters}
          onNameChange={handleNameChange}
          onRespawnHoursMinutesChange={handleRespawnHoursMinutesChange}
          onLastKilledChange={handleLastKilledChange}
          onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
          onResetNow={handleResetNow}
          onDelete={handleDeleteMonsterRequest}
          onSetExact={handleSetExactRequest}
          onInteraction={handleTableInteraction}
          activeEditingMonsterId={activeInteractionSurface === "table" ? activeEditingMonsterId : null}
          isInteractionLocked={isInteractionLocked}
        />
      </div>

      <ReadyNotificationManager
        monsters={monsters}
        soundEnabled={soundEnabled}
        onMarkReadyNotified={handleMarkReadyNotified}
      />

      <ConfirmModal
        isOpen={isClearAllOpen}
        title="Delete All Monsters?"
        message="Are you sure? This will remove every monster timer."
        confirmLabel="Delete All"
        onCancel={handleClearAllCancel}
        onConfirm={handleClearAllConfirm}
      />

      <ConfirmModal
        isOpen={pendingDeleteMonster !== null}
        title="Delete Monster?"
        message={
          pendingDeleteMonster
            ? `Are you sure you want to delete "${pendingDeleteMonster.name}"?`
            : ""
        }
        confirmLabel="Delete"
        onCancel={handleDeleteMonsterCancel}
        onConfirm={handleDeleteMonsterConfirm}
      />

      <SetExactModal
        isOpen={setExactMonster !== null}
        monsterName={setExactMonster?.name ?? ""}
        onCancel={handleSetExactCancel}
        onConfirm={handleSetExactConfirm}
      />
    </main>
  );
}
