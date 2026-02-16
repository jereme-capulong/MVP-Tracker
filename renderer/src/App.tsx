import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  type FirestoreError,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { AddMonsterForm } from "./components/AddMonsterForm";
import { ConfirmModal } from "./components/ConfirmModal";
import { EditNameModal } from "./components/EditNameModal";
import { MonsterTable } from "./components/MonsterTable";
import { ReadyNotificationManager } from "./components/ReadyNotificationManager";
import { SettingsModal } from "./components/SettingsModal";
import { SetExactModal } from "./components/SetExactModal";
import { TopControlsBar } from "./components/TopControlsBar";
import { TopFivePanel } from "./components/TopThreePanel";
import { db, firebaseInitError } from "./firebase";
import { useInteractionLock } from "./hooks/useInteractionLock";
import { Monster, MonsterInput, SetExactMode, TopCount } from "./types";
import { AlertSettings, loadAlertSettings, saveAlertSettings } from "./utils/settings";
import { preloadCustomAlert } from "./utils/sound";
import {
  calculateLastKilledTimestampForTargetSpawn,
  calculateNextSpawn,
  calculateSetExactTargetSpawnMs,
  convertHoursMinutesToSeconds,
  loadMonsterSortOption,
  loadSoundEnabled,
  loadTopCount,
  makeMonster,
  MonsterSortOption,
  saveMonsterSortOption,
  saveSoundEnabled,
  saveTopCount,
} from "./utils/time";

type InteractionSurface = "table" | "top5";

type FirestoreMonster = {
  id: string;
  name: string;
  respawnDuration: number;
  lastKilledTimestamp: string;
  offsetSeconds: number;
};

type MonsterSortData = {
  monster: Monster;
  nextSpawnMs: number;
  normalizedName: string;
  lastKilledMs: number;
};

const MONSTERS_COLLECTION = "monsters";

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

function normalizeFirestoreMonster(raw: unknown, fallbackId: string): FirestoreMonster | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Partial<FirestoreMonster>;
  if (
    typeof data.name !== "string" ||
    typeof data.respawnDuration !== "number" ||
    typeof data.lastKilledTimestamp !== "string"
  ) {
    return null;
  }

  const id = typeof data.id === "string" && data.id ? data.id : fallbackId;
  if (Number.isNaN(Date.parse(data.lastKilledTimestamp))) {
    return null;
  }

  return {
    id,
    name: data.name,
    respawnDuration: Math.max(1, Math.trunc(data.respawnDuration)),
    lastKilledTimestamp: data.lastKilledTimestamp,
    offsetSeconds: typeof data.offsetSeconds === "number" ? Math.trunc(data.offsetSeconds) : 0,
  };
}

function areMonsterTimerFieldsEqual(a: Monster, b: FirestoreMonster): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.respawnDuration === b.respawnDuration &&
    a.lastKilledTimestamp === b.lastKilledTimestamp &&
    (a.offsetSeconds ?? 0) === b.offsetSeconds
  );
}

function toFirestoreMonsterPayload(monster: FirestoreMonster) {
  return {
    id: monster.id,
    name: monster.name,
    respawnDuration: monster.respawnDuration,
    lastKilledTimestamp: monster.lastKilledTimestamp,
    offsetSeconds: monster.offsetSeconds,
    updatedAt: serverTimestamp(),
  };
}

