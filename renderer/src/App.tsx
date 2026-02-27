import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  documentId,
  doc,
  type DocumentData,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  type FirestoreError,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { AddMonsterModal } from "./components/AddMonsterModal";
import { CategoriesModal } from "./components/CategoriesModal";
import { ClipboardImportModal } from "./components/ClipboardImportModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { EditNameModal } from "./components/EditNameModal";
import { HistoryModal } from "./components/HistoryModal";
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
import {
  Category,
  type HistoryFilters,
  type HistorySort,
  type HistorySortColumn,
  Monster,
  MonsterHistoryEntry,
  TopCount,
  TrackedByUser,
} from "./types";
import {
  AlertSettings,
  loadAlertSettings,
  loadAutoReturnToPreviousAppEnabled,
  loadGlobalHotkeysEnabled,
  saveAlertSettings,
  saveAutoReturnToPreviousAppEnabled,
  saveGlobalHotkeysEnabled,
} from "./utils/settings";
import { preloadCustomAlert } from "./utils/sound";
import {
  calculateLastKilledTimestampForTargetSpawn,
  calculateNextSpawn,
  calculateSetExactTargetSpawnMs,
  convertHoursMinutesToSeconds,
  formatDuration,
  formatOffsetSeconds,
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
type FirestoreHistoryEntry = MonsterHistoryEntry;
type MonsterHistoryWriteInput = Omit<FirestoreHistoryEntry, "id" | "timestampIso" | "userUid" | "userNickname">;

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

type HistoryHeadPointer = Pick<MonsterHistoryEntry, "id" | "timestampIso">;

type PersistedHistoryLocalCache = {
  version: 1;
  entries: MonsterHistoryEntry[];
  totalEntries: number;
  isComplete: boolean;
};

const MONSTERS_COLLECTION = "monsters";
const CATEGORIES_COLLECTION = "categories";
const USERS_COLLECTION = "users";
const HISTORY_COLLECTION = "monsterHistory";
const DEFAULT_HISTORY_ROWS_PER_PAGE = 12;
const HISTORY_SYNC_BATCH_SIZE = 450;
const HISTORY_LOCAL_CACHE_INDEXEDDB_NAME = "mvp-tracker-history-cache";
const HISTORY_LOCAL_CACHE_INDEXEDDB_VERSION = 1;
const HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME = "historyLocalCache";
const PROFILE_QUERY_UID_CHUNK_SIZE = 10;
const APP_TITLE = "MVP Tracker";
const HEADER_LOGO_SRC = `${import.meta.env.BASE_URL}mvp-header.png`;
const HISTORY_EMBEDDED_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g;
const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  name: "",
  monsterName: "",
  action: "",
  previousValue: "",
  currentValue: "",
};
const DEFAULT_HISTORY_SORT: HistorySort = {
  column: "timestamp",
  direction: "desc",
};

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

function splitIntoChunks<T>(values: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [values];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
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

function normalizeFirestoreHistoryEntry(raw: unknown, fallbackId: string): FirestoreHistoryEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const data = raw as Partial<FirestoreHistoryEntry>;
  if (typeof data.timestampIso !== "string" || Number.isNaN(Date.parse(data.timestampIso))) {
    return null;
  }

  const action = typeof data.action === "string" ? data.action.trim() : "";
  if (!action) {
    return null;
  }

  const nickname = typeof data.userNickname === "string" ? data.userNickname.trim() : "";
  const monsterName = typeof data.monsterName === "string" ? data.monsterName.trim() : "";

  return {
    id: typeof data.id === "string" && data.id.trim() ? data.id : fallbackId,
    timestampIso: data.timestampIso,
    userUid: typeof data.userUid === "string" && data.userUid.trim() ? data.userUid.trim() : null,
    userNickname: nickname || "Unknown User",
    monsterId: typeof data.monsterId === "string" && data.monsterId.trim() ? data.monsterId.trim() : null,
    monsterName: monsterName || "Unknown Monster",
    action,
    previousValue: typeof data.previousValue === "string" ? data.previousValue : "",
    currentValue: typeof data.currentValue === "string" ? data.currentValue : "",
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

function compareHistoryEntriesByTimestampDesc(left: MonsterHistoryEntry, right: MonsterHistoryEntry): number {
  const leftTimestamp = Date.parse(left.timestampIso);
  const rightTimestamp = Date.parse(right.timestampIso);
  if (leftTimestamp !== rightTimestamp) {
    return compareNumbers(rightTimestamp, leftTimestamp);
  }
  return compareText(right.id, left.id);
}

function mergeHistoryEntriesDescending(
  previous: MonsterHistoryEntry[],
  incoming: MonsterHistoryEntry[]
): MonsterHistoryEntry[] {
  if (incoming.length === 0) {
    return previous;
  }

  const byId = new Map<string, MonsterHistoryEntry>();
  for (const entry of previous) {
    byId.set(entry.id, entry);
  }
  for (const entry of incoming) {
    byId.set(entry.id, entry);
  }

  const merged = Array.from(byId.values());
  merged.sort(compareHistoryEntriesByTimestampDesc);
  return merged;
}

function areHistoryEntryListsEqualById(
  left: MonsterHistoryEntry[],
  right: MonsterHistoryEntry[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.id !== right[index]?.id) {
      return false;
    }
  }

  return true;
}

function collectHistoryUserUids(entries: MonsterHistoryEntry[]): string[] {
  const uidSet = new Set<string>();
  for (const entry of entries) {
    const uid = entry.userUid?.trim();
    if (uid) {
      uidSet.add(uid);
    }
  }

  return Array.from(uidSet).sort((left, right) => left.localeCompare(right));
}

function areSortedStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function toHistoryHeadPointer(entry: MonsterHistoryEntry | null | undefined): HistoryHeadPointer | null {
  if (!entry) {
    return null;
  }

  return {
    id: entry.id,
    timestampIso: entry.timestampIso,
  };
}

function areHistoryHeadPointersEqual(left: HistoryHeadPointer | null, right: HistoryHeadPointer | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.id === right.id;
}

function pickOlderHistoryHeadPointer(
  current: HistoryHeadPointer | null,
  incoming: HistoryHeadPointer | null
): HistoryHeadPointer | null {
  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const currentMs = Date.parse(current.timestampIso);
  const incomingMs = Date.parse(incoming.timestampIso);
  if (Number.isNaN(currentMs) || Number.isNaN(incomingMs)) {
    return incoming;
  }
  if (incomingMs < currentMs) {
    return incoming;
  }
  if (incomingMs > currentMs) {
    return current;
  }
  return compareText(incoming.id, current.id) <= 0 ? incoming : current;
}

function openHistoryLocalCacheIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(
      HISTORY_LOCAL_CACHE_INDEXEDDB_NAME,
      HISTORY_LOCAL_CACHE_INDEXEDDB_VERSION
    );

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME)) {
        database.createObjectStore(HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME, {
          keyPath: "userUid",
        });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open history cache IndexedDB."));
    };
  });
}

async function readHistoryLocalCacheFromIndexedDb(userUid: string): Promise<PersistedHistoryLocalCache | null> {
  let database: IDBDatabase | null = null;
  try {
    database = await openHistoryLocalCacheIndexedDb();
    if (!database) {
      return null;
    }
    const openedDatabase = database;

    const record = await new Promise<unknown>((resolve, reject) => {
      const transaction = openedDatabase.transaction(HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME, "readonly");
      const store = transaction.objectStore(HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME);
      const request = store.get(userUid);

      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to read history cache from IndexedDB."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB history cache read transaction aborted."));
      };
    });

    if (typeof record !== "object" || record === null) {
      return null;
    }

    const parsed = record as Partial<PersistedHistoryLocalCache> & { userUid?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return null;
    }

    const normalizedEntries: MonsterHistoryEntry[] = [];
    for (let index = 0; index < parsed.entries.length; index += 1) {
      const normalized = normalizeFirestoreHistoryEntry(parsed.entries[index], `cached-history-${index}`);
      if (!normalized) {
        continue;
      }
      normalizedEntries.push(normalized);
    }

    normalizedEntries.sort(compareHistoryEntriesByTimestampDesc);
    const totalEntriesRaw = typeof parsed.totalEntries === "number" ? Math.trunc(parsed.totalEntries) : 0;
    const persistedTotalEntries = Math.max(normalizedEntries.length, totalEntriesRaw);
    const isComplete = Boolean(parsed.isComplete) || normalizedEntries.length >= persistedTotalEntries;
    const totalEntries = isComplete ? normalizedEntries.length : persistedTotalEntries;

    return {
      version: 1,
      entries: normalizedEntries,
      totalEntries,
      isComplete,
    };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

