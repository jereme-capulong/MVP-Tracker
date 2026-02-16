import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type FirestoreError,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { AddMonsterModal } from "./components/AddMonsterModal";
import { CategoriesModal } from "./components/CategoriesModal";
import { ClipboardImportModal } from "./components/ClipboardImportModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { EditNameModal } from "./components/EditNameModal";
import { LoginScreen } from "./components/LoginScreen";
import { MonsterTable } from "./components/MonsterTable";
import { NicknameModal } from "./components/NicknameModal";
import { ReadyNotificationManager } from "./components/ReadyNotificationManager";
import { SettingsModal } from "./components/SettingsModal";
import { SetExactModal } from "./components/SetExactModal";
import { TopControlsBar } from "./components/TopControlsBar";
import { TopFivePanel } from "./components/TopThreePanel";
import { auth, authInitError } from "./auth";
import { db, firebaseInitError } from "./firebase";
import { useInteractionLock } from "./hooks/useInteractionLock";
import { Category, EDIT_LOCK_TIMEOUT_MS, Monster, TopCount } from "./types";
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
  parseAtDurationToSeconds,
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
  categoryId: string | null;
  editingBy: string | null;
  editingByUid: string | null;
  editingStartedAtMs: number | null;
};

type FirestoreCategory = {
  id: string;
  name: string;
  color: string;
};

type FirestoreUserProfile = {
  uid: string;
  email: string;
  nickname: string;
};

type MonsterSortData = {
  monster: Monster;
  nextSpawnMs: number;
  normalizedName: string;
  lastKilledMs: number;
};

type ClipboardImportResult = {
  importedCount: number;
  skippedCount: number;
};

const MONSTERS_COLLECTION = "monsters";
const CATEGORIES_COLLECTION = "categories";
const USERS_COLLECTION = "users";

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

function parseClipboardImport(
  clipboardText: string,
  lastKilledTimestamp: string
): { imported: FirestoreMonster[]; skippedCount: number } {
  const imported: FirestoreMonster[] = [];
  let skippedCount = 0;
  const lines = clipboardText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const tabIndex = line.indexOf("\t");
    if (tabIndex < 0) {
      skippedCount += 1;
      continue;
    }

    const name = line.slice(0, tabIndex);
    if (!name.trim()) {
      skippedCount += 1;
      continue;
    }

    const timePart = line.slice(tabIndex + 1).trim();
    const respawnDuration = parseAtDurationToSeconds(timePart);
    if (respawnDuration === null) {
      skippedCount += 1;
      continue;
    }

    imported.push({
      id: crypto.randomUUID(),
      name,
      respawnDuration,
      lastKilledTimestamp,
      offsetSeconds: 0,
      categoryId: null,
      editingBy: null,
      editingByUid: null,
      editingStartedAtMs: null,
    });
  }

  return { imported, skippedCount };
}

function normalizeFirestoreMonster(raw: unknown, fallbackId: string): FirestoreMonster | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Partial<FirestoreMonster> & { editingStartedAt?: unknown };
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

  const editingBy =
    typeof data.editingBy === "string" && data.editingBy.trim() ? data.editingBy.trim() : null;
  const editingByUid =
    typeof data.editingByUid === "string" && data.editingByUid.trim() ? data.editingByUid.trim() : null;

  return {
    id,
    name: data.name,
    respawnDuration: Math.max(1, Math.trunc(data.respawnDuration)),
    lastKilledTimestamp: data.lastKilledTimestamp,
    offsetSeconds: typeof data.offsetSeconds === "number" ? Math.trunc(data.offsetSeconds) : 0,
    categoryId: typeof data.categoryId === "string" && data.categoryId.trim() ? data.categoryId : null,
    editingBy: editingByUid ? editingBy : null,
    editingByUid: editingBy && editingByUid ? editingByUid : null,
    editingStartedAtMs:
      data.editingStartedAt instanceof Timestamp ? data.editingStartedAt.toMillis() : null,
  };
}

function normalizeFirestoreCategory(raw: unknown, fallbackId: string): FirestoreCategory | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Partial<FirestoreCategory>;
  if (typeof data.name !== "string" || typeof data.color !== "string") {
    return null;
  }

  const id = typeof data.id === "string" && data.id ? data.id : fallbackId;
  const normalizedColor = /^#[0-9a-fA-F]{6}$/.test(data.color) ? data.color.toLowerCase() : null;
  if (!normalizedColor) {
    return null;
  }

  return {
    id,
    name: data.name.trim(),
    color: normalizedColor,
  };
}

