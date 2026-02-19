import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { WindowTitleBar } from "./components/WindowTitleBar";
import { auth, authInitError } from "./auth";
import { db, firebaseInitError } from "./firebase";
import { Category, Monster, TopCount, TrackedByUser } from "./types";
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

type FirestoreMonster = {
  id: string;
  name: string;
  respawnDuration: number;
  lastKilledTimestamp: string;
  lastTrackedByUid: string | null;
  offsetSeconds: number;
  categoryId: string | null;
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
  photoURL: string | null;
};

type FirestoreTrackedUser = Pick<FirestoreUserProfile, "uid" | "nickname" | "photoURL">;

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
const APP_TITLE = "MVP Tracker";
const HEADER_LOGO_SRC = `${import.meta.env.BASE_URL}mvp-header.png`;

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
      lastTrackedByUid: null,
      offsetSeconds: 0,
      categoryId: null,
    });
  }

  return { imported, skippedCount };
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
    lastTrackedByUid:
      typeof data.lastTrackedByUid === "string" && data.lastTrackedByUid.trim()
        ? data.lastTrackedByUid.trim()
        : null,
    offsetSeconds: typeof data.offsetSeconds === "number" ? Math.trunc(data.offsetSeconds) : 0,
    categoryId: typeof data.categoryId === "string" && data.categoryId.trim() ? data.categoryId : null,
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
    photoURL:
      typeof data.photoURL === "string" && data.photoURL.trim() ? data.photoURL.trim() : null,
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
    lastTrackedByUid: monster.lastTrackedByUid,
    offsetSeconds: monster.offsetSeconds,
    categoryId: monster.categoryId,
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
  const [topCategoryFilterId, setTopCategoryFilterId] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<FirestoreUserProfile | null>(null);
  const [trackedUsers, setTrackedUsers] = useState<FirestoreTrackedUser[]>([]);
  const [isUserProfileResolved, setIsUserProfileResolved] = useState(false);
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [authError, setAuthError] = useState<string | null>(() => authInitError);
  const [isHeaderImageAvailable, setIsHeaderImageAvailable] = useState(true);
  const [isFirestoreConnected, setIsFirestoreConnected] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(() => firebaseInitError);
  const monsterDocIdByMonsterIdRef = useRef<Map<string, string>>(new Map());
  const categoryDocIdByCategoryIdRef = useRef<Map<string, string>>(new Map());
  const monsterByIdRef = useRef<Map<string, Monster>>(new Map());
  const authUserId = authUser?.uid ?? null;
  const authDisplayName =
    (currentUserProfile?.nickname ?? authUser?.displayName ?? authUser?.email ?? "Account").trim() ||
    "Account";
  const trackedByUserMap = useMemo(() => {
    const next = new Map<string, TrackedByUser>();
    for (const trackedUser of trackedUsers) {
      next.set(trackedUser.uid, {
        nickname: trackedUser.nickname,
        photoURL: trackedUser.photoURL,
      });
    }

    if (authUserId) {
      const existing = next.get(authUserId);
      const fallbackNickname =
        (existing?.nickname ??
          currentUserProfile?.nickname ??
          authUser?.displayName ??
          authUser?.email ??
          "Account")
          .trim() || "Account";

      next.set(authUserId, {
        nickname: fallbackNickname,
        photoURL: authUser?.photoURL ?? existing?.photoURL ?? null,
      });
    }

    return next;
  }, [
    authUser?.displayName,
    authUser?.email,
    authUser?.photoURL,
    authUserId,
    currentUserProfile?.nickname,
    trackedUsers,
  ]);

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
            photoURL: authUser.photoURL ?? null,
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

  const filteredTimeSortedMonsters = useMemo(
    () =>
      topCategoryFilterId
        ? timeSortedMonsters.filter((monster) => monster.categoryId === topCategoryFilterId)
        : timeSortedMonsters,
    [timeSortedMonsters, topCategoryFilterId]
  );
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

  useEffect(() => {
    monsterByIdRef.current = monsterById;
  }, [monsterById]);

  const resetSessionState = useCallback(() => {
    monsterDocIdByMonsterIdRef.current = new Map();
    categoryDocIdByCategoryIdRef.current = new Map();
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
    setCurrentUserProfile(null);
    setTrackedUsers([]);
    setTopCategoryFilterId(null);
    setIsUserProfileResolved(false);
    setIsSavingNickname(false);
    setNicknameError(null);
  }, []);

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
    if (!isAuthResolved || !authUserId) {
      setTrackedUsers([]);
      return;
    }

    if (!db) {
      setTrackedUsers([]);
      return;
    }

    const usersCollectionRef = collection(db, USERS_COLLECTION);
    const unsubscribe = onSnapshot(
      usersCollectionRef,
      (snapshot) => {
        const nextTrackedUsers: FirestoreTrackedUser[] = [];
        snapshot.forEach((snapshotDoc) => {
          const normalizedProfile = normalizeFirestoreUserProfile(snapshotDoc.data(), snapshotDoc.id, null);
          if (!normalizedProfile) {
            return;
          }

          nextTrackedUsers.push({
            uid: normalizedProfile.uid,
            nickname: normalizedProfile.nickname,
            photoURL: normalizedProfile.photoURL,
          });
        });
        setTrackedUsers(nextTrackedUsers);
      },
      (error) => {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Firestore users listener failed", error);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [authUserId, isAuthResolved]);

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

  const topMonsters = useMemo(
    () => filteredTimeSortedMonsters.slice(0, topCount),
    [filteredTimeSortedMonsters, topCount]
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
        lastTrackedByUid: null,
        offsetSeconds: 0,
        categoryId: input.categoryId,
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
    setEditNameMonsterId(null);
  }, []);

  const handleEditNameConfirm = useCallback(
    async (name: string, categoryId: string | null) => {
      if (!editNameMonsterId) {
        return;
      }

      const monster = monsterById.get(editNameMonsterId);
      const trimmed = name.trim();
      const nextCategoryId = categoryId ?? null;
      if (
        !monster ||
        !trimmed ||
        (monster.name === trimmed && (monster.categoryId ?? null) === nextCategoryId)
      ) {
        setEditNameMonsterId(null);
        return;
      }

      setEditNameMonsterId(null);
      try {
        await updateMonsterFields(editNameMonsterId, { name: trimmed, categoryId: nextCategoryId });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster name", error);
      }
    },
    [editNameMonsterId, monsterById, updateMonsterFields]
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
      if (!authUserId) {
        return;
      }

      const monster = monsterById.get(id);
      if (!monster || monster.lastKilledTimestamp === iso) {
        return;
      }

      try {
        await updateMonsterFields(id, { lastKilledTimestamp: iso, lastTrackedByUid: authUserId });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster last killed timestamp", error);
      }
    },
    [authUserId, monsterById, updateMonsterFields]
  );

  const handleNextSpawnTimeChange = useCallback(
    async (id: string, targetSpawnMs: number) => {
      if (!authUserId) {
        return;
      }

      const monster = monsterById.get(id);
      if (!monster) {
        return;
      }

      const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
        monster,
        targetSpawnMs
      );
      if (monster.lastKilledTimestamp === nextLastKilledTimestamp) {
        return;
      }

      try {
        await updateMonsterFields(id, {
          lastKilledTimestamp: nextLastKilledTimestamp,
          lastTrackedByUid: authUserId,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster next spawn timestamp", error);
      }
    },
    [authUserId, monsterById, updateMonsterFields]
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

  const handleResetNow = useCallback(
    async (id: string) => {
      if (!authUserId) {
        return;
      }

      const nowIso = new Date().toISOString();
      const previousMonster = monsterByIdRef.current.get(id);

      setMonsters((prev) => {
        let didChange = false;
        const next = prev.map((monster) => {
          if (monster.id !== id) {
            return monster;
          }

          didChange = true;
          return {
            ...monster,
            lastKilledTimestamp: nowIso,
            lastTrackedByUid: authUserId,
            hasNotifiedReady: false,
          };
        });
        return didChange ? next : prev;
      });

      try {
        await updateMonsterFields(id, { lastKilledTimestamp: nowIso, lastTrackedByUid: authUserId });
      } catch (error) {
        if (previousMonster) {
          setMonsters((prev) =>
            prev.map((monster) => {
              if (monster.id !== id || monster.lastKilledTimestamp !== nowIso) {
                return monster;
              }

              return {
                ...monster,
                lastKilledTimestamp: previousMonster.lastKilledTimestamp,
                lastTrackedByUid: previousMonster.lastTrackedByUid,
                hasNotifiedReady: previousMonster.hasNotifiedReady,
              };
            })
          );
        }
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to reset monster timer", error);
      }
    },
    [authUserId, updateMonsterFields]
  );

  const handleTopCardTrack = useCallback(
    async (id: string) => {
      await handleResetNow(id);
    },
    [handleResetNow]
  );

  const handleDeleteMonsterRequest = useCallback((id: string) => {
    setPendingDeleteMonsterId(id);
  }, []);

  const handleDeleteMonsterCancel = useCallback(() => {
    setPendingDeleteMonsterId(null);
  }, []);

  const handleDeleteMonsterConfirm = useCallback(async () => {
    if (!pendingDeleteMonsterId) {
      return;
    }

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
  }, [getMonsterDocRef, pendingDeleteMonsterId]);

  const handleSetExactRequest = useCallback((id: string) => {
    setSetExactMonsterId(id);
  }, []);

  const handleSetExactCancel = useCallback(() => {
    setSetExactMonsterId(null);
  }, []);

  const handleSetExactConfirm = useCallback(
    async (hours: number, minutes: number) => {
      if (!setExactMonsterId || !authUserId) {
        return;
      }

      const monster = monsterById.get(setExactMonsterId);
      if (!monster) {
        setSetExactMonsterId(null);
        return;
      }

      const targetSpawnMs = calculateSetExactTargetSpawnMs(hours, minutes, Date.now());
      const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
        monster,
        targetSpawnMs
      );

      if (monster.lastKilledTimestamp === nextLastKilledTimestamp) {
        setSetExactMonsterId(null);
        return;
      }

      try {
        await updateMonsterFields(setExactMonsterId, {
          lastKilledTimestamp: nextLastKilledTimestamp,
          lastTrackedByUid: authUserId,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to apply set exact", error);
      } finally {
        setSetExactMonsterId(null);
      }
    },
    [authUserId, monsterById, setExactMonsterId, updateMonsterFields]
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
      await signOut(auth);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to sign out.");
      console.error("Failed to sign out", error);
    }
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
              lastTrackedByUid: monster.lastTrackedByUid,
              offsetSeconds: monster.offsetSeconds ?? 0,
              categoryId: monster.categoryId ?? null,
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

  const renderWithWindowChrome = useCallback((content: ReactNode) => {
    if (!window.electronAPI?.windowControls) {
      return content;
    }

    return (
      <>
        <WindowTitleBar />
        <div className="window-content">{content}</div>
      </>
    );
  }, []);

  if (!isAuthResolved || !authUser) {
    return renderWithWindowChrome(
      <LoginScreen isAuthResolved={isAuthResolved} authError={authError} />
    );
  }

  if (!isUserProfileResolved) {
    return renderWithWindowChrome(
      <main className="login-shell">
        <section className="login-panel">
          <h1>{APP_TITLE}</h1>
          <p className="login-status">Loading your profile...</p>
        </section>
      </main>
    );
  }

  if (!currentUserProfile) {
    return renderWithWindowChrome(
      <NicknameModal
        isOpen
        email={authUser.email}
        isSaving={isSavingNickname}
        errorMessage={nicknameError}
        onSave={handleSaveNickname}
      />
    );
  }

  return renderWithWindowChrome(
    <main className="app-shell">
      <header className="header-row">
        <div className="header-brand">
          {isHeaderImageAvailable ? (
            <img
              className="header-logo"
              src={HEADER_LOGO_SRC}
              alt={APP_TITLE}
              onError={() => setIsHeaderImageAvailable(false)}
            />
          ) : (
            <h1>{APP_TITLE}</h1>
          )}
        </div>
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
        trackedByUserMap={trackedByUserMap}
      />

      <div className="content-grid">
        <MonsterTable
          monsters={monsters}
          sortOption={tableSortOption}
          categoryMap={categoryMap}
          onCategoryFilterSelectionChange={setTopCategoryFilterId}
          onSortOptionChange={handleTableSortOptionChange}
          onEditNameRequest={handleEditNameRequest}
          onRespawnHoursMinutesChange={handleRespawnHoursMinutesChange}
          onLastKilledChange={handleLastKilledChange}
          onNextSpawnTimeChange={handleNextSpawnTimeChange}
          onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
          onResetNow={handleResetNow}
          onDelete={handleDeleteMonsterRequest}
          onSetExact={handleSetExactRequest}
          trackedByUserMap={trackedByUserMap}
          onOpenAddMonster={handleOpenAddMonster}
          onOpenCategories={handleOpenCategories}
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