async function writeHistoryLocalCacheToIndexedDb(
  userUid: string,
  cache: PersistedHistoryLocalCache
): Promise<void> {
  let database: IDBDatabase | null = null;
  try {
    database = await openHistoryLocalCacheIndexedDb();
    if (!database) {
      return;
    }
    const openedDatabase = database;

    await new Promise<void>((resolve, reject) => {
      const transaction = openedDatabase.transaction(HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME, "readwrite");
      const store = transaction.objectStore(HISTORY_LOCAL_CACHE_INDEXEDDB_STORE_NAME);
      store.put({
        userUid,
        ...cache,
      });
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("Failed to write history cache to IndexedDB."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB history cache write transaction aborted."));
      };
    });
  } catch {
    // Ignore IndexedDB write failures to avoid blocking history rendering.
  } finally {
    database?.close();
  }
}

function normalizeHistoryFilterValue(value: string): string {
  return value.trim().toLowerCase();
}

function getActionLabelForHistoryFilters(action: string): string {
  const trimmed = action.trim();
  return trimmed === "Reset Timer Now" ? "Tracked Monster" : trimmed;
}

function formatHistoryEmbeddedTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hour24 = date.getHours();
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${month}/${day}/${year} - ${String(hour12).padStart(2, "0")}:${minutes} ${suffix}`;
}

function renderHistoryValueForComparison(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }
  return trimmed.replace(HISTORY_EMBEDDED_TIMESTAMP_PATTERN, (match) => formatHistoryEmbeddedTimestamp(match));
}

function hasActiveHistoryFilters(filters: HistoryFilters): boolean {
  return (
    normalizeHistoryFilterValue(filters.name).length > 0 ||
    normalizeHistoryFilterValue(filters.monsterName).length > 0 ||
    normalizeHistoryFilterValue(filters.action).length > 0 ||
    normalizeHistoryFilterValue(filters.previousValue).length > 0 ||
    normalizeHistoryFilterValue(filters.currentValue).length > 0
  );
}

function areHistoryFiltersEqual(left: HistoryFilters, right: HistoryFilters): boolean {
  return (
    normalizeHistoryFilterValue(left.name) === normalizeHistoryFilterValue(right.name) &&
    normalizeHistoryFilterValue(left.monsterName) === normalizeHistoryFilterValue(right.monsterName) &&
    normalizeHistoryFilterValue(left.action) === normalizeHistoryFilterValue(right.action) &&
    normalizeHistoryFilterValue(left.previousValue) === normalizeHistoryFilterValue(right.previousValue) &&
    normalizeHistoryFilterValue(left.currentValue) === normalizeHistoryFilterValue(right.currentValue)
  );
}

function isDefaultHistorySort(sort: HistorySort): boolean {
  return sort.column === DEFAULT_HISTORY_SORT.column && sort.direction === DEFAULT_HISTORY_SORT.direction;
}

function getHistorySortValue(entry: MonsterHistoryEntry, column: HistorySortColumn): string | number {
  switch (column) {
    case "timestamp":
      return Date.parse(entry.timestampIso);
    case "name":
      return entry.userNickname.trim().toLowerCase();
    case "monsterName":
      return entry.monsterName.trim().toLowerCase();
    case "action":
      return getActionLabelForHistoryFilters(entry.action).trim().toLowerCase();
    case "previousValue":
      return renderHistoryValueForComparison(entry.previousValue).trim().toLowerCase();
    case "currentValue":
      return renderHistoryValueForComparison(entry.currentValue).trim().toLowerCase();
    default:
      return "";
  }
}

function sortHistoryEntries(entries: MonsterHistoryEntry[], sort: HistorySort): MonsterHistoryEntry[] {
  const directionModifier = sort.direction === "asc" ? 1 : -1;
  return [...entries].sort((left, right) => {
    const leftValue = getHistorySortValue(left, sort.column);
    const rightValue = getHistorySortValue(right, sort.column);

    let comparison = 0;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = compareNumbers(leftValue, rightValue);
    } else {
      comparison = compareText(String(leftValue), String(rightValue));
    }

    if (comparison !== 0) {
      return comparison * directionModifier;
    }

    return compareHistoryEntriesByTimestampDesc(left, right);
  });
}

function matchesHistoryFilters(entry: MonsterHistoryEntry, filters: HistoryFilters): boolean {
  const nameFilter = normalizeHistoryFilterValue(filters.name);
  const monsterNameFilter = normalizeHistoryFilterValue(filters.monsterName);
  const actionFilter = normalizeHistoryFilterValue(filters.action);
  const previousValueFilter = normalizeHistoryFilterValue(filters.previousValue);
  const currentValueFilter = normalizeHistoryFilterValue(filters.currentValue);

  if (nameFilter && !entry.userNickname.trim().toLowerCase().includes(nameFilter)) {
    return false;
  }
  if (monsterNameFilter && !entry.monsterName.trim().toLowerCase().includes(monsterNameFilter)) {
    return false;
  }
  if (
    actionFilter &&
    !getActionLabelForHistoryFilters(entry.action).trim().toLowerCase().includes(actionFilter)
  ) {
    return false;
  }
  if (
    previousValueFilter &&
    !renderHistoryValueForComparison(entry.previousValue).trim().toLowerCase().includes(previousValueFilter)
  ) {
    return false;
  }
  if (
    currentValueFilter &&
    !renderHistoryValueForComparison(entry.currentValue).trim().toLowerCase().includes(currentValueFilter)
  ) {
    return false;
  }

  return true;
}

export function App() {
  // Monsters are kept in one top-level state store to keep updates predictable.
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isAddMonsterOpen, setIsAddMonsterOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => loadAlertSettings());
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);
  const [isResetAllOpen, setIsResetAllOpen] = useState(false);
  const [pendingDeleteMonsterId, setPendingDeleteMonsterId] = useState<string | null>(null);
  const [setExactMonsterId, setSetExactMonsterId] = useState<string | null>(null);
  const [editNameMonsterId, setEditNameMonsterId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadSoundEnabled());
  const [hotkeysEnabled, setHotkeysEnabled] = useState<boolean>(() => loadGlobalHotkeysEnabled());
  const [autoReturnToPreviousAppEnabled, setAutoReturnToPreviousAppEnabled] = useState<boolean>(() =>
    loadAutoReturnToPreviousAppEnabled()
  );
  const [topCount, setTopCount] = useState<TopCount>(() => loadTopCount());
  const [isClipboardImportOpen, setIsClipboardImportOpen] = useState(false);
  const [tableSortOption, setTableSortOption] = useState<MonsterSortOption>(() =>
    loadMonsterSortOption()
  );
  const [topCategoryFilterId, setTopCategoryFilterId] = useState<string | null>(null);
  const [focusedMonsterId, setFocusedMonsterId] = useState<string | null>(null);
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
  const [historyEntries, setHistoryEntries] = useState<MonsterHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isHistorySyncing, setIsHistorySyncing] = useState(false);
  const [historyCurrentPage, setHistoryCurrentPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(DEFAULT_HISTORY_ROWS_PER_PAGE);
  const [historyHasNextPage, setHistoryHasNextPage] = useState(false);
  const [historyTotalEntries, setHistoryTotalEntries] = useState(0);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [historySort, setHistorySort] = useState<HistorySort>(DEFAULT_HISTORY_SORT);
  const [historyKnownUserUids, setHistoryKnownUserUids] = useState<string[]>([]);
  const [historyCacheVersion, setHistoryCacheVersion] = useState(0);
  const trackedUsersRef = useRef<FirestoreTrackedUser[]>([]);
  const monsterDocIdByMonsterIdRef = useRef<Map<string, string>>(new Map());
  const categoryDocIdByCategoryIdRef = useRef<Map<string, string>>(new Map());
  const monsterByIdRef = useRef<Map<string, Monster>>(new Map());
  const historyLocalCacheEntriesRef = useRef<MonsterHistoryEntry[]>([]);
  const historyLocalCacheTotalEntriesRef = useRef(0);
  const historyLocalCacheIsCompleteRef = useRef(false);
  const historyLocalCacheHydratedUserIdRef = useRef<string | null>(null);
  const historyLocalCachePendingPersistRef =
    useRef<{ userUid: string; cache: PersistedHistoryLocalCache } | null>(null);
  const historyLocalCachePersistingRef = useRef(false);
  const historyNavigationLockRef = useRef(false);
  const historySyncRequestedModeRef = useRef<"none" | "incremental" | "full">("none");
  const historySyncRequestedAnchorRef = useRef<HistoryHeadPointer | null>(null);
  const historySyncLoopRunningRef = useRef(false);
  const historySyncEpochRef = useRef(0);
  const historyRealtimeHeadRef = useRef<HistoryHeadPointer | null>(null);
  const historyHasOpenedViewRef = useRef(false);
  const historyHasDoneSessionInitialFullBackfillRef = useRef(false);
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
  const requiredTrackedUserUids = useMemo(() => {
    const uidSet = new Set<string>();

    for (const monster of monsters) {
      const uid = monster.lastTrackedByUid?.trim();
      if (uid) {
        uidSet.add(uid);
      }
    }

    for (const uid of historyKnownUserUids) {
      uidSet.add(uid);
    }

    if (authUserId) {
      uidSet.delete(authUserId);
    }

    return Array.from(uidSet).sort((left, right) => left.localeCompare(right));
  }, [authUserId, historyKnownUserUids, monsters]);
  // Keep a stable UID list reference when contents are unchanged to avoid listener churn.
  const requiredTrackedUserUidsSignature = useMemo(
    () => JSON.stringify(requiredTrackedUserUids),
    [requiredTrackedUserUids]
  );
  const stableRequiredTrackedUserUids = useMemo(
    () => [...requiredTrackedUserUids],
    [requiredTrackedUserUidsSignature]
  );

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

  const hydrateHistoryLocalCacheForActiveUser = useCallback(async () => {
    if (!authUserId || historyLocalCacheHydratedUserIdRef.current === authUserId) {
      return;
    }

    const persistedCache = await readHistoryLocalCacheFromIndexedDb(authUserId);
    if (persistedCache) {
      historyLocalCacheEntriesRef.current = persistedCache.entries;
      historyLocalCacheIsCompleteRef.current = persistedCache.isComplete;
      historyLocalCacheTotalEntriesRef.current = persistedCache.isComplete
        ? persistedCache.entries.length
        : Math.max(persistedCache.totalEntries, persistedCache.entries.length);
    } else {
      historyLocalCacheEntriesRef.current = [];
      historyLocalCacheTotalEntriesRef.current = 0;
      historyLocalCacheIsCompleteRef.current = false;
    }

    historyLocalCacheHydratedUserIdRef.current = authUserId;
    const nextKnownUserUids = collectHistoryUserUids(historyLocalCacheEntriesRef.current);
    setHistoryKnownUserUids((previous) =>
      areSortedStringArraysEqual(previous, nextKnownUserUids) ? previous : nextKnownUserUids
    );
    setHistoryCacheVersion((previous) => previous + 1);
  }, [authUserId]);

  const getLocalHistoryHeadPointer = useCallback((): HistoryHeadPointer | null => {
    return toHistoryHeadPointer(historyLocalCacheEntriesRef.current[0]);
  }, []);

  const flushHistoryLocalCachePersistQueue = useCallback(() => {
    if (historyLocalCachePersistingRef.current) {
      return;
    }

    historyLocalCachePersistingRef.current = true;
    void (async () => {
      try {
        while (historyLocalCachePendingPersistRef.current) {
          const nextPersist = historyLocalCachePendingPersistRef.current;
          historyLocalCachePendingPersistRef.current = null;
          await writeHistoryLocalCacheToIndexedDb(nextPersist.userUid, nextPersist.cache);
        }
      } finally {
        historyLocalCachePersistingRef.current = false;
        if (historyLocalCachePendingPersistRef.current) {
          flushHistoryLocalCachePersistQueue();
        }
      }
    })();
  }, []);

  const persistHistoryLocalCache = useCallback(() => {
    if (!authUserId) {
      return;
    }

    const entries = historyLocalCacheEntriesRef.current;
    const totalEntries = historyLocalCacheIsCompleteRef.current
      ? entries.length
      : Math.max(historyLocalCacheTotalEntriesRef.current, entries.length);
    historyLocalCacheTotalEntriesRef.current = totalEntries;
    historyLocalCachePendingPersistRef.current = {
      userUid: authUserId,
      cache: {
        version: 1,
        entries,
        totalEntries,
        isComplete: historyLocalCacheIsCompleteRef.current,
      },
    };
    flushHistoryLocalCachePersistQueue();
  }, [authUserId, flushHistoryLocalCachePersistQueue]);

  const mergeFetchedHistoryEntriesIntoLocalCache = useCallback(
    (
      entries: MonsterHistoryEntry[],
      options?: { totalEntries?: number; isComplete?: boolean }
    ) => {
      const previousEntries = historyLocalCacheEntriesRef.current;
      const nextEntries =
        entries.length > 0 ? mergeHistoryEntriesDescending(previousEntries, entries) : previousEntries;
      const didEntriesChange = !areHistoryEntryListsEqualById(previousEntries, nextEntries);
      if (didEntriesChange) {
        historyLocalCacheEntriesRef.current = nextEntries;
      }

      const previousTotalEntries = historyLocalCacheTotalEntriesRef.current;
      const previousIsComplete = historyLocalCacheIsCompleteRef.current;
      const willBeComplete = historyLocalCacheIsCompleteRef.current || options?.isComplete === true;
      if (willBeComplete) {
        historyLocalCacheIsCompleteRef.current = true;
        historyLocalCacheTotalEntriesRef.current = historyLocalCacheEntriesRef.current.length;
      } else if (typeof options?.totalEntries === "number") {
        historyLocalCacheTotalEntriesRef.current = Math.max(
          historyLocalCacheTotalEntriesRef.current,
          Math.trunc(options.totalEntries),
          historyLocalCacheEntriesRef.current.length
        );
      } else {
        historyLocalCacheTotalEntriesRef.current = Math.max(
          historyLocalCacheTotalEntriesRef.current,
          historyLocalCacheEntriesRef.current.length
        );
      }

      const didMetaChange =
        previousTotalEntries !== historyLocalCacheTotalEntriesRef.current ||
        previousIsComplete !== historyLocalCacheIsCompleteRef.current;
      if (!didEntriesChange && !didMetaChange) {
        return;
      }

      if (didEntriesChange) {
        const nextKnownUserUids = collectHistoryUserUids(historyLocalCacheEntriesRef.current);
        setHistoryKnownUserUids((previous) =>
          areSortedStringArraysEqual(previous, nextKnownUserUids) ? previous : nextKnownUserUids
        );
      }

      setHistoryCacheVersion((previous) => previous + 1);
      persistHistoryLocalCache();
    },
    [persistHistoryLocalCache]
  );

  const replaceHistoryLocalCacheEntries = useCallback(
    (entries: MonsterHistoryEntry[], options: { isComplete: boolean }) => {
      const deduplicatedEntries = mergeHistoryEntriesDescending([], entries);
      const previousEntries = historyLocalCacheEntriesRef.current;
      const didEntriesChange = !areHistoryEntryListsEqualById(previousEntries, deduplicatedEntries);
      if (didEntriesChange) {
        historyLocalCacheEntriesRef.current = deduplicatedEntries;
      }

      const previousTotalEntries = historyLocalCacheTotalEntriesRef.current;
      const previousIsComplete = historyLocalCacheIsCompleteRef.current;
      historyLocalCacheIsCompleteRef.current = options.isComplete;
      historyLocalCacheTotalEntriesRef.current = options.isComplete
        ? deduplicatedEntries.length
        : Math.max(deduplicatedEntries.length, previousTotalEntries);

      const didMetaChange =
        previousTotalEntries !== historyLocalCacheTotalEntriesRef.current ||
        previousIsComplete !== historyLocalCacheIsCompleteRef.current;
      if (!didEntriesChange && !didMetaChange) {
        return;
      }

      const nextKnownUserUids = collectHistoryUserUids(historyLocalCacheEntriesRef.current);
      setHistoryKnownUserUids((previous) =>
        areSortedStringArraysEqual(previous, nextKnownUserUids) ? previous : nextKnownUserUids
      );
      setHistoryCacheVersion((previous) => previous + 1);
      persistHistoryLocalCache();
    },
    [persistHistoryLocalCache]
  );

  const processHistorySyncQueue = useCallback(async () => {
    if (historySyncLoopRunningRef.current) {
      return;
    }

    historySyncLoopRunningRef.current = true;
    setIsHistorySyncing(true);
    try {
      while (historySyncRequestedModeRef.current !== "none") {
        const requestedMode = historySyncRequestedModeRef.current;
        const requestedAnchor = historySyncRequestedAnchorRef.current;
        historySyncRequestedModeRef.current = "none";
        historySyncRequestedAnchorRef.current = null;

        const syncEpoch = historySyncEpochRef.current;
        await hydrateHistoryLocalCacheForActiveUser();
        if (syncEpoch !== historySyncEpochRef.current) {
          continue;
        }

        const activeDb = requireDb();
        if (!activeDb) {
          continue;
        }

        if (requestedMode === "full") {
          const fetchedEntries: MonsterHistoryEntry[] = [];
          let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

          while (true) {
            const constraints: QueryConstraint[] = [
              orderBy("timestampIso", "desc"),
              limit(HISTORY_SYNC_BATCH_SIZE),
            ];
            if (cursor) {
              constraints.push(startAfter(cursor));
            }

            const snapshot = await getDocs(
              query(collection(activeDb, HISTORY_COLLECTION), ...constraints)
            );
            if (syncEpoch !== historySyncEpochRef.current) {
              break;
            }

            const docs = snapshot.docs;
            if (docs.length === 0) {
              break;
            }

            for (const snapshotDoc of docs) {
              const normalized = normalizeFirestoreHistoryEntry(snapshotDoc.data(), snapshotDoc.id);
              if (!normalized) {
                continue;
              }
              fetchedEntries.push(normalized);
            }

            if (docs.length < HISTORY_SYNC_BATCH_SIZE) {
              break;
            }
            cursor = docs[docs.length - 1];
          }

          if (syncEpoch !== historySyncEpochRef.current) {
            continue;
          }

          replaceHistoryLocalCacheEntries(fetchedEntries, { isComplete: true });
          const nextLocalHead = getLocalHistoryHeadPointer();
          historyRealtimeHeadRef.current = nextLocalHead;
          if (nextLocalHead) {
            historySyncRequestedModeRef.current = "incremental";
            historySyncRequestedAnchorRef.current = nextLocalHead;
          }
          continue;
        }

        const anchor = requestedAnchor ?? getLocalHistoryHeadPointer();
        if (!anchor) {
          continue;
        }

        const fetchedNewEntries: MonsterHistoryEntry[] = [];
        let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
        let reachedAnchor = false;
        let reachedEnd = false;

        while (true) {
          const constraints: QueryConstraint[] = [
            orderBy("timestampIso", "desc"),
            limit(HISTORY_SYNC_BATCH_SIZE),
          ];
          if (cursor) {
            constraints.push(startAfter(cursor));
          }

          const snapshot = await getDocs(query(collection(activeDb, HISTORY_COLLECTION), ...constraints));
          if (syncEpoch !== historySyncEpochRef.current) {
            break;
          }

          const docs = snapshot.docs;
          if (docs.length === 0) {
            reachedEnd = true;
            break;
          }

          for (const snapshotDoc of docs) {
            const normalized = normalizeFirestoreHistoryEntry(snapshotDoc.data(), snapshotDoc.id);
            if (!normalized) {
              continue;
            }
            if (normalized.id === anchor.id) {
              reachedAnchor = true;
              break;
            }
            fetchedNewEntries.push(normalized);
          }

          if (reachedAnchor) {
            break;
          }

          if (docs.length < HISTORY_SYNC_BATCH_SIZE) {
            reachedEnd = true;
            break;
          }
          cursor = docs[docs.length - 1];
        }

        if (syncEpoch !== historySyncEpochRef.current) {
          continue;
        }

        if (fetchedNewEntries.length > 0) {
          mergeFetchedHistoryEntriesIntoLocalCache(fetchedNewEntries);
        }

        if (reachedEnd && !reachedAnchor && historyLocalCacheIsCompleteRef.current) {
          historySyncRequestedModeRef.current = "full";
        }
      }
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("History sync failed", error);
    } finally {
      historySyncLoopRunningRef.current = false;
      if (historySyncRequestedModeRef.current !== "none") {
        void processHistorySyncQueue();
      } else {
        setIsHistorySyncing(false);
      }
    }
  }, [
    getLocalHistoryHeadPointer,
    hydrateHistoryLocalCacheForActiveUser,
    mergeFetchedHistoryEntriesIntoLocalCache,
    replaceHistoryLocalCacheEntries,
    requireDb,
  ]);

  const requestHistorySync = useCallback(
    (mode: "incremental" | "full", anchor?: HistoryHeadPointer | null) => {
      if (mode === "full") {
        historySyncRequestedModeRef.current = "full";
        historySyncRequestedAnchorRef.current = null;
      } else if (historySyncRequestedModeRef.current !== "full") {
        historySyncRequestedModeRef.current = "incremental";
        if (anchor) {
          historySyncRequestedAnchorRef.current = pickOlderHistoryHeadPointer(
            historySyncRequestedAnchorRef.current,
            anchor
          );
        }
      }

      void processHistorySyncQueue();
    },
    [processHistorySyncQueue]
  );

  const appendMonsterHistoryEntries = useCallback(
    async (entries: MonsterHistoryWriteInput[]) => {
      if (entries.length === 0) {
        return;
      }

      const activeDb = requireDb();
      if (!activeDb) {
        return;
      }

      const nickname = (currentUserProfile?.nickname ?? authDisplayName).trim() || "Account";
      const batchSize = 450;
      const committedEntries: MonsterHistoryEntry[] = [];

      try {
        for (let index = 0; index < entries.length; index += batchSize) {
          const chunk = entries.slice(index, index + batchSize);
          const batch = writeBatch(activeDb);
          const chunkEntries: MonsterHistoryEntry[] = [];

          for (const entry of chunk) {
            const action = entry.action.trim();
            if (!action) {
              continue;
            }

            const historyId = crypto.randomUUID();
            const historyDocRef = doc(collection(activeDb, HISTORY_COLLECTION));
            const timestampIso = new Date().toISOString();
            const nextEntry: MonsterHistoryEntry = {
              id: historyId,
              timestampIso,
              userUid: authUserId,
              userNickname: nickname,
              monsterId: entry.monsterId,
              monsterName: entry.monsterName.trim() || "Unknown Monster",
              action,
              previousValue: entry.previousValue,
              currentValue: entry.currentValue,
            };
            batch.set(historyDocRef, {
              ...nextEntry,
              createdAt: serverTimestamp(),
            });
            chunkEntries.push(nextEntry);
          }

          await batch.commit();
          committedEntries.push(...chunkEntries);
        }

        if (committedEntries.length > 0) {
          mergeFetchedHistoryEntriesIntoLocalCache(committedEntries);
        }
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to write monster history", error);
      }
    },
    [
      authDisplayName,
      authUserId,
      currentUserProfile?.nickname,
      mergeFetchedHistoryEntriesIntoLocalCache,
      requireDb,
    ]
  );

  const appendMonsterHistoryEntry = useCallback(
    async (entry: MonsterHistoryWriteInput) => {
      await appendMonsterHistoryEntries([entry]);
    },
    [appendMonsterHistoryEntries]
  );

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
  const getCategoryLabel = useCallback(
    (categoryId: string | null) => {
      if (!categoryId) {
        return "Uncategorized";
      }
      return categoryMap.get(categoryId)?.name ?? "Uncategorized";
    },
    [categoryMap]
  );
  const formatMonsterLabelForHistory = useCallback(
    (name: string, categoryId: string | null) => `${name.trim()} [${getCategoryLabel(categoryId)}]`,
    [getCategoryLabel]
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

  useEffect(() => {
    historySyncEpochRef.current += 1;
    historySyncRequestedModeRef.current = "none";
    historySyncRequestedAnchorRef.current = null;
    historyRealtimeHeadRef.current = null;
    historyHasOpenedViewRef.current = false;
    historyHasDoneSessionInitialFullBackfillRef.current = false;
    setIsHistorySyncing(false);
  }, [authUserId]);

  const resetSessionState = useCallback(() => {
    historySyncEpochRef.current += 1;
    historySyncRequestedModeRef.current = "none";
    historySyncRequestedAnchorRef.current = null;
    historyRealtimeHeadRef.current = null;
    historyHasOpenedViewRef.current = false;
    historyHasDoneSessionInitialFullBackfillRef.current = false;
    monsterDocIdByMonsterIdRef.current = new Map();
    categoryDocIdByCategoryIdRef.current = new Map();
    setMonsters([]);
    setCategories([]);
    setIsAddMonsterOpen(false);
    setIsCategoriesOpen(false);
    setIsSettingsOpen(false);
    setIsHistoryOpen(false);
    setIsClearAllOpen(false);
    setIsResetAllOpen(false);
    setPendingDeleteMonsterId(null);
    setSetExactMonsterId(null);
    setEditNameMonsterId(null);
    setIsClipboardImportOpen(false);
    setIsFirestoreConnected(false);
    setFirestoreError(firebaseInitError);
    setHistoryEntries([]);
    setIsHistoryLoading(false);
    setIsHistorySyncing(false);
    setHistoryCurrentPage(1);
    setHistoryPageSize(DEFAULT_HISTORY_ROWS_PER_PAGE);
    setHistoryHasNextPage(false);
    setHistoryTotalEntries(0);
    setHistoryFilters(DEFAULT_HISTORY_FILTERS);
    setHistorySort(DEFAULT_HISTORY_SORT);
    setHistoryKnownUserUids([]);
    setHistoryCacheVersion(0);
    historyLocalCacheEntriesRef.current = [];
    historyLocalCacheTotalEntriesRef.current = 0;
    historyLocalCacheIsCompleteRef.current = false;
    historyLocalCacheHydratedUserIdRef.current = null;
    historyLocalCachePendingPersistRef.current = null;
    historyNavigationLockRef.current = false;
    setCurrentUserProfile(null);
    setTrackedUsers([]);
    setTopCategoryFilterId(null);
    setFocusedMonsterId(null);
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
    if (!isAuthResolved || !authUserId || !isUserProfileResolved || !currentUserProfile) {
      return;
    }

    if (!db) {
      return;
    }

    const nextEmail = authUser?.email ?? "";
    const nextPhotoUrl =
      typeof authUser?.photoURL === "string" && authUser.photoURL.trim()
        ? authUser.photoURL.trim()
        : null;

    const shouldSyncEmail = currentUserProfile.email !== nextEmail;
    const shouldSyncPhoto = currentUserProfile.photoURL !== nextPhotoUrl;
    if (!shouldSyncEmail && !shouldSyncPhoto) {
      return;
    }

    let isActive = true;
    const userDocRef = doc(db, USERS_COLLECTION, authUserId);

    const syncProfileMetadata = async () => {
      try {
        await updateDoc(userDocRef, {
          email: nextEmail,
          photoURL: nextPhotoUrl,
          updatedAt: serverTimestamp(),
        });

        if (!isActive) {
          return;
        }

        setCurrentUserProfile((previous) => {
          if (!previous || previous.uid !== authUserId) {
            return previous;
          }

          return {
            ...previous,
            email: nextEmail,
            photoURL: nextPhotoUrl,
          };
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to sync user profile metadata", error);
      }
    };

    void syncProfileMetadata();

    return () => {
      isActive = false;
    };
  }, [
    authUser?.email,
    authUser?.photoURL,
    authUserId,
    currentUserProfile,
    isAuthResolved,
    isUserProfileResolved,
  ]);

  useEffect(() => {
    if (alertSettings.alertMode !== "custom") {
      return;
    }
    preloadCustomAlert(alertSettings.customSoundPath);
  }, [alertSettings]);

  useEffect(() => {
    trackedUsersRef.current = trackedUsers;
  }, [trackedUsers]);

  useEffect(() => {
    if (!isAuthResolved || !authUserId) {
      setTrackedUsers([]);
      return;
    }

    if (!db) {
      setTrackedUsers([]);
      return;
    }

    if (stableRequiredTrackedUserUids.length === 0) {
      setTrackedUsers([]);
      return;
    }

    let isActive = true;
    const requiredUidSet = new Set(stableRequiredTrackedUserUids);
    const trackedByUid = new Map<string, FirestoreTrackedUser>();
    for (const trackedUser of trackedUsersRef.current) {
      if (requiredUidSet.has(trackedUser.uid)) {
        trackedByUid.set(trackedUser.uid, trackedUser);
      }
    }
    const unsubscribers: Array<() => void> = [];
    const uidChunks = splitIntoChunks(stableRequiredTrackedUserUids, PROFILE_QUERY_UID_CHUNK_SIZE);
    const syncTrackedUsers = () => {
      if (!isActive) {
        return;
      }

      const nextTrackedUsers = Array.from(trackedByUid.values()).sort((left, right) =>
        left.uid.localeCompare(right.uid)
      );
      setTrackedUsers((previous) => {
        if (
          previous.length === nextTrackedUsers.length &&
          previous.every((entry, index) => {
            const nextEntry = nextTrackedUsers[index];
            return (
              entry.uid === nextEntry.uid &&
              entry.nickname === nextEntry.nickname &&
              entry.photoURL === nextEntry.photoURL
            );
          })
        ) {
          return previous;
        }

        return nextTrackedUsers;
      });
    };

    for (const uidChunk of uidChunks) {
      const chunkUidSet = new Set(uidChunk);
      const usersQuery = query(
        collection(db, USERS_COLLECTION),
        where(documentId(), "in", uidChunk)
      );
      const unsubscribe = onSnapshot(
        usersQuery,
        (snapshot) => {
          for (const chunkUid of chunkUidSet) {
            trackedByUid.delete(chunkUid);
          }

          snapshot.forEach((snapshotDoc) => {
            const normalizedProfile = normalizeFirestoreUserProfile(snapshotDoc.data(), snapshotDoc.id, null);
            if (!normalizedProfile) {
              return;
            }

            trackedByUid.set(normalizedProfile.uid, {
              uid: normalizedProfile.uid,
              nickname: normalizedProfile.nickname,
              photoURL: normalizedProfile.photoURL,
            });
          });

          syncTrackedUsers();
        },
        (error) => {
          setFirestoreError(getFirestoreErrorMessage(error));
          console.error("Firestore users listener failed", error);
        }
      );
      unsubscribers.push(unsubscribe);
    }

    syncTrackedUsers();

    return () => {
      isActive = false;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [authUserId, isAuthResolved, stableRequiredTrackedUserUids]);

  useEffect(() => {
    if (!isAuthResolved || !authUserId || !isUserProfileResolved || !currentUserProfile) {
      return;
    }

    if (!db) {
      return;
    }

    const activeDb = db;
    let isActive = true;
    const currentSyncEpoch = historySyncEpochRef.current;

    const bootstrapHistorySync = async () => {
      await hydrateHistoryLocalCacheForActiveUser();
      if (!isActive || currentSyncEpoch !== historySyncEpochRef.current) {
        return;
      }

      const localHead = getLocalHistoryHeadPointer();
      if (historyLocalCacheIsCompleteRef.current && localHead) {
        requestHistorySync("incremental", localHead);
      }
    };

    void bootstrapHistorySync();

    const historyHeadQuery = query(
      collection(activeDb, HISTORY_COLLECTION),
      orderBy("timestampIso", "desc"),
      limit(1)
    );
    const unsubscribeHistory = onSnapshot(
      historyHeadQuery,
      (snapshot) => {
        if (!isActive) {
          return;
        }

        const firstDoc = snapshot.docs[0];
        if (!firstDoc) {
          historyRealtimeHeadRef.current = null;
          return;
        }

        const normalized = normalizeFirestoreHistoryEntry(firstDoc.data(), firstDoc.id);
        if (!normalized) {
          return;
        }

        const nextRemoteHead = toHistoryHeadPointer(normalized);
        const previousRemoteHead = historyRealtimeHeadRef.current;
        historyRealtimeHeadRef.current = nextRemoteHead;

        if (!previousRemoteHead) {
          const localHead = getLocalHistoryHeadPointer();
          if (!localHead && !historyLocalCacheIsCompleteRef.current) {
            requestHistorySync("full");
            return;
          }
          if (localHead && !areHistoryHeadPointersEqual(localHead, nextRemoteHead)) {
            requestHistorySync("incremental", localHead);
          }
          return;
        }

        if (areHistoryHeadPointersEqual(previousRemoteHead, nextRemoteHead)) {
          return;
        }

        const localHead = getLocalHistoryHeadPointer();
        if (!localHead) {
          requestHistorySync("full");
          return;
        }
        if (areHistoryHeadPointersEqual(localHead, nextRemoteHead)) {
          return;
        }

        // If local cache is already behind, anchor from local head so we catch up in one incremental pass.
        const incrementalAnchor = areHistoryHeadPointersEqual(localHead, previousRemoteHead)
          ? previousRemoteHead
          : localHead;
        requestHistorySync("incremental", incrementalAnchor);
      },
      (error) => {
        if (!isActive) {
          return;
        }
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Firestore history listener failed", error);
      }
    );

    return () => {
      isActive = false;
      unsubscribeHistory();
    };
  }, [
    authUserId,
    currentUserProfile,
    getLocalHistoryHeadPointer,
    hydrateHistoryLocalCacheForActiveUser,
    isAuthResolved,
    isUserProfileResolved,
    requestHistorySync,
  ]);

  useEffect(() => {
    if (!isAuthResolved || !authUserId || !isUserProfileResolved || !currentUserProfile || !isHistoryOpen) {
      return;
    }

    let isActive = true;
    historyHasOpenedViewRef.current = true;

    const syncHistoryForOpenedView = async () => {
      await hydrateHistoryLocalCacheForActiveUser();
      if (!isActive) {
        return;
      }

      const hasLocalHistoryData = historyLocalCacheEntriesRef.current.length > 0;
      if (!hasLocalHistoryData) {
        historyHasDoneSessionInitialFullBackfillRef.current = true;
        requestHistorySync("full");
        return;
      }

      // Prefer incremental catch-up on open when cache exists to avoid expensive full scans.
      const localHead = getLocalHistoryHeadPointer();
      if (localHead) {
        requestHistorySync("incremental", localHead);
        return;
      }

      historyHasDoneSessionInitialFullBackfillRef.current = true;
      requestHistorySync("full");
    };

    void syncHistoryForOpenedView();
    return () => {
      isActive = false;
    };
  }, [
    authUserId,
    currentUserProfile,
    getLocalHistoryHeadPointer,
    hydrateHistoryLocalCacheForActiveUser,
    isAuthResolved,
    isHistoryOpen,
    isUserProfileResolved,
    requestHistorySync,
  ]);

  useEffect(() => {
    if (!isAuthResolved || !authUserId || !isUserProfileResolved || !currentUserProfile || !isHistoryOpen) {
      setHistoryEntries([]);
      setIsHistoryLoading(false);
      setHistoryCurrentPage(1);
      setHistoryHasNextPage(false);
      setHistoryTotalEntries(0);
      historyNavigationLockRef.current = false;
      return;
    }

    let isActive = true;

    const loadHistoryPage = async () => {
      setIsHistoryLoading(true);

      try {
        await hydrateHistoryLocalCacheForActiveUser();
        if (!isActive) {
          return;
        }

        const safePage = Math.max(1, Math.trunc(historyCurrentPage));
        const safePageSize = Math.max(1, Math.trunc(historyPageSize));
        const shouldApplyLocalSortOrFilters =
          hasActiveHistoryFilters(historyFilters) || !isDefaultHistorySort(historySort);
        const localEntries = historyLocalCacheEntriesRef.current;
        const filteredEntries = hasActiveHistoryFilters(historyFilters)
          ? localEntries.filter((entry) => matchesHistoryFilters(entry, historyFilters))
          : localEntries;
        const sortedEntries = shouldApplyLocalSortOrFilters
          ? sortHistoryEntries(filteredEntries, historySort)
          : filteredEntries;
        const totalEntries = sortedEntries.length;
        const maxPage = Math.max(1, Math.ceil(Math.max(0, totalEntries) / safePageSize));
        if (safePage > maxPage) {
          setHistoryCurrentPage(maxPage);
          return;
        }

        const pageStartIndex = (safePage - 1) * safePageSize;
        const pageEntries = sortedEntries.slice(pageStartIndex, pageStartIndex + safePageSize);
        const hasNextPage = pageStartIndex + safePageSize < totalEntries;

        setHistoryEntries(pageEntries);
        setHistoryTotalEntries(totalEntries);
        setHistoryHasNextPage(hasNextPage);
      } catch (error) {
        if (!isActive) {
          return;
        }
        setFirestoreError(getFirestoreErrorMessage(error));
      } finally {
        if (isActive) {
          setIsHistoryLoading(false);
          historyNavigationLockRef.current = false;
        }
      }
    };

    void loadHistoryPage();
    return () => {
      isActive = false;
    };
  }, [
    authUserId,
    currentUserProfile,
    historyCacheVersion,
    historyCurrentPage,
    historyFilters,
    historyPageSize,
    historySort,
    hydrateHistoryLocalCacheForActiveUser,
    isAuthResolved,
    isHistoryOpen,
    isUserProfileResolved,
  ]);

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
    if (focusedMonsterId && !monsterById.has(focusedMonsterId)) {
      setFocusedMonsterId(null);
    }
  }, [editNameMonsterId, focusedMonsterId, monsterById, pendingDeleteMonsterId, setExactMonsterId]);

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
        await appendMonsterHistoryEntry({
          monsterId: firestoreMonster.id,
          monsterName: firestoreMonster.name,
          action: "Create Monster",
          previousValue: "-",
          currentValue: `Respawn: ${formatDuration(firestoreMonster.respawnDuration)}, Category: ${getCategoryLabel(
            firestoreMonster.categoryId
          )}`,
        });
        return true;
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to create monster", error);
        return false;
      }
    },
    [appendMonsterHistoryEntry, getCategoryLabel, requireDb]
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
        await appendMonsterHistoryEntry({
          monsterId: monster.id,
          monsterName: monster.name,
          action: "Edit Monster Details",
          previousValue: formatMonsterLabelForHistory(monster.name, monster.categoryId),
          currentValue: formatMonsterLabelForHistory(trimmed, nextCategoryId),
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster name", error);
      }
    },
    [appendMonsterHistoryEntry, editNameMonsterId, formatMonsterLabelForHistory, monsterById, updateMonsterFields]
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
        await appendMonsterHistoryEntry({
          monsterId: monster.id,
          monsterName: monster.name,
          action: "Edit Respawn Duration",
          previousValue: formatDuration(monster.respawnDuration),
          currentValue: formatDuration(respawnDuration),
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster respawn duration", error);
      }
    },
    [appendMonsterHistoryEntry, monsterById, updateMonsterFields]
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
        await appendMonsterHistoryEntry({
          monsterId: monster.id,
          monsterName: monster.name,
          action: "Edit Last Killed",
          previousValue: monster.lastKilledTimestamp,
          currentValue: iso,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster last killed timestamp", error);
      }
    },
    [appendMonsterHistoryEntry, authUserId, monsterById, updateMonsterFields]
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
        await appendMonsterHistoryEntry({
          monsterId: monster.id,
          monsterName: monster.name,
          action: "Edit Next Spawn Time",
          previousValue: monster.lastKilledTimestamp,
          currentValue: nextLastKilledTimestamp,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster next spawn timestamp", error);
      }
    },
    [appendMonsterHistoryEntry, authUserId, monsterById, updateMonsterFields]
  );

  const handleOffsetHoursMinutesChange = useCallback(
    async (id: string, hours: number, minutes: number) => {
      const offsetSeconds = convertHoursMinutesToSeconds(hours, minutes);

      const previousMonster = monsterByIdRef.current.get(id);
      if (!previousMonster || (previousMonster.offsetSeconds ?? 0) === offsetSeconds) {
        return;
      }

      setMonsters((prev) => {
        let didChange = false;
        const next = prev.map((monster) => {
          if (monster.id !== id) {
            return monster;
          }
          if ((monster.offsetSeconds ?? 0) === offsetSeconds) {
            return monster;
          }

          didChange = true;
          return {
            ...monster,
            offsetSeconds,
          };
        });
        return didChange ? next : prev;
      });

      try {
        await updateMonsterFields(id, { offsetSeconds });
        await appendMonsterHistoryEntry({
          monsterId: previousMonster.id,
          monsterName: previousMonster.name,
          action: "Edit Offset",
          previousValue: formatOffsetSeconds(previousMonster.offsetSeconds ?? 0),
          currentValue: formatOffsetSeconds(offsetSeconds),
        });
      } catch (error) {
        setMonsters((prev) =>
          prev.map((monster) => {
            if (monster.id !== id || (monster.offsetSeconds ?? 0) !== offsetSeconds) {
              return monster;
            }
            return {
              ...monster,
              offsetSeconds: previousMonster.offsetSeconds ?? 0,
            };
          })
        );
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to update monster offset", error);
      }
    },
    [appendMonsterHistoryEntry, updateMonsterFields]
  );

  const handleOffsetSubmitByEnter = useCallback(() => {
    if (!autoReturnToPreviousAppEnabled) {
      return;
    }
    window.electronAPI?.returnToPreviousWindow?.();
  }, [autoReturnToPreviousAppEnabled]);

  const handleTrackLeftClick = useCallback(() => {
    if (!autoReturnToPreviousAppEnabled) {
      return;
    }
    window.electronAPI?.returnToPreviousWindow?.();
  }, [autoReturnToPreviousAppEnabled]);

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
        if (previousMonster) {
          await appendMonsterHistoryEntry({
            monsterId: previousMonster.id,
            monsterName: previousMonster.name,
            action: "Tracked Monster",
            previousValue: previousMonster.lastKilledTimestamp,
            currentValue: nowIso,
          });
        }
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
    [appendMonsterHistoryEntry, authUserId, updateMonsterFields]
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

    const monster = monsterById.get(pendingDeleteMonsterId);

    try {
      const monsterDocRef = getMonsterDocRef(pendingDeleteMonsterId);
      if (monsterDocRef) {
        await deleteDoc(monsterDocRef);
        if (monster) {
          await appendMonsterHistoryEntry({
            monsterId: monster.id,
            monsterName: monster.name,
            action: "Delete Monster",
            previousValue: `Respawn: ${formatDuration(monster.respawnDuration)}`,
            currentValue: "-",
          });
        }
      }
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to delete monster", error);
    } finally {
      setPendingDeleteMonsterId(null);
    }
  }, [appendMonsterHistoryEntry, getMonsterDocRef, monsterById, pendingDeleteMonsterId]);

  const handleSetExactRequest = useCallback((id: string) => {
    setSetExactMonsterId(id);
  }, []);

  const handleSetExactCancel = useCallback(() => {
    setSetExactMonsterId(null);
  }, []);

  const handleSetExactConfirm = useCallback(
    async (hours: number, minutes: number) => {
      const targetMonsterId = setExactMonsterId;
      if (!targetMonsterId) {
        return;
      }

      // Close immediately so Enter/submit feels instant while async writes continue.
      setSetExactMonsterId(null);
      if (autoReturnToPreviousAppEnabled) {
        window.electronAPI?.returnToPreviousWindow?.();
      }

      if (!authUserId) {
        return;
      }

      const monster = monsterById.get(targetMonsterId);
      if (!monster) {
        return;
      }

      const targetSpawnMs = calculateSetExactTargetSpawnMs(hours, minutes, Date.now());
      const nextLastKilledTimestamp = calculateLastKilledTimestampForTargetSpawn(
        monster,
        targetSpawnMs
      );

      if (monster.lastKilledTimestamp === nextLastKilledTimestamp) {
        return;
      }

      try {
        await updateMonsterFields(targetMonsterId, {
          lastKilledTimestamp: nextLastKilledTimestamp,
          lastTrackedByUid: authUserId,
        });
        await appendMonsterHistoryEntry({
          monsterId: monster.id,
          monsterName: monster.name,
          action: "Set Exact Spawn",
          previousValue: monster.lastKilledTimestamp,
          currentValue: nextLastKilledTimestamp,
        });
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to apply set exact", error);
      }
    },
    [
      appendMonsterHistoryEntry,
      autoReturnToPreviousAppEnabled,
      authUserId,
      monsterById,
      setExactMonsterId,
      updateMonsterFields,
    ]
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
    const resetHistoryEntries: MonsterHistoryWriteInput[] = [];

    for (const monster of monsters) {
      const docId = monsterDocIdByMonsterIdRef.current.get(monster.id);
      if (!docId) {
        continue;
      }

      hasWrites = true;
      batch.update(doc(activeDb, MONSTERS_COLLECTION, docId), {
        lastKilledTimestamp: nowIso,
        lastTrackedByUid: null,
        offsetSeconds: 0,
        updatedAt: serverTimestamp(),
      });
      resetHistoryEntries.push({
        monsterId: monster.id,
        monsterName: monster.name,
        action: "Reset All Timers",
        previousValue: `Last Killed: ${monster.lastKilledTimestamp}, Offset: ${formatOffsetSeconds(
          monster.offsetSeconds ?? 0
        )}`,
        currentValue: `Last Killed: ${nowIso}, Offset: ${formatOffsetSeconds(0)}`,
      });
    }

    if (!hasWrites) {
      setIsResetAllOpen(false);
      return;
    }

    try {
      await batch.commit();
      await appendMonsterHistoryEntries(resetHistoryEntries);
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to reset all monsters", error);
    } finally {
      setIsResetAllOpen(false);
    }
  }, [appendMonsterHistoryEntries, monsters, requireDb]);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      saveSoundEnabled(next);
      return next;
    });
  }, []);

  const handleToggleHotkeys = useCallback(() => {
    setHotkeysEnabled((prev) => {
      const next = !prev;
      saveGlobalHotkeysEnabled(next);
      return next;
    });
  }, []);

  const handleToggleAutoReturnToPreviousApp = useCallback(() => {
    setAutoReturnToPreviousAppEnabled((prev) => {
      const next = !prev;
      saveAutoReturnToPreviousAppEnabled(next);
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
  const handleFocusedMonsterChange = useCallback((monsterId: string | null) => {
    setFocusedMonsterId(monsterId);
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

  const handleOpenHistory = useCallback(() => {
    setIsHistoryOpen(true);
  }, []);

  const handleHistoryRowsPerPageChange = useCallback((nextRowsPerPage: number) => {
    const normalizedRowsPerPage = Math.max(1, Math.trunc(nextRowsPerPage));
    setHistoryPageSize((previous) => {
      if (previous === normalizedRowsPerPage) {
        return previous;
      }
      setHistoryCurrentPage(1);
      return normalizedRowsPerPage;
    });
  }, []);

  const handleHistoryFiltersChange = useCallback((nextFilters: HistoryFilters) => {
    setHistoryFilters((previous) => {
      if (areHistoryFiltersEqual(previous, nextFilters)) {
        return previous;
      }
      historyNavigationLockRef.current = false;
      setHistoryCurrentPage(1);
      return nextFilters;
    });
  }, []);

  const handleHistorySortChange = useCallback((nextSort: HistorySort) => {
    setHistorySort((previous) => {
      if (previous.column === nextSort.column && previous.direction === nextSort.direction) {
        return previous;
      }
      historyNavigationLockRef.current = false;
      setHistoryCurrentPage(1);
      return nextSort;
    });
  }, []);

  const handleHistoryPreviousPage = useCallback(() => {
    if (historyCurrentPage <= 1 || isHistoryLoading || historyNavigationLockRef.current) {
      return;
    }
    historyNavigationLockRef.current = true;
    setIsHistoryLoading(true);
    setHistoryCurrentPage((previous) => Math.max(1, previous - 1));
  }, [historyCurrentPage, isHistoryLoading]);

  const handleHistoryNextPage = useCallback(() => {
    if (!historyHasNextPage || isHistoryLoading || historyNavigationLockRef.current) {
      return;
    }
    // Lock immediately to avoid double-tap races before effect-driven loading flips this state.
    historyNavigationLockRef.current = true;
    setIsHistoryLoading(true);
    setHistoryCurrentPage((previous) => previous + 1);
  }, [historyHasNextPage, isHistoryLoading]);

  const handleCloseHistory = useCallback(() => {
    setIsHistoryOpen(false);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleAlertSettingsChange = useCallback((nextSettings: AlertSettings) => {
    setAlertSettings(nextSettings);
    saveAlertSettings(nextSettings);
  }, []);

  useEffect(() => {
    window.electronAPI?.setGlobalHotkeysEnabled?.(hotkeysEnabled);
  }, [hotkeysEnabled]);

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
      await appendMonsterHistoryEntries(
        imported.map((monster) => ({
          monsterId: monster.id,
          monsterName: monster.name,
          action: "Import CSV",
          previousValue: "-",
          currentValue: `Respawn: ${formatDuration(monster.respawnDuration)}`,
        }))
      );
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to import CSV monsters", error);
    }
  }, [appendMonsterHistoryEntries, requireDb]);

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
      const committedMonsters: FirestoreMonster[] = [];

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
          committedMonsters.push(...chunk);
        }

        await appendMonsterHistoryEntries(
          committedMonsters.map((monster) => ({
            monsterId: monster.id,
            monsterName: monster.name,
            action: "Import Clipboard",
            previousValue: "-",
            currentValue: `Respawn: ${formatDuration(monster.respawnDuration)}`,
          }))
        );
      } catch (error) {
        setFirestoreError(getFirestoreErrorMessage(error));
        console.error("Failed to import clipboard monsters", error);
      }

      return { importedCount, skippedCount };
    },
    [appendMonsterHistoryEntries, requireDb]
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

    const deletableMonsters = monsters.filter((monster) =>
      monsterDocIdByMonsterIdRef.current.has(monster.id)
    );
    if (deletableMonsters.length === 0) {
      setIsClearAllOpen(false);
      return;
    }

    const batch = writeBatch(activeDb);
    const clearHistoryEntries: MonsterHistoryWriteInput[] = [];
    for (const monster of deletableMonsters) {
      const docId = monsterDocIdByMonsterIdRef.current.get(monster.id);
      if (!docId) {
        continue;
      }

      batch.delete(doc(activeDb, MONSTERS_COLLECTION, docId));
      clearHistoryEntries.push({
        monsterId: monster.id,
        monsterName: monster.name,
        action: "Delete All Monsters",
        previousValue: `Respawn: ${formatDuration(monster.respawnDuration)}`,
        currentValue: "-",
      });
    }

    try {
      await batch.commit();
      await appendMonsterHistoryEntries(clearHistoryEntries);
    } catch (error) {
      setFirestoreError(getFirestoreErrorMessage(error));
      console.error("Failed to clear all monsters", error);
    } finally {
      setIsClearAllOpen(false);
    }
  }, [appendMonsterHistoryEntries, monsters, requireDb]);

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
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
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
          userDisplayName={authDisplayName}
          userEmail={authUser.email}
          userPhotoUrl={authUser.photoURL}
          onOpenSettings={handleOpenSettings}
          onOpenHistory={handleOpenHistory}
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
        onOffsetSubmitByEnter={handleOffsetSubmitByEnter}
        onTrackLeftClick={handleTrackLeftClick}
        onMonsterOffsetFocusChange={handleFocusedMonsterChange}
        trackedByUserMap={trackedByUserMap}
        categoryMap={categoryMap}
      />

      <div className="content-grid">
        <MonsterTable
          monsters={monsters}
          isLoading={!isFirestoreConnected && !firestoreError}
          sortOption={tableSortOption}
          categoryMap={categoryMap}
          onCategoryFilterSelectionChange={setTopCategoryFilterId}
          onSortOptionChange={handleTableSortOptionChange}
          onEditNameRequest={handleEditNameRequest}
          onRespawnHoursMinutesChange={handleRespawnHoursMinutesChange}
          onLastKilledChange={handleLastKilledChange}
          onNextSpawnTimeChange={handleNextSpawnTimeChange}
          onOffsetHoursMinutesChange={handleOffsetHoursMinutesChange}
          onOffsetSubmitByEnter={handleOffsetSubmitByEnter}
          onTrackLeftClick={handleTrackLeftClick}
          onResetNow={handleResetNow}
          onDelete={handleDeleteMonsterRequest}
          onSetExact={handleSetExactRequest}
          focusedMonsterId={focusedMonsterId}
          onFocusedMonsterChange={handleFocusedMonsterChange}
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
        soundEnabled={soundEnabled}
        hotkeysEnabled={hotkeysEnabled}
        autoReturnToPreviousAppEnabled={autoReturnToPreviousAppEnabled}
        onClose={handleCloseSettings}
        onToggleSound={handleToggleSound}
        onToggleHotkeys={handleToggleHotkeys}
        onToggleAutoReturnToPreviousApp={handleToggleAutoReturnToPreviousApp}
        onSettingsChange={handleAlertSettingsChange}
        onPickCustomSound={handlePickCustomSound}
      />

      <HistoryModal
        isOpen={isHistoryOpen}
        isLoading={isHistoryLoading}
        isSyncing={isHistorySyncing}
        entries={historyEntries}
        sort={historySort}
        currentPage={historyCurrentPage}
        hasNextPage={historyHasNextPage}
        totalEntries={historyTotalEntries}
        filters={historyFilters}
        trackedByUserMap={trackedByUserMap}
        monsterById={monsterById}
        categoryMap={categoryMap}
        onSortChange={handleHistorySortChange}
        onFiltersChange={handleHistoryFiltersChange}
        onNextPage={handleHistoryNextPage}
        onPreviousPage={handleHistoryPreviousPage}
        onRowsPerPageChange={handleHistoryRowsPerPageChange}
        onClose={handleCloseHistory}
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