function normalizeFirestoreUserProfile(
  raw: unknown,
  fallbackUid: string,
  fallbackEmail: string | null
): FirestoreUserProfile | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Partial<FirestoreUserProfile>;
  const nickname = typeof data.nickname === "string" ? data.nickname.trim() : "";
  if (nickname.length < 2 || nickname.length > 20) {
    return null;
  }

  return {
    uid: typeof data.uid === "string" && data.uid.trim() ? data.uid.trim() : fallbackUid,
    email: typeof data.email === "string" ? data.email : fallbackEmail ?? "",
    nickname,
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
    categoryId: monster.categoryId,
    editingBy: monster.editingBy,
    editingByUid: monster.editingByUid,
    editingStartedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function toFirestoreCategoryPayload(category: FirestoreCategory) {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    createdAt: serverTimestamp(),
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

function isMonsterEditLockExpired(monster: Pick<Monster, "editingByUid" | "editingStartedAtMs">): boolean {
  if (!monster.editingByUid) {
    return false;
  }
  if (monster.editingStartedAtMs === null) {
    return true;
  }
  return Date.now() - monster.editingStartedAtMs > EDIT_LOCK_TIMEOUT_MS;
}

export function App() {
  // Monsters are kept in one top-level state store to keep updates predictable.
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isAddMonsterOpen, setIsAddMonsterOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => loadAlertSettings());
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const [isResetAllOpen, setIsResetAllOpen] = useState(false);
  const [pendingDeleteMonsterId, setPendingDeleteMonsterId] = useState<string | null>(null);
  const [setExactMonsterId, setSetExactMonsterId] = useState<string | null>(null);
  const [editNameMonsterId, setEditNameMonsterId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadSoundEnabled());
  const [topCount, setTopCount] = useState<TopCount>(() => loadTopCount());
  const [isClipboardImportOpen, setIsClipboardImportOpen] = useState(false);
  const [tableSortOption, setTableSortOption] = useState<MonsterSortOption>(() =>
    loadMonsterSortOption()
  );
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<FirestoreUserProfile | null>(null);
  const [isUserProfileResolved, setIsUserProfileResolved] = useState(false);
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [authError, setAuthError] = useState<string | null>(() => authInitError);
  const [isFirestoreConnected, setIsFirestoreConnected] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(() => firebaseInitError);
  const [activeInteractionSurface, setActiveInteractionSurface] = useState<InteractionSurface | null>(null);
  const [activeCollaborativeLockMonsterId, setActiveCollaborativeLockMonsterId] = useState<string | null>(null);
  const monsterDocIdByMonsterIdRef = useRef<Map<string, string>>(new Map());
  const categoryDocIdByCategoryIdRef = useRef<Map<string, string>>(new Map());
  const lockAcquireInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
  const lockTransitionChainRef = useRef<Promise<void>>(Promise.resolve());
  const activeCollaborativeLockMonsterIdRef = useRef<string | null>(null);
  const monsterByIdRef = useRef<Map<string, Monster>>(new Map());
  const authUserId = authUser?.uid ?? null;
  const authDisplayName =
    (currentUserProfile?.nickname ?? authUser?.displayName ?? authUser?.email ?? "Account").trim() ||
    "Account";

  const requireDb = useCallback(() => {
    if (!authUserId) {
      return null;
    }
    if (db) {
      return db;
    }

    setFirestoreError(firebaseInitError ?? "Firebase is not configured.");
    return null;
  }, [authUserId]);

  const handleSaveNickname = useCallback(
    async (nickname: string): Promise<boolean> => {
      const activeDb = db;
      if (!authUser || !activeDb) {
        setNicknameError(firebaseInitError ?? "Firebase is not configured.");
        return false;
      }

      const trimmedNickname = nickname.trim();
      if (trimmedNickname.length < 2 || trimmedNickname.length > 20) {
        setNicknameError("Nickname must be between 2 and 20 characters.");
        return false;
      }

      setNicknameError(null);
      setIsSavingNickname(true);
      try {
        const savedProfile = await runTransaction(activeDb, async (transaction) => {
          const userDocRef = doc(activeDb, USERS_COLLECTION, authUser.uid);
          const existingSnapshot = await transaction.get(userDocRef);
          if (existingSnapshot.exists()) {
            const normalized = normalizeFirestoreUserProfile(
              existingSnapshot.data(),
              authUser.uid,
              authUser.email
            );
            if (normalized) {
              return normalized;
            }
          }

          const nextProfile: FirestoreUserProfile = {
            uid: authUser.uid,
            email: authUser.email ?? "",
            nickname: trimmedNickname,
          };

          transaction.set(userDocRef, {
            ...nextProfile,
            createdAt: serverTimestamp(),
          }, { merge: true });
          return nextProfile;
        });

        setCurrentUserProfile(savedProfile);
        setIsUserProfileResolved(true);
        return true;
      } catch (error) {
        setNicknameError(getFirestoreErrorMessage(error));
        return false;
      } finally {
        setIsSavingNickname(false);
      }
    },
    [authUser]
  );

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
  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
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
    monsterByIdRef.current = monsterById;
  }, [monsterById]);

  useEffect(() => {
    activeCollaborativeLockMonsterIdRef.current = activeCollaborativeLockMonsterId;
  }, [activeCollaborativeLockMonsterId]);

  const resetSessionState = useCallback(() => {
    monsterDocIdByMonsterIdRef.current = new Map();
    categoryDocIdByCategoryIdRef.current = new Map();
    lockAcquireInFlightRef.current.clear();
    lockTransitionChainRef.current = Promise.resolve();
    setMonsters([]);
    setCategories([]);
    setIsAddMonsterOpen(false);
    setIsCategoriesOpen(false);
    setIsSettingsOpen(false);
    setIsClearAllOpen(false);
    setIsResetAllOpen(false);
    setPendingDeleteMonsterId(null);
    setSetExactMonsterId(null);
    setEditNameMonsterId(null);
    setIsClipboardImportOpen(false);
    setIsFirestoreConnected(false);
    setFirestoreError(firebaseInitError);
    setActiveInteractionSurface(null);
    setActiveCollaborativeLockMonsterId(null);
    setCurrentUserProfile(null);
    setIsUserProfileResolved(false);
    setIsSavingNickname(false);
    setNicknameError(null);
    releaseInteractionLock();
  }, [releaseInteractionLock]);

  useEffect(() => {
    if (!auth) {
      setIsAuthResolved(true);
      setAuthError(authInitError ?? "Firebase Authentication is not configured.");
      resetSessionState();
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setAuthUser(nextUser);
        setAuthError(null);
        setIsAuthResolved(true);
        setNicknameError(null);
        setIsSavingNickname(false);
        setIsUserProfileResolved(false);
        setCurrentUserProfile(null);
        if (!nextUser) {
          resetSessionState();
        }
      },
      (error) => {
        setAuthUser(null);
        setIsAuthResolved(true);
        setAuthError(error instanceof Error ? error.message : "Unknown authentication error");
        resetSessionState();
        console.error("Authentication listener failed", error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [resetSessionState]);

  useEffect(() => {
    if (isInteractionLocked) {
      return;
    }
    setActiveInteractionSurface(null);
  }, [isInteractionLocked]);

  useEffect(() => {
    if (!isAuthResolved || !authUser) {
      return;
    }

    if (!db) {
      setNicknameError(firebaseInitError ?? "Firebase is not configured.");
      setIsUserProfileResolved(true);
      return;
    }
    const activeDb = db;

    let isActive = true;
    setIsUserProfileResolved(false);
    setNicknameError(null);

    const loadProfile = async () => {
      try {
        const userDocRef = doc(activeDb, USERS_COLLECTION, authUser.uid);
        const snapshot = await getDoc(userDocRef);
        if (!isActive) {
          return;
        }

        if (!snapshot.exists()) {
          setCurrentUserProfile(null);
          setIsUserProfileResolved(true);
          return;
        }

        const normalizedProfile = normalizeFirestoreUserProfile(
          snapshot.data(),
          authUser.uid,
          authUser.email
        );
        setCurrentUserProfile(normalizedProfile);
        setIsUserProfileResolved(true);
      } catch (error) {
        if (!isActive) {
          return;
        }
        setNicknameError(getFirestoreErrorMessage(error));
        setIsUserProfileResolved(true);
      }
    };

    void loadProfile();

    return () => {
      isActive = false;
    };
  }, [authUser, isAuthResolved]);

  useEffect(() => {
    if (alertSettings.alertMode !== "custom") {
      return;
    }
    preloadCustomAlert(alertSettings.customSoundPath);
  }, [alertSettings]);

  useEffect(() => {
    if (!isAuthResolved || !authUserId || !isUserProfileResolved || !currentUserProfile) {
      return;
    }

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
  }, [authUserId, currentUserProfile, isAuthResolved, isUserProfileResolved]);

  useEffect(() => {
    if (!isAuthResolved || !authUserId || !isUserProfileResolved || !currentUserProfile) {
      return;
    }

    if (!db) {
      return;
    }

    const categoriesCollectionRef = collection(db, CATEGORIES_COLLECTION);
    const unsubscribe = onSnapshot(
      categoriesCollectionRef,
      (snapshot) => {
        const nextCategories: FirestoreCategory[] = [];
        const nextDocIdByCategoryId = new Map<string, string>();

        snapshot.forEach((snapshotDoc) => {
          const normalized = normalizeFirestoreCategory(snapshotDoc.data(), snapshotDoc.id);
          if (!normalized) {
            return;
          }
          if (nextDocIdByCategoryId.has(normalized.id)) {
            return;
          }

          nextDocIdByCategoryId.set(normalized.id, snapshotDoc.id);
          nextCategories.push(normalized);
        });

        categoryDocIdByCategoryIdRef.current = nextDocIdByCategoryId;
        nextCategories.sort((a, b) => compareText(a.name, b.name));
        setCategories(nextCategories);
      },
      (error) => {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Firestore categories listener failed", error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [authUserId, currentUserProfile, isAuthResolved, isUserProfileResolved]);

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

  useEffect(() => {
    if (!activeCollaborativeLockMonsterId) {
      return;
    }

    const activeMonster = monsterById.get(activeCollaborativeLockMonsterId);
    if (!activeMonster) {
      setActiveCollaborativeLockMonsterId(null);
      return;
    }

    if (activeMonster.editingByUid !== authUserId) {
      setActiveCollaborativeLockMonsterId(null);
    }
  }, [activeCollaborativeLockMonsterId, authUserId, monsterById]);

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
    const activeDb = requireDb();
    if (!activeDb) {
      return null;
    }

    const docId = monsterDocIdByMonsterIdRef.current.get(monsterId);
    return docId ? doc(activeDb, MONSTERS_COLLECTION, docId) : null;
  }, [requireDb]);

  const getCategoryDocRef = useCallback((categoryId: string) => {
    const activeDb = requireDb();
    if (!activeDb) {
      return null;
    }

    const docId = categoryDocIdByCategoryIdRef.current.get(categoryId);
    return docId ? doc(activeDb, CATEGORIES_COLLECTION, docId) : null;
  }, [requireDb]);

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

  const acquireMonsterEditLock = useCallback(
    async (monsterId: string): Promise<boolean> => {
      const activeDb = requireDb();
      if (!activeDb || !authUserId || !currentUserProfile) {
        return false;
      }

      const monsterDocRef = getMonsterDocRef(monsterId);
      if (!monsterDocRef) {
        return false;
      }

      try {
        const didAcquire = await runTransaction(activeDb, async (transaction) => {
          const snapshot = await transaction.get(monsterDocRef);
          if (!snapshot.exists()) {
            return false;
          }

          const data = snapshot.data() as Partial<{
            editingByUid: unknown;
            editingStartedAt: unknown;
          }>;
          const existingLockUid =
            typeof data.editingByUid === "string" && data.editingByUid.trim() ? data.editingByUid.trim() : null;
          const editingStartedAt = data.editingStartedAt instanceof Timestamp ? data.editingStartedAt : null;
          const isExpired =
            editingStartedAt === null || Date.now() - editingStartedAt.toMillis() > EDIT_LOCK_TIMEOUT_MS;
          const canAcquire =
            existingLockUid === null || existingLockUid === authUserId || isExpired;

          if (!canAcquire) {
            return false;
          }

          transaction.update(monsterDocRef, {
            editingBy: currentUserProfile.nickname,
            editingByUid: authUserId,
            editingStartedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return true;
        });

        return didAcquire;
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        return false;
      }
    },
    [authUserId, currentUserProfile, getMonsterDocRef, requireDb]
  );

  const releaseMonsterEditLockById = useCallback(
    async (monsterId: string): Promise<void> => {
      const activeDb = requireDb();
      if (!activeDb || !authUserId) {
        return;
      }

      const monsterDocRef = getMonsterDocRef(monsterId);
      if (!monsterDocRef) {
        return;
      }

      try {
        await runTransaction(activeDb, async (transaction) => {
          const snapshot = await transaction.get(monsterDocRef);
          if (!snapshot.exists()) {
            return;
          }

          const data = snapshot.data() as Partial<{ editingByUid: unknown }>;
          const existingLockUid =
            typeof data.editingByUid === "string" && data.editingByUid.trim() ? data.editingByUid.trim() : null;
          if (existingLockUid !== authUserId) {
            return;
          }

          transaction.update(monsterDocRef, {
            editingBy: null,
            editingByUid: null,
            editingStartedAt: null,
            updatedAt: serverTimestamp(),
          });
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
      }
    },
    [authUserId, getMonsterDocRef, requireDb]
  );

  const releaseMonsterEditLock = useCallback(
    async (monsterId: string | null | undefined): Promise<void> => {
      if (!monsterId) {
        return;
      }
      await releaseMonsterEditLockById(monsterId);
      setActiveCollaborativeLockMonsterId((current) => (current === monsterId ? null : current));
    },
    [releaseMonsterEditLockById]
  );

  const ensureMonsterEditLock = useCallback(
    (monsterId: string) => {
      if (!authUserId || !currentUserProfile) {
        return;
      }

      const knownMonster = monsterByIdRef.current.get(monsterId);
      if (!knownMonster) {
        return;
      }

      if (
        knownMonster.editingByUid &&
        knownMonster.editingByUid !== authUserId &&
        !isMonsterEditLockExpired(knownMonster)
      ) {
        return;
      }

      const activeLockMonsterId = activeCollaborativeLockMonsterIdRef.current;
      if (
        activeLockMonsterId === monsterId &&
        knownMonster.editingByUid === authUserId &&
        !isMonsterEditLockExpired(knownMonster)
      ) {
        return;
      }

      if (lockAcquireInFlightRef.current.has(monsterId)) {
        return;
      }

      const queuedOperation = lockTransitionChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const previousLockMonsterId = activeCollaborativeLockMonsterIdRef.current;
          if (previousLockMonsterId && previousLockMonsterId !== monsterId) {
            await releaseMonsterEditLockById(previousLockMonsterId);
            setActiveCollaborativeLockMonsterId((current) =>
              current === previousLockMonsterId ? null : current
            );
          }

          const currentMonster = monsterByIdRef.current.get(monsterId);
          if (!currentMonster) {
            return;
          }

          if (
            currentMonster.editingByUid &&
            currentMonster.editingByUid !== authUserId &&
            !isMonsterEditLockExpired(currentMonster)
          ) {
            return;
          }

          if (currentMonster.editingByUid === authUserId && !isMonsterEditLockExpired(currentMonster)) {
            setActiveCollaborativeLockMonsterId((current) => (current === monsterId ? current : monsterId));
            return;
          }

          const didAcquire = await acquireMonsterEditLock(monsterId);
          if (didAcquire) {
            setActiveCollaborativeLockMonsterId(monsterId);
          }
        });

      lockTransitionChainRef.current = queuedOperation;

      const trackedOperation = queuedOperation.finally(() => {
        lockAcquireInFlightRef.current.delete(monsterId);
      });

      lockAcquireInFlightRef.current.set(monsterId, trackedOperation);
    },
    [acquireMonsterEditLock, authUserId, currentUserProfile, releaseMonsterEditLockById]
  );

  useEffect(() => {
    return () => {
      const activeLockMonsterId = activeCollaborativeLockMonsterIdRef.current;
      if (!activeLockMonsterId) {
        return;
      }
      void releaseMonsterEditLockById(activeLockMonsterId);
    };
  }, [releaseMonsterEditLockById]);

  const handleCreateMonster = useCallback(
    async (input: { name: string; respawnDurationSeconds: number; categoryId: string | null }) => {
      const activeDb = requireDb();
      if (!activeDb) {
        return false;
      }

      const firestoreMonster: FirestoreMonster = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        respawnDuration: Math.max(60, Math.trunc(input.respawnDurationSeconds)),
        lastKilledTimestamp: new Date().toISOString(),
        offsetSeconds: 0,
        categoryId: input.categoryId,
        editingBy: null,
        editingByUid: null,
        editingStartedAtMs: null,
      };

      try {
        await addDoc(collection(activeDb, MONSTERS_COLLECTION), toFirestoreMonsterPayload(firestoreMonster));
        return true;
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to create monster", error);
        return false;
      }
    },
    [requireDb]
  );

  const handleOpenAddMonster = useCallback(() => {
    setIsAddMonsterOpen(true);
  }, []);

  const handleCloseAddMonster = useCallback(() => {
    setIsAddMonsterOpen(false);
  }, []);

  const handleOpenCategories = useCallback(() => {
    setIsCategoriesOpen(true);
  }, []);

  const handleCloseCategories = useCallback(() => {
    setIsCategoriesOpen(false);
  }, []);

  const handleCreateCategory = useCallback(
    async (name: string, color: string) => {
      const activeDb = requireDb();
      if (!activeDb) {
        return false;
      }

      const normalizedName = name.trim();
      if (!normalizedName || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return false;
      }

      const categoryPayload: FirestoreCategory = {
        id: crypto.randomUUID(),
        name: normalizedName,
        color: color.toLowerCase(),
      };

      try {
        await addDoc(collection(activeDb, CATEGORIES_COLLECTION), toFirestoreCategoryPayload(categoryPayload));
        return true;
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to create category", error);
        return false;
      }
    },
    [requireDb]
  );

  const handleUpdateCategory = useCallback(
    async (categoryId: string, name: string, color: string) => {
      const normalizedName = name.trim();
      const normalizedColor = color.toLowerCase();
      if (!normalizedName || !/^#[0-9a-fA-F]{6}$/.test(normalizedColor)) {
        return false;
      }

      const categoryDocRef = getCategoryDocRef(categoryId);
      if (!categoryDocRef) {
        return false;
      }

      try {
        await updateDoc(categoryDocRef, {
          name: normalizedName,
          color: normalizedColor,
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update category", error);
        return false;
      }
    },
    [getCategoryDocRef]
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: string) => {
      const activeDb = requireDb();
      if (!activeDb) {
        return false;
      }

      const categoryDocRef = getCategoryDocRef(categoryId);
      if (!categoryDocRef) {
        return false;
      }

      try {
        const matchingMonstersQuery = query(
          collection(activeDb, MONSTERS_COLLECTION),
          where("categoryId", "==", categoryId)
        );
        const matchingMonstersSnapshot = await getDocs(matchingMonstersQuery);

        const docsToUpdate = matchingMonstersSnapshot.docs;
        const batchSize = 450;
        for (let index = 0; index < docsToUpdate.length; index += batchSize) {
          const chunk = docsToUpdate.slice(index, index + batchSize);
          const batch = writeBatch(activeDb);

          for (const snapshotDoc of chunk) {
            batch.update(snapshotDoc.ref, {
              categoryId: null,
              updatedAt: serverTimestamp(),
            });
          }

          await batch.commit();
        }

        await deleteDoc(categoryDocRef);
        return true;
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to delete category", error);
        return false;
      }
    },
    [getCategoryDocRef, requireDb]
  );

  const handleEditNameRequest = useCallback((id: string) => {
    setEditNameMonsterId(id);
  }, []);

  const handleEditNameCancel = useCallback(() => {
    if (editNameMonsterId) {
      void releaseMonsterEditLock(editNameMonsterId);
    }
    setEditNameMonsterId(null);
  }, [editNameMonsterId, releaseMonsterEditLock]);

  const handleEditNameConfirm = useCallback(
    async (name: string, categoryId: string | null) => {
      if (!editNameMonsterId) {
        return;
      }

      const targetMonsterId = editNameMonsterId;
      const monster = monsterById.get(editNameMonsterId);
      const trimmed = name.trim();
      const nextCategoryId = categoryId ?? null;
      if (
        !monster ||
        !trimmed ||
        (monster.name === trimmed && (monster.categoryId ?? null) === nextCategoryId)
      ) {
        setEditNameMonsterId(null);
        await releaseMonsterEditLock(targetMonsterId);
        return;
      }

      setEditNameMonsterId(null);
      triggerInteractionLock(tableSortedMonsterIds);
      try {
        await updateMonsterFields(targetMonsterId, { name: trimmed, categoryId: nextCategoryId });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster name", error);
      } finally {
        await releaseMonsterEditLock(targetMonsterId);
      }
    },
    [
      editNameMonsterId,
      monsterById,
      releaseMonsterEditLock,
      tableSortedMonsterIds,
      triggerInteractionLock,
      updateMonsterFields,
    ]
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
      } finally {
        await releaseMonsterEditLock(id);
      }
    },
    [monsterById, releaseMonsterEditLock, updateMonsterFields]
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
      } finally {
        await releaseMonsterEditLock(id);
      }
    },
    [monsterById, releaseMonsterEditLock, updateMonsterFields]
  );

  const handleNextSpawnTimeChange = useCallback(
    async (id: string, targetSpawnMs: number) => {
      const monster = monsterById.get(id);
      if (!monster) {
        await releaseMonsterEditLock(id);
        return;
      }

      const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
        monster,
        targetSpawnMs
      );
      if (monster.lastKilledTimestamp === nextLastKilledTimestamp) {
        await releaseMonsterEditLock(id);
        return;
      }

      try {
        await updateMonsterFields(id, { lastKilledTimestamp: nextLastKilledTimestamp });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster next spawn timestamp", error);
      } finally {
        await releaseMonsterEditLock(id);
      }
    },
    [monsterById, releaseMonsterEditLock, updateMonsterFields]
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
      } finally {
        await releaseMonsterEditLock(id);
      }
    },
    [monsterById, releaseMonsterEditLock, updateMonsterFields]
  );

  const handleTableInteraction = useCallback(
    (id: string) => {
      if (
        activeInteractionSurface === "table" &&
        activeInteractionMonsterId === id &&
        isInteractionLocked
      ) {
        ensureMonsterEditLock(id);
        return;
      }
      if (persistentLockForTopCard && activeInteractionSurface === "top5") {
        releaseInteractionLock();
      }
      setActiveInteractionSurface("table");
      ensureMonsterEditLock(id);
      triggerInteractionLock(tableSortedMonsterIds, {
        mode: "auto",
        activeInteractionMonsterId: id,
      });
    },
    [
      activeInteractionMonsterId,
      activeInteractionSurface,
      ensureMonsterEditLock,
      isInteractionLocked,
      persistentLockForTopCard,
      releaseInteractionLock,
      tableSortedMonsterIds,
      triggerInteractionLock,
    ]
  );

  const handleTopCardOffsetInteraction = useCallback(
    (id: string) => {
      if (
        activeInteractionSurface === "top5" &&
        activeInteractionMonsterId === id &&
        persistentLockForTopCard
      ) {
        ensureMonsterEditLock(id);
        return;
      }
      setActiveInteractionSurface("top5");
      ensureMonsterEditLock(id);
      triggerInteractionLock(timeSortedMonsterIds, {
        mode: "persistentTopCard",
        activeInteractionMonsterId: id,
      });
    },
    [
      activeInteractionMonsterId,
      activeInteractionSurface,
      ensureMonsterEditLock,
      persistentLockForTopCard,
      timeSortedMonsterIds,
      triggerInteractionLock,
    ]
  );

  const handleTableRowEditingEnd = useCallback(
    (id: string) => {
      if (activeCollaborativeLockMonsterIdRef.current !== id) {
        return;
      }
      void releaseMonsterEditLock(id);
    },
    [releaseMonsterEditLock]
  );

  const handleResetNow = useCallback(
    async (id: string) => {
      try {
        await releaseMonsterEditLock(id);
        await updateMonsterFields(id, { lastKilledTimestamp: new Date().toISOString() });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to reset monster timer", error);
      }
    },
    [releaseMonsterEditLock, updateMonsterFields]
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
      if (activeCollaborativeLockMonsterIdRef.current !== id) {
        return;
      }
      void releaseMonsterEditLock(id);
    },
    [
      activeInteractionMonsterId,
      activeInteractionSurface,
      persistentLockForTopCard,
      releaseMonsterEditLock,
      releaseInteractionLock,
    ]
  );

  const handleDeleteMonsterRequest = useCallback((id: string) => {
    if (persistentLockForTopCard && activeInteractionSurface === "top5") {
      releaseInteractionLock();
    }
    void releaseMonsterEditLock(id);
    setPendingDeleteMonsterId(id);
  }, [activeInteractionSurface, persistentLockForTopCard, releaseMonsterEditLock, releaseInteractionLock]);

  const handleDeleteMonsterCancel = useCallback(() => {
    if (pendingDeleteMonsterId) {
      void releaseMonsterEditLock(pendingDeleteMonsterId);
    }
    setPendingDeleteMonsterId(null);
  }, [pendingDeleteMonsterId, releaseMonsterEditLock]);

  const handleDeleteMonsterConfirm = useCallback(async () => {
    if (!pendingDeleteMonsterId) {
      return;
    }

    releaseInteractionLock();
    await releaseMonsterEditLock(pendingDeleteMonsterId);

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
  }, [getMonsterDocRef, pendingDeleteMonsterId, releaseInteractionLock, releaseMonsterEditLock]);

  const handleSetExactRequest = useCallback((id: string) => {
    setSetExactMonsterId(id);
  }, []);

  const handleSetExactCancel = useCallback(() => {
    if (setExactMonsterId) {
      void releaseMonsterEditLock(setExactMonsterId);
    }
    setSetExactMonsterId(null);
  }, [releaseMonsterEditLock, setExactMonsterId]);

  const handleSetExactConfirm = useCallback(
    async (hours: number, minutes: number) => {
      if (!setExactMonsterId) {
        return;
      }

      const targetMonsterId = setExactMonsterId;
      const monster = monsterById.get(setExactMonsterId);
      if (!monster) {
        setSetExactMonsterId(null);
        await releaseMonsterEditLock(targetMonsterId);
        return;
      }

      const targetSpawnMs = calculateSetExactTargetSpawnMs(hours, minutes, Date.now());
      const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
        monster,
        targetSpawnMs
      );

      if (monster.lastKilledTimestamp === nextLastKilledTimestamp) {
        setSetExactMonsterId(null);
        await releaseMonsterEditLock(targetMonsterId);
        return;
      }

      triggerInteractionLock();
      try {
        await updateMonsterFields(targetMonsterId, {
          lastKilledTimestamp: nextLastKilledTimestamp,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to apply set exact", error);
      } finally {
        setSetExactMonsterId(null);
        await releaseMonsterEditLock(targetMonsterId);
      }
    },
    [monsterById, releaseMonsterEditLock, setExactMonsterId, triggerInteractionLock, updateMonsterFields]
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

  const handleLogout = useCallback(async () => {
    if (!auth) {
      return;
    }

    try {
      await releaseMonsterEditLock(activeCollaborativeLockMonsterIdRef.current);
      await signOut(auth);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to sign out.");
      console.error("Failed to sign out", error);
    }
  }, [releaseMonsterEditLock]);

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
              categoryId: monster.categoryId ?? null,
              editingBy: null,
              editingByUid: null,
              editingStartedAtMs: null,
            })
          )
        )
      );
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to import CSV monsters", error);
    }
  }, [requireDb]);

  const handleOpenClipboardImport = useCallback(() => {
    setIsClipboardImportOpen(true);
  }, []);

  const handleCloseClipboardImport = useCallback(() => {
    setIsClipboardImportOpen(false);
  }, []);

  const handleImportFromClipboard = useCallback(
    async (clipboardText: string): Promise<ClipboardImportResult> => {
      const activeDb = requireDb();
      if (!activeDb) {
        return { importedCount: 0, skippedCount: 0 };
      }

      const nowIso = new Date().toISOString();
      const { imported, skippedCount } = parseClipboardImport(clipboardText, nowIso);

      if (imported.length === 0) {
        return { importedCount: 0, skippedCount };
      }

      const batchSize = 450;
      let importedCount = 0;

      try {
        for (let index = 0; index < imported.length; index += batchSize) {
          const chunk = imported.slice(index, index + batchSize);
          const batch = writeBatch(activeDb);

          for (const monster of chunk) {
            const monsterDocRef = doc(collection(activeDb, MONSTERS_COLLECTION));
            batch.set(monsterDocRef, toFirestoreMonsterPayload(monster));
          }

          await batch.commit();
          importedCount += chunk.length;
        }
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to import clipboard monsters", error);
      }

      return { importedCount, skippedCount };
    },
    [requireDb]
  );

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

  if (!isAuthResolved || !authUser) {
    return <LoginScreen isAuthResolved={isAuthResolved} authError={authError} />;
  }

  if (!isUserProfileResolved) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <h1>MVP Tracker</h1>
          <p className="login-status">Loading your profile...</p>
        </section>
      </main>
    );
  }

  if (!currentUserProfile) {
    return (
      <NicknameModal
        isOpen
        email={authUser.email}
        isSaving={isSavingNickname}
        errorMessage={nicknameError}
        onSave={handleSaveNickname}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="header-row">
        <h1>MVP Tracker</h1>
        <TopControlsBar
          hasMonsters={monsters.length > 0}
          soundEnabled={soundEnabled}
          userDisplayName={authDisplayName}
          userEmail={authUser.email}
          userPhotoUrl={authUser.photoURL}
          onOpenSettings={handleOpenSettings}
          onToggleSound={handleToggleSound}
          onResetAll={handleResetAllRequest}
          onClearAll={handleClearAllRequest}
          onImportCsv={handleImportCsv}
          onImportClipboard={handleOpenClipboardImport}
          onLogout={handleLogout}
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
        currentUserUid={authUserId}
      />

      <div className="content-grid">
        <MonsterTable
          monsters={monsters}
          sortOption={tableSortOption}
          lockedOrderIds={lockedOrderIds}
          categoryMap={categoryMap}
          onSortOptionChange={handleTableSortOptionChange}
          onEditNameRequest={handleEditNameRequest}
          onRespawnHoursMinutesChange={handleRespawnHoursMinutesChange}
          onLastKilledChange={handleLastKilledChange}
          onNextSpawnTimeChange={handleNextSpawnTimeChange}
          onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
          onResetNow={handleResetNow}
          onDelete={handleDeleteMonsterRequest}
          onSetExact={handleSetExactRequest}
          onInteraction={handleTableInteraction}
          onRowEditingEnd={handleTableRowEditingEnd}
          onOpenAddMonster={handleOpenAddMonster}
          onOpenCategories={handleOpenCategories}
          activeEditingMonsterId={
            activeInteractionSurface === "table" ? activeInteractionMonsterId : null
          }
          isInteractionLocked={isInteractionLocked && activeInteractionSurface === "table"}
          currentUserUid={authUserId}
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

      <ClipboardImportModal
        isOpen={isClipboardImportOpen}
        onCancel={handleCloseClipboardImport}
        onImport={handleImportFromClipboard}
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
        selectedCategoryId={editNameMonster?.categoryId ?? null}
        categories={categories}
        onCancel={handleEditNameCancel}
        onSave={handleEditNameConfirm}
      />

      <AddMonsterModal
        isOpen={isAddMonsterOpen}
        categories={categories}
        onCancel={handleCloseAddMonster}
        onCreate={handleCreateMonster}
      />

      <CategoriesModal
        isOpen={isCategoriesOpen}
        categories={categories}
        onCancel={handleCloseCategories}
        onCreateCategory={handleCreateCategory}
        onUpdateCategory={handleUpdateCategory}
        onDeleteCategory={handleDeleteCategory}
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