function getFirestoreErrorMessage(error: unknown): string {
  const firestoreError = error as Partial<FirestoreError> | null;
  if (firestoreError?.code) {
    return `${firestoreError.code}${firestoreError.message ? `: ${firestoreError.message}` : ""}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown Firestore error";
}

function compareNumbers(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareMonsterSortData(a: MonsterSortData, b: MonsterSortData, sortOption: MonsterSortOption): number {
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

export function App() {
  // Monsters are kept in one top-level state store to keep updates predictable.
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => loadAlertSettings());
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const [isResetAllOpen, setIsResetAllOpen] = useState(false);
  const [pendingDeleteMonsterId, setPendingDeleteMonsterId] = useState<string | null>(null);
  const [setExactMonsterId, setSetExactMonsterId] = useState<string | null>(null);
  const [editNameMonsterId, setEditNameMonsterId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadSoundEnabled());
  const [topCount, setTopCount] = useState<TopCount>(() => loadTopCount());
  const [tableSortOption, setTableSortOption] = useState<MonsterSortOption>(() =>
    loadMonsterSortOption()
  );
  const [isFirestoreConnected, setIsFirestoreConnected] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(() => firebaseInitError);
  const [activeInteractionSurface, setActiveInteractionSurface] = useState<InteractionSurface | null>(null);
  const monsterDocIdByMonsterIdRef = useRef<Map<string, string>>(new Map());

  const requireDb = useCallback(() => {
    if (db) {
      return db;
    }

    setFirestoreError(firebaseInitError ?? "Firebase is not configured.");
    return null;
  }, []);

  const sortData = useMemo<MonsterSortData[]>(
    () =>
      monsters.map((monster) => ({
        monster,
        nextSpawnMs: calculateNextSpawn(monster),
        normalizedName: monster.name.toLowerCase(),
        lastKilledMs: Date.parse(monster.lastKilledTimestamp),
      })),
    [monsters]
  );

  const tableSortedMonsters = useMemo(() => {
    const next = [...sortData];
    next.sort((a, b) => {
      const compared = compareMonsterSortData(a, b, tableSortOption);
      if (compared !== 0) {
        return compared;
      }
      const byName = compareText(a.normalizedName, b.normalizedName);
      if (byName !== 0) {
        return byName;
      }
      return a.monster.id.localeCompare(b.monster.id);
    });

    return next.map((entry) => entry.monster);
  }, [sortData, tableSortOption]);

  const timeSortedMonsters = useMemo(() => {
    const next = [...sortData];
    next.sort((a, b) => {
      const byTime = compareNumbers(a.nextSpawnMs, b.nextSpawnMs);
      if (byTime !== 0) {
        return byTime;
      }
      const byName = compareText(a.normalizedName, b.normalizedName);
      if (byName !== 0) {
        return byName;
      }
      return a.monster.id.localeCompare(b.monster.id);
    });
    return next.map((entry) => entry.monster);
  }, [sortData]);

  const tableSortedMonsterIds = useMemo(
    () => tableSortedMonsters.map((monster) => monster.id),
    [tableSortedMonsters]
  );
  const timeSortedMonsterIds = useMemo(
    () => timeSortedMonsters.map((monster) => monster.id),
    [timeSortedMonsters]
  );
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
  const editNameMonster = useMemo(
    () => (editNameMonsterId ? (monsterById.get(editNameMonsterId) ?? null) : null),
    [editNameMonsterId, monsterById]
  );

  const {
    isInteractionLocked,
    lockedOrderIds,
    activeInteractionMonsterId,
    persistentLockForTopCard,
    triggerInteractionLock,
    releaseInteractionLock,
  } = useInteractionLock({ sortedIds: tableSortedMonsterIds, liveIds: liveMonsterIds });

  useEffect(() => {
    if (isInteractionLocked) {
      return;
    }
    setActiveInteractionSurface(null);
  }, [isInteractionLocked]);

  useEffect(() => {
    if (alertSettings.alertMode !== "custom") {
      return;
    }
    preloadCustomAlert(alertSettings.customSoundPath);
  }, [alertSettings]);

  useEffect(() => {
    if (!db) {
      setIsFirestoreConnected(false);
      setFirestoreError(firebaseInitError ?? "Firebase is not configured.");
      return;
    }

    const monstersCollectionRef = collection(db, MONSTERS_COLLECTION);
    const unsubscribe = onSnapshot(
      monstersCollectionRef,
      (snapshot) => {
        setIsFirestoreConnected(true);
        setFirestoreError(null);

        const nextMonsters: FirestoreMonster[] = [];
        const nextDocIdByMonsterId = new Map<string, string>();

        snapshot.forEach((snapshotDoc) => {
          const normalized = normalizeFirestoreMonster(snapshotDoc.data(), snapshotDoc.id);
          if (!normalized) {
            return;
          }
          if (nextDocIdByMonsterId.has(normalized.id)) {
            return;
          }

          nextDocIdByMonsterId.set(normalized.id, snapshotDoc.id);
          nextMonsters.push(normalized);
        });

        monsterDocIdByMonsterIdRef.current = nextDocIdByMonsterId;

        setMonsters((prev) => {
          const previousById = new Map(prev.map((monster) => [monster.id, monster]));
          return nextMonsters.map((nextMonster) => {
            const previousMonster = previousById.get(nextMonster.id);
            const hasNotifiedReady =
              previousMonster && areMonsterTimerFieldsEqual(previousMonster, nextMonster)
                ? previousMonster.hasNotifiedReady
                : false;

            return {
              ...nextMonster,
              hasNotifiedReady,
            };
          });
        });
      },
      (error) => {
        setIsFirestoreConnected(false);
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Firestore monsters listener failed", error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (pendingDeleteMonsterId && !monsterById.has(pendingDeleteMonsterId)) {
      setPendingDeleteMonsterId(null);
    }
    if (setExactMonsterId && !monsterById.has(setExactMonsterId)) {
      setSetExactMonsterId(null);
    }
    if (editNameMonsterId && !monsterById.has(editNameMonsterId)) {
      setEditNameMonsterId(null);
    }
  }, [editNameMonsterId, monsterById, pendingDeleteMonsterId, setExactMonsterId]);

  const visualOrderIds = useMemo(() => {
    if (!isInteractionLocked) {
      return tableSortedMonsterIds;
    }

    const lockedSet = new Set(lockedOrderIds);
    const preserved = lockedOrderIds.filter((id) => monsterById.has(id));
    const appended = tableSortedMonsterIds.filter((id) => !lockedSet.has(id));

    return [...preserved, ...appended];
  }, [isInteractionLocked, lockedOrderIds, monsterById, tableSortedMonsterIds]);

  const renderedMonsters = useMemo(
    () =>
      visualOrderIds.flatMap((id) => {
        const monster = monsterById.get(id);
        return monster ? [monster] : [];
      }),
    [monsterById, visualOrderIds]
  );

  const unlockedTopMonsters = useMemo(
    () => timeSortedMonsters.slice(0, topCount),
    [timeSortedMonsters, topCount]
  );
  const isTopInteractionLocked = isInteractionLocked && activeInteractionSurface === "top5";
  const topMonsters = useMemo(
    () => (isTopInteractionLocked ? renderedMonsters.slice(0, topCount) : unlockedTopMonsters),
    [isTopInteractionLocked, renderedMonsters, topCount, unlockedTopMonsters]
  );

  const getMonsterDocRef = useCallback((monsterId: string) => {
    if (!db) {
      return null;
    }

    const docId = monsterDocIdByMonsterIdRef.current.get(monsterId);
    return docId ? doc(db, MONSTERS_COLLECTION, docId) : null;
  }, []);

  const updateMonsterFields = useCallback(
    async (monsterId: string, fields: Partial<Omit<FirestoreMonster, "id">>) => {
      const activeDb = requireDb();
      if (!activeDb) {
        return;
      }

      const monsterDocRef = getMonsterDocRef(monsterId);
      if (!monsterDocRef) {
        return;
      }

      await updateDoc(monsterDocRef, {
        ...fields,
        updatedAt: serverTimestamp(),
      });
    },
    [getMonsterDocRef, requireDb]
  );

  const handleCreateMonster = useCallback(
    async (input: MonsterInput) => {
      const activeDb = requireDb();
      if (!activeDb) {
        return;
      }

      const created = makeMonster(input.name, input.respawnDurationMinutes, input.lastKilledTimestamp);
      const firestoreMonster: FirestoreMonster = {
        id: created.id,
        name: created.name,
        respawnDuration: created.respawnDuration,
        lastKilledTimestamp: created.lastKilledTimestamp,
        offsetSeconds: created.offsetSeconds ?? 0,
      };

      try {
        await addDoc(collection(activeDb, MONSTERS_COLLECTION), toFirestoreMonsterPayload(firestoreMonster));
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to create monster", error);
      }
    },
    [requireDb]
  );

  const handleEditNameRequest = useCallback((id: string) => {
    setEditNameMonsterId(id);
  }, []);

  const handleEditNameCancel = useCallback(() => {
    setEditNameMonsterId(null);
  }, []);

  const handleEditNameConfirm = useCallback(
    async (name: string) => {
      if (!editNameMonsterId) {
        return;
      }

      const monster = monsterById.get(editNameMonsterId);
      const trimmed = name.trim();
      if (!monster || !trimmed || monster.name === trimmed) {
        setEditNameMonsterId(null);
        return;
      }

      setEditNameMonsterId(null);
      triggerInteractionLock(tableSortedMonsterIds);
      try {
        await updateMonsterFields(editNameMonsterId, { name: trimmed });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster name", error);
      }
    },
    [editNameMonsterId, monsterById, tableSortedMonsterIds, triggerInteractionLock, updateMonsterFields]
  );

  const handleRespawnHoursMinutesChange = useCallback(
    async (id: string, hours: number, minutes: number) => {
      const safeHours = Math.max(0, Math.trunc(hours));
      const safeMinutes = Math.max(0, Math.trunc(minutes));
      const respawnDuration = Math.max(60, safeHours * 3600 + safeMinutes * 60);

      const monster = monsterById.get(id);
      if (!monster || monster.respawnDuration === respawnDuration) {
        return;
      }

      try {
        await updateMonsterFields(id, { respawnDuration });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster respawn duration", error);
      }
    },
    [monsterById, updateMonsterFields]
  );

  const handleLastKilledChange = useCallback(
    async (id: string, iso: string) => {
      const monster = monsterById.get(id);
      if (!monster || monster.lastKilledTimestamp === iso) {
        return;
      }

      try {
        await updateMonsterFields(id, { lastKilledTimestamp: iso });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster last killed timestamp", error);
      }
    },
    [monsterById, updateMonsterFields]
  );

  const handleOffsetHoursMinutesChange = useCallback(
    async (id: string, hours: number, minutes: number) => {
      const offsetSeconds = convertHoursMinutesToSeconds(hours, minutes);

      const monster = monsterById.get(id);
      if (!monster || (monster.offsetSeconds ?? 0) === offsetSeconds) {
        return;
      }

      try {
        await updateMonsterFields(id, { offsetSeconds });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster offset", error);
      }
    },
    [monsterById, updateMonsterFields]
  );

  const handleTableInteraction = useCallback(
    (id: string) => {
      if (persistentLockForTopCard && activeInteractionSurface === "top5") {
        releaseInteractionLock();
      }
      setActiveInteractionSurface("table");
      triggerInteractionLock(tableSortedMonsterIds, {
        mode: "auto",
        activeInteractionMonsterId: id,
      });
    },
    [
      activeInteractionSurface,
      persistentLockForTopCard,
      releaseInteractionLock,
      tableSortedMonsterIds,
      triggerInteractionLock,
    ]
  );

  const handleTopCardOffsetInteraction = useCallback(
    (id: string) => {
      setActiveInteractionSurface("top5");
      triggerInteractionLock(timeSortedMonsterIds, {
        mode: "persistentTopCard",
        activeInteractionMonsterId: id,
      });
    },
    [timeSortedMonsterIds, triggerInteractionLock]
  );

  const handleResetNow = useCallback(
    async (id: string) => {
      try {
        await updateMonsterFields(id, { lastKilledTimestamp: new Date().toISOString() });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to reset monster timer", error);
      }
    },
    [updateMonsterFields]
  );

  const handleTopCardTrack = useCallback(
    async (id: string) => {
      if (
        persistentLockForTopCard &&
        activeInteractionSurface === "top5" &&
        activeInteractionMonsterId === id
      ) {
        releaseInteractionLock();
      }
      await handleResetNow(id);
    },
    [
      activeInteractionMonsterId,
      activeInteractionSurface,
      handleResetNow,
      persistentLockForTopCard,
      releaseInteractionLock,
    ]
  );

  const handleTopCardMouseLeave = useCallback(
    (id: string) => {
      if (
        persistentLockForTopCard &&
        activeInteractionSurface === "top5" &&
        activeInteractionMonsterId === id
      ) {
        releaseInteractionLock();
      }
    },
    [activeInteractionMonsterId, activeInteractionSurface, persistentLockForTopCard, releaseInteractionLock]
  );

  const handleDeleteMonsterRequest = useCallback((id: string) => {
    if (persistentLockForTopCard && activeInteractionSurface === "top5") {
      releaseInteractionLock();
    }
    setPendingDeleteMonsterId(id);
  }, [activeInteractionSurface, persistentLockForTopCard, releaseInteractionLock]);

  const handleDeleteMonsterCancel = useCallback(() => {
    setPendingDeleteMonsterId(null);
  }, []);

  const handleDeleteMonsterConfirm = useCallback(async () => {
    if (!pendingDeleteMonsterId) {
      return;
    }

    releaseInteractionLock();

    try {
      const monsterDocRef = getMonsterDocRef(pendingDeleteMonsterId);
      if (monsterDocRef) {
        await deleteDoc(monsterDocRef);
      }
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to delete monster", error);
    } finally {
      setPendingDeleteMonsterId(null);
    }
  }, [getMonsterDocRef, pendingDeleteMonsterId, releaseInteractionLock]);

  const handleSetExactRequest = useCallback((id: string) => {
    setSetExactMonsterId(id);
  }, []);

  const handleSetExactCancel = useCallback(() => {
    setSetExactMonsterId(null);
  }, []);

  const handleSetExactConfirm = useCallback(
    async (hours: number, minutes: number, mode: SetExactMode) => {
      if (!setExactMonsterId) {
        return;
      }

      const monster = monsterById.get(setExactMonsterId);
      if (!monster) {
        setSetExactMonsterId(null);
        return;
      }

      const targetSpawnMs = calculateSetExactTargetSpawnMs(mode, hours, minutes, Date.now());
      const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
        monster,
        targetSpawnMs
      );

      if (monster.lastKilledTimestamp === nextLastKilledTimestamp) {
        setSetExactMonsterId(null);
        return;
      }

      triggerInteractionLock();
      try {
        await updateMonsterFields(setExactMonsterId, {
          lastKilledTimestamp: nextLastKilledTimestamp,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to apply set exact", error);
      } finally {
        setSetExactMonsterId(null);
      }
    },
    [monsterById, setExactMonsterId, triggerInteractionLock, updateMonsterFields]
  );

  const handleMarkReadyNotified = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      setMonsters((prev) => {
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
    []
  );

  const handleResetAllRequest = useCallback(() => {
    if (monsters.length === 0) {
      return;
    }
    setIsResetAllOpen(true);
  }, [monsters.length]);

  const handleResetAllCancel = useCallback(() => {
    setIsResetAllOpen(false);
  }, []);

  const handleResetAllConfirm = useCallback(async () => {
    const activeDb = requireDb();
    if (!activeDb) {
      setIsResetAllOpen(false);
      return;
    }

    if (monsters.length === 0) {
      setIsResetAllOpen(false);
      return;
    }

    const nowIso = new Date().toISOString();
    const batch = writeBatch(activeDb);
    let hasWrites = false;

    for (const monster of monsters) {
      const docId = monsterDocIdByMonsterIdRef.current.get(monster.id);
      if (!docId) {
        continue;
      }

      hasWrites = true;
      batch.update(doc(activeDb, MONSTERS_COLLECTION, docId), {
        lastKilledTimestamp: nowIso,
        offsetSeconds: 0,
        updatedAt: serverTimestamp(),
      });
    }

    if (!hasWrites) {
      setIsResetAllOpen(false);
      return;
    }

    try {
      await batch.commit();
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to reset all monsters", error);
    } finally {
      setIsResetAllOpen(false);
    }
  }, [monsters, requireDb]);

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

  const handleTableSortOptionChange = useCallback((sortOption: MonsterSortOption) => {
    setTableSortOption(sortOption);
    saveMonsterSortOption(sortOption);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleAlertSettingsChange = useCallback((nextSettings: AlertSettings) => {
    setAlertSettings(nextSettings);
    saveAlertSettings(nextSettings);
  }, []);

  const handlePickCustomSound = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.pickAlertSoundFile) {
      return null;
    }

    return api.pickAlertSoundFile();
  }, []);

  const handleImportCsv = useCallback(async () => {
    const activeDb = requireDb();
    if (!activeDb) {
      return;
    }

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

    try {
      await Promise.all(
        imported.map((monster) =>
          addDoc(
            collection(activeDb, MONSTERS_COLLECTION),
            toFirestoreMonsterPayload({
              id: monster.id,
              name: monster.name,
              respawnDuration: monster.respawnDuration,
              lastKilledTimestamp: monster.lastKilledTimestamp,
              offsetSeconds: monster.offsetSeconds ?? 0,
            })
          )
        )
      );
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to import CSV monsters", error);
    }
  }, [requireDb]);

  const handleImportClipboardOption = useCallback(() => {
    // Wired in the next commit when ClipboardImportModal is added.
  }, []);

  const handleClearAllRequest = useCallback(() => {
    setIsClearAllOpen(true);
  }, []);

  const handleClearAllCancel = useCallback(() => {
    setIsClearAllOpen(false);
  }, []);

  const handleClearAllConfirm = useCallback(async () => {
    const activeDb = requireDb();
    if (!activeDb) {
      return;
    }

    const docIds = [...monsterDocIdByMonsterIdRef.current.values()];
    if (docIds.length === 0) {
      setIsClearAllOpen(false);
      return;
    }

    const batch = writeBatch(activeDb);
    for (const docId of docIds) {
      batch.delete(doc(activeDb, MONSTERS_COLLECTION, docId));
    }

    try {
      await batch.commit();
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to clear all monsters", error);
    } finally {
      setIsClearAllOpen(false);
    }
  }, [requireDb]);

  return (
    <main className="app-shell">
      <header className="header-row">
        <h1>MVP Tracker</h1>
        <TopControlsBar
          hasMonsters={monsters.length > 0}
          soundEnabled={soundEnabled}
          onOpenSettings={handleOpenSettings}
          onToggleSound={handleToggleSound}
          onResetAll={handleResetAllRequest}
          onClearAll={handleClearAllRequest}
          onImportCsv={handleImportCsv}
          onImportClipboard={handleImportClipboardOption}
        />
      </header>

      {firestoreError ? (
        <section className="firestore-banner firestore-banner-error" role="alert">
          Firestore sync error: {firestoreError}
        </section>
      ) : !isFirestoreConnected ? (
        <section className="firestore-banner firestore-banner-info" role="status">
          Connecting to Firestore...
        </section>
      ) : null}

      <TopFivePanel
        monsters={topMonsters}
        topCount={topCount}
        onTopCountChange={handleTopCountChange}
        onTrack={handleTopCardTrack}
        onDelete={handleDeleteMonsterRequest}
        onSetExact={handleSetExactRequest}
        onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
        onOffsetInteraction={handleTopCardOffsetInteraction}
        onCardMouseLeave={handleTopCardMouseLeave}
        activeEditingMonsterId={
          activeInteractionSurface === "top5" ? activeInteractionMonsterId : null
        }
        isInteractionLocked={isTopInteractionLocked}
      />

      <div className="content-grid">
        <AddMonsterForm onCreate={handleCreateMonster} />
        <MonsterTable
          monsters={monsters}
          sortOption={tableSortOption}
          lockedOrderIds={lockedOrderIds}
          onSortOptionChange={handleTableSortOptionChange}
          onEditNameRequest={handleEditNameRequest}
          onRespawnHoursMinutesChange={handleRespawnHoursMinutesChange}
          onLastKilledChange={handleLastKilledChange}
          onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
          onResetNow={handleResetNow}
          onDelete={handleDeleteMonsterRequest}
          onSetExact={handleSetExactRequest}
          onInteraction={handleTableInteraction}
          activeEditingMonsterId={
            activeInteractionSurface === "table" ? activeInteractionMonsterId : null
          }
          isInteractionLocked={isInteractionLocked && activeInteractionSurface === "table"}
        />
      </div>

      <ReadyNotificationManager
        monsters={monsters}
        soundEnabled={soundEnabled}
        alertSettings={alertSettings}
        onMarkReadyNotified={handleMarkReadyNotified}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        settings={alertSettings}
        onClose={handleCloseSettings}
        onSettingsChange={handleAlertSettingsChange}
        onPickCustomSound={handlePickCustomSound}
      />

      <ConfirmModal
        isOpen={isResetAllOpen}
        title="Reset All Timers?"
        message="This will reset all monsters' last killed time to now."
        confirmLabel="Confirm Reset"
        onCancel={handleResetAllCancel}
        onConfirm={handleResetAllConfirm}
      />

      <ConfirmModal
        isOpen={isClearAllOpen}
        title="Delete All Monsters?"
        message="Are you sure? This will remove every monster timer."
        confirmLabel="Delete All"
        confirmButtonClassName="danger-btn"
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
        confirmButtonClassName="danger-btn"
        onCancel={handleDeleteMonsterCancel}
        onConfirm={handleDeleteMonsterConfirm}
      />

      <EditNameModal
        isOpen={editNameMonster !== null}
        monsterName={editNameMonster?.name ?? ""}
        onCancel={handleEditNameCancel}
        onSave={handleEditNameConfirm}
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
