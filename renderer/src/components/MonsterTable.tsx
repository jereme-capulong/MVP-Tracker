import {
  type CSSProperties,
  ChangeEvent,
  FormEvent,
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
import { ModalBackdrop } from "./ModalBackdrop";
import { StatsMonsterPieChart } from "./StatsMonsterPieChart";
import { type StatsDistributionData, StatsDistributionChart } from "./StatsDistributionChart";
import {
  type StatsTrendSeries,
  StatsHourOfWeekHeatmap,
  StatsStackedTrendChart,
  StatsTrendLineChart,
} from "./StatsTimeTrendsCharts";

type ReadyFilter = "all" | "allReady" | "readyNew" | "readyOld" | "upcoming" | "notReady";
type CategoryFilter = "all" | "none" | string;

const CATEGORY_FILTER_ALL = "all";
const CATEGORY_FILTER_NONE = "none";
const CATEGORY_FILTER_PREFIX = "category:";
const COLUMN_VISIBILITY_STORAGE_KEY = "mvpTracker.monsterTableColumnVisibility.v1";
const DEFAULT_VIRTUAL_ROW_HEIGHT = 44;
const VIRTUAL_OVERSCAN_ROWS = 8;
const NAME_COLUMN_MIN_WIDTH_CH = 16;
const NAME_COLUMN_EXTRA_CH = 6;

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
  offsetSeconds: number;
  normalizedTrackedBy: string;
};

type OffsetMinutesFocusRequest = {
  rowIndex: number;
  requestId: number;
};

type SortDirection = "asc" | "desc";
type SortableMonsterColumn = "time" | "name" | "respawn" | "lastKilled" | "offset" | "trackedBy";

const SORT_OPTIONS: Array<{ value: MonsterSortOption; label: string }> = [
  { value: "timeAsc", label: "Time Ascending" },
  { value: "timeDesc", label: "Time Descending" },
  { value: "nameAsc", label: "Name Ascending" },
  { value: "nameDesc", label: "Name Descending" },
  { value: "respawnAsc", label: "Respawn Duration Ascending" },
  { value: "respawnDesc", label: "Respawn Duration Descending" },
  { value: "lastKilledAsc", label: "Last Killed Ascending" },
  { value: "lastKilledDesc", label: "Last Killed Descending" },
  { value: "offsetAsc", label: "Offset Ascending" },
  { value: "offsetDesc", label: "Offset Descending" },
  { value: "trackedByAsc", label: "Last Tracked By Ascending" },
  { value: "trackedByDesc", label: "Last Tracked By Descending" },
];
const SORT_COLUMN_OPTIONS: Record<SortableMonsterColumn, { asc: MonsterSortOption; desc: MonsterSortOption }> = {
  time: { asc: "timeAsc", desc: "timeDesc" },
  name: { asc: "nameAsc", desc: "nameDesc" },
  respawn: { asc: "respawnAsc", desc: "respawnDesc" },
  lastKilled: { asc: "lastKilledAsc", desc: "lastKilledDesc" },
  offset: { asc: "offsetAsc", desc: "offsetDesc" },
  trackedBy: { asc: "trackedByAsc", desc: "trackedByDesc" },
};
const SORT_OPTION_META: Record<MonsterSortOption, { column: SortableMonsterColumn; direction: SortDirection }> = {
  timeAsc: { column: "time", direction: "asc" },
  timeDesc: { column: "time", direction: "desc" },
  nameAsc: { column: "name", direction: "asc" },
  nameDesc: { column: "name", direction: "desc" },
  respawnAsc: { column: "respawn", direction: "asc" },
  respawnDesc: { column: "respawn", direction: "desc" },
  lastKilledAsc: { column: "lastKilled", direction: "asc" },
  lastKilledDesc: { column: "lastKilled", direction: "desc" },
  offsetAsc: { column: "offset", direction: "asc" },
  offsetDesc: { column: "offset", direction: "desc" },
  trackedByAsc: { column: "trackedBy", direction: "asc" },
  trackedByDesc: { column: "trackedBy", direction: "desc" },
};
const HEADER_SORT_COLUMN_BY_TABLE_COLUMN: Partial<Record<MonsterTableColumnKey, SortableMonsterColumn>> = {
  name: "name",
  respawnDuration: "respawn",
  lastKilled: "lastKilled",
  offset: "offset",
  nextSpawnTime: "time",
  lastTrackedBy: "trackedBy",
  timeRemaining: "time",
  offsetEdit: "offset",
};

function getNextSortOptionForColumn(
  currentSortOption: MonsterSortOption,
  column: SortableMonsterColumn
): MonsterSortOption {
  const activeMeta = SORT_OPTION_META[currentSortOption];
  if (activeMeta.column !== column) {
    return SORT_COLUMN_OPTIONS[column].asc;
  }
  return activeMeta.direction === "asc"
    ? SORT_COLUMN_OPTIONS[column].desc
    : SORT_COLUMN_OPTIONS[column].asc;
}
const STATS_VIEW_TABS = ["Overview", "Users", "Monsters", "Time & Trends", "Categories"] as const;
const STATS_TIME_RANGE_OPTIONS = ["8h", "Today", "This Week", "This Month", "All Time"] as const;
const STATS_MONSTER_METRIC_OPTIONS = [
  { key: "tracked", label: "Tracked" },
  { key: "editOffset", label: "Edit Offset" },
  { key: "setExact", label: "Set Exact" },
] as const;
type StatsViewTab = (typeof STATS_VIEW_TABS)[number];
type StatsTimeRange = (typeof STATS_TIME_RANGE_OPTIONS)[number];
type StatsMonsterMetric = (typeof STATS_MONSTER_METRIC_OPTIONS)[number]["key"];
const DEFAULT_STATS_VIEW_TAB: StatsViewTab = "Overview";
const DEFAULT_STATS_TIME_RANGE: StatsTimeRange = "All Time";
const DEFAULT_STATS_MONSTER_METRIC: StatsMonsterMetric = "tracked";
const STATS_UNCATEGORIZED_CATEGORY_KEY = "uncategorized";
const STATS_UNCATEGORIZED_CATEGORY_LABEL = "Uncategorized";
const STATS_UNCATEGORIZED_CATEGORY_COLOR = "#8f99a8";
const STATS_QUERY_DEBOUNCE_MS = 220;
const STATS_QUERY_REFRESH_INTERVAL_MS = 5000;
const STATS_RANGE_CACHE_TTL_MS = 4200;
const STATS_WEEK_START_DAY_INDEX = 0;
const STATS_DAY_MS = 24 * 60 * 60 * 1000;
const STATS_DAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const STATS_HOUR_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
});
const STATS_HOUR_TOOLTIP_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
});
const STATS_NUMBER_FORMATTER = new Intl.NumberFormat();

type StatsMonsterSuggestion = {
  name: string;
  normalizedName: string;
  color: string | null;
};

type StatsCategoryRollup = {
  categoryKey: string;
  categoryName: string;
  color: string;
  isUncategorized: boolean;
  trackedCount: number;
  editOffsetCount: number;
  setExactCount: number;
  mostTracked: Array<{ monsterName: string; count: number; color?: string }>;
  leastTracked: Array<{ monsterName: string; count: number; color?: string }>;
};

type StatsOverviewState = {
  totalTracksRange: number;
  totalTracksAllTime: number;
  mostActiveMonster: { name: string; count: number } | null;
  tracksPerDay: Array<{ day: string; count: number }>;
  topUsers: Array<{ uid: string | null; nickname: string; count: number }>;
  users: {
    leaderboard: Array<{ uid: string | null; nickname: string; count: number; sharePercent: number }>;
    mostTracksInDay: Array<{ uid: string | null; nickname: string; day: string; count: number }>;
    topMonsterTracked: Array<{ uid: string | null; nickname: string; monsterName: string; count: number }>;
    longestStreakHours: Array<{ uid: string | null; nickname: string; hours: number }>;
    additionalStats: Array<{
      uid: string | null;
      nickname: string;
      leastFavoriteMonster: { name: string; count: number } | null;
      setExacts: number;
      editsDone: number;
      timesReset: number;
    }>;
  };
  monsters: {
    perMonster: Array<{
      monsterName: string;
      trackedCount: number;
      editOffsetCount: number;
      setExactCount: number;
      mostKilledBy: Array<{ uid: string | null; nickname: string; count: number }>;
      leastKilledBy: Array<{ uid: string | null; nickname: string; count: number }>;
    }>;
  };
  distribution: StatsDistributionData & {
    summary: {
      totalAllDays: number;
      avgPerDay: number;
      maxDayTotal: number;
      activeUsers: number;
      daysRecorded: number;
    };
  };
  timeTrends: {
    bucketInterval: "day" | "hour";
    buckets: Array<{
      bucket: string;
      trackedCount: number;
      trackedMovingAverage: number;
      activeTrackerCount: number;
      editOffsetCount: number;
      setExactCount: number;
      editLastKilledCount: number;
      resetAllTimersCount: number;
      correctionRatePercent: number;
    }>;
    monsterMomentum: Array<{
      monsterName: string;
      currentTracks: number;
      previousTracks: number;
      delta: number;
      deltaPercent: number | null;
    }>;
    hourOfWeekHeatmap: Array<{
      dayOfWeek: number;
      hourOfDay: number;
      trackedCount: number;
    }>;
    handoffRates: Array<{
      monsterName: string;
      handoffCount: number;
      comparableTransitions: number;
      handoffRatePercent: number;
    }>;
  };
};

type StatsOverviewLoadStatus = "idle" | "loading" | "success" | "error";

function getStatsRangeStartMs(range: StatsTimeRange, nowDate = new Date()): number | null {
  switch (range) {
    case "8h":
      return nowDate.getTime() - 8 * 60 * 60 * 1000;
    case "Today": {
      const startOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
      return startOfDay.getTime();
    }
    case "This Week": {
      const startOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
      const dayIndex = startOfDay.getDay();
      const diffDays = (dayIndex - STATS_WEEK_START_DAY_INDEX + 7) % 7;
      startOfDay.setDate(startOfDay.getDate() - diffDays);
      return startOfDay.getTime();
    }
    case "This Month": {
      const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
      return startOfMonth.getTime();
    }
    case "All Time":
      return null;
    default:
      return null;
  }
}

function shouldShowTracksPerDayForRange(range: StatsTimeRange): boolean {
  return range !== "8h" && range !== "Today";
}

function formatStatsLargeNumber(value: number): string {
  return STATS_NUMBER_FORMATTER.format(Math.max(0, Math.trunc(value)));
}

function formatStatsDayLabel(dayKey: string): string {
  const parsed = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dayKey;
  }
  return STATS_DAY_LABEL_FORMATTER.format(parsed);
}

function formatStatsDistributionAxisLabel(bucketKey: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(bucketKey)) {
    const parsed = new Date(`${bucketKey.slice(0, 10)}T${bucketKey.slice(11, 13)}:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return STATS_HOUR_LABEL_FORMATTER.format(parsed);
    }
  }
  return formatStatsDayLabel(bucketKey);
}

function formatStatsDistributionTooltipLabel(bucketKey: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(bucketKey)) {
    const parsed = new Date(`${bucketKey.slice(0, 10)}T${bucketKey.slice(11, 13)}:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return STATS_HOUR_TOOLTIP_LABEL_FORMATTER.format(parsed);
    }
  }
  return formatStatsDayLabel(bucketKey);
}

function formatStatsDecimalValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatStatsPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString(undefined, {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatStatsSignedNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  const normalizedValue = Math.trunc(value);
  if (normalizedValue > 0) {
    return `+${STATS_NUMBER_FORMATTER.format(normalizedValue)}`;
  }
  return STATS_NUMBER_FORMATTER.format(normalizedValue);
}

function formatStatsSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "New";
  }
  if (value === 0) {
    return "0%";
  }
  const rounded = Math.round(value * 10) / 10;
  const absoluteValue = Math.abs(rounded).toLocaleString(undefined, {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  });
  return rounded > 0 ? `+${absoluteValue}%` : `-${absoluteValue}%`;
}

function formatStatsRankingPlace(rank: number): string {
  const safeRank = Math.max(1, Math.trunc(rank));
  if (safeRank % 100 >= 11 && safeRank % 100 <= 13) {
    return `${safeRank}th`;
  }
  switch (safeRank % 10) {
    case 1:
      return `${safeRank}st`;
    case 2:
      return `${safeRank}nd`;
    case 3:
      return `${safeRank}rd`;
    default:
      return `${safeRank}th`;
  }
}

function buildEmptyStatsOverviewState(nowDate = new Date()): StatsOverviewState {
  const currentDay = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(
    nowDate.getDate()
  ).padStart(2, "0")}`;
  return {
    totalTracksRange: 0,
    totalTracksAllTime: 0,
    mostActiveMonster: null,
    tracksPerDay: [],
    topUsers: [],
    users: {
      leaderboard: [],
      mostTracksInDay: [],
      topMonsterTracked: [],
      longestStreakHours: [],
      additionalStats: [],
    },
    monsters: {
      perMonster: [],
    },
    distribution: {
      days: [currentDay],
      series: [],
      totalsPerDay: [0],
      summary: {
        totalAllDays: 0,
        avgPerDay: 0,
        maxDayTotal: 0,
        activeUsers: 0,
        daysRecorded: 0,
      },
    },
    timeTrends: {
      bucketInterval: "hour",
      buckets: [
        {
          bucket: `${currentDay} 00:00`,
          trackedCount: 0,
          trackedMovingAverage: 0,
          activeTrackerCount: 0,
          editOffsetCount: 0,
          setExactCount: 0,
          editLastKilledCount: 0,
          resetAllTimersCount: 0,
          correctionRatePercent: 0,
        },
      ],
      monsterMomentum: [],
      hourOfWeekHeatmap: [],
      handoffRates: [],
    },
  };
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

function normalizeMonsterNameForLookup(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function getStatsMonsterMetricValue(
  row: {
    trackedCount: number;
    editOffsetCount: number;
    setExactCount: number;
  },
  metric: StatsMonsterMetric
): number {
  switch (metric) {
    case "tracked":
      return row.trackedCount;
    case "editOffset":
      return row.editOffsetCount;
    case "setExact":
      return row.setExactCount;
    default:
      return 0;
  }
}

function getStatsUserLookupKey(uid: string | null, nickname: string): string {
  if (uid && uid.trim()) {
    return `uid:${uid.trim()}`;
  }
  return `name:${nickname.trim().toLowerCase()}`;
}

function toLooseMonsterNameLookupKey(name: string): string {
  return normalizeMonsterNameForLookup(name).replace(/[^a-z0-9]/g, "");
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
    case "offsetAsc":
      return compareNumbers(a.offsetSeconds, b.offsetSeconds);
    case "offsetDesc":
      return compareNumbers(b.offsetSeconds, a.offsetSeconds);
    case "trackedByAsc":
      return compareText(a.normalizedTrackedBy, b.normalizedTrackedBy);
    case "trackedByDesc":
      return compareText(b.normalizedTrackedBy, a.normalizedTrackedBy);
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
  isLoading: boolean;
  sortOption: MonsterSortOption;
  statsUserUid: string | null;
  excludedMonsterNames: string[];
  onCategoryFilterSelectionChange: (categoryId: string | null) => void;
  onSortOptionChange: (sortOption: MonsterSortOption) => void;
  onEditNameRequest: (id: string) => void;
  onRespawnHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onLastKilledChange: (id: string, iso: string) => void;
  onNextSpawnTimeChange: (id: string, targetSpawnMs: number) => void;
  onOffsetHoursMinutesChange: (id: string, hours: number, minutes: number) => void;
  onOffsetSubmitByEnter: () => void;
  onTrackLeftClick: () => void;
  onResetNow: (id: string) => void;
  onDelete: (id: string) => void;
  onSetExact: (id: string) => void;
  focusedMonsterId: string | null;
  onFocusedMonsterChange: (id: string | null) => void;
  categoryMap: Map<string, Category>;
  trackedByUserMap: Map<string, TrackedByUser>;
  onStatsExcludeMonsterAdd: (monsterName: string) => Promise<boolean>;
  onStatsExcludeMonsterDelete: (monsterName: string) => Promise<boolean>;
  onOpenHistory: () => void;
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

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (target.closest("[contenteditable=\"true\"]")) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function getSetExactRowIndexFromHotkey(event: KeyboardEvent): number | null {
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.repeat) {
    return null;
  }

  const { code } = event;
  if (!/^Digit[1-9]$/.test(code)) {
    return null;
  }

  const digit = Number.parseInt(code.slice("Digit".length), 10);
  if (!Number.isFinite(digit)) {
    return null;
  }

  return digit - 1;
}

export const MonsterTable = memo(function MonsterTable({
  monsters,
  isLoading,
  sortOption,
  statsUserUid,
  excludedMonsterNames,
  onCategoryFilterSelectionChange,
  onSortOptionChange,
  onEditNameRequest,
  onRespawnHoursMinutesChange,
  onLastKilledChange,
  onNextSpawnTimeChange,
  onOffsetHoursMinutesChange,
  onOffsetSubmitByEnter,
  onTrackLeftClick,
  onResetNow,
  onDelete,
  onSetExact,
  focusedMonsterId,
  onFocusedMonsterChange,
  categoryMap,
  trackedByUserMap,
  onStatsExcludeMonsterAdd,
  onStatsExcludeMonsterDelete,
  onOpenHistory,
  onOpenAddMonster,
  onOpenCategories,
}: MonsterTableProps) {
  const nowMs = useGlobalNow();
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [isStatsExcludesOpen, setIsStatsExcludesOpen] = useState(false);
  const [activeStatsView, setActiveStatsView] = useState<StatsViewTab>(DEFAULT_STATS_VIEW_TAB);
  const [activeStatsTimeRange, setActiveStatsTimeRange] = useState<StatsTimeRange>(DEFAULT_STATS_TIME_RANGE);
  const [activeStatsMonsterMetric, setActiveStatsMonsterMetric] =
    useState<StatsMonsterMetric>(DEFAULT_STATS_MONSTER_METRIC);
  const [activeStatsCategoryMetric, setActiveStatsCategoryMetric] =
    useState<StatsMonsterMetric>(DEFAULT_STATS_MONSTER_METRIC);
  const [statsExcludeMonsterInput, setStatsExcludeMonsterInput] = useState("");
  const [statsExcludeMonsterError, setStatsExcludeMonsterError] = useState<string | null>(null);
  const [isStatsMonsterSuggestionsOpen, setIsStatsMonsterSuggestionsOpen] = useState(false);
  const [statsOverviewState, setStatsOverviewState] = useState<StatsOverviewState>(() =>
    buildEmptyStatsOverviewState()
  );
  const [statsOverviewLoadStatus, setStatsOverviewLoadStatus] = useState<StatsOverviewLoadStatus>("idle");
  const [statsOverviewError, setStatsOverviewError] = useState<string | null>(null);
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
  const statsExcludeMonsterInputRef = useRef<HTMLInputElement | null>(null);
  const statsMonsterSuggestionsCloseTimeoutRef = useRef<number | null>(null);
  const statsOverviewRequestSequenceRef = useRef(0);
  const statsOverviewInFlightRef = useRef(false);
  const statsOverviewRangeCacheRef = useRef<Map<string, { expiresAt: number; result: StatsOverviewState }>>(
    new Map()
  );
  const hasMeasuredVirtualRowHeightRef = useRef(false);
  const [firstVisibleRowIndex, setFirstVisibleRowIndex] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [virtualRowHeight, setVirtualRowHeight] = useState(DEFAULT_VIRTUAL_ROW_HEIGHT);
  const offsetMinutesFocusRequestIdRef = useRef(0);
  const lastHandledOffsetMinutesFocusRequestIdRef = useRef(0);
  const sortedMonstersRef = useRef<IndexedMonster[]>([]);
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
  const statsMonsterSuggestions = useMemo(() => {
    const unique = new Map<string, StatsMonsterSuggestion>();
    for (const monster of monsters) {
      const trimmedName = monster.name.trim();
      if (!trimmedName) {
        continue;
      }
      const normalizedName = trimmedName.toLowerCase();
      if (!unique.has(normalizedName)) {
        unique.set(normalizedName, {
          name: trimmedName,
          normalizedName,
          color: monster.categoryId ? categoryMap.get(monster.categoryId)?.color ?? null : null,
        });
      }
    }
    return Array.from(unique.values()).sort((left, right) => compareText(left.name, right.name));
  }, [categoryMap, monsters]);
  const statsMonsterSuggestionLookup = useMemo(() => {
    const lookup = new Map<string, StatsMonsterSuggestion>();
    for (const suggestion of statsMonsterSuggestions) {
      lookup.set(suggestion.normalizedName, suggestion);
    }
    return lookup;
  }, [statsMonsterSuggestions]);
  const filteredStatsMonsterSuggestions = useMemo(() => {
    const normalizedSearch = statsExcludeMonsterInput.trim().toLowerCase();
    const filtered = normalizedSearch
      ? statsMonsterSuggestions.filter((suggestion) =>
          suggestion.normalizedName.includes(normalizedSearch)
        )
      : statsMonsterSuggestions;
    return filtered.slice(0, 24);
  }, [statsExcludeMonsterInput, statsMonsterSuggestions]);
  const matchedStatsExcludeMonster = useMemo(() => {
    const normalized = statsExcludeMonsterInput.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return statsMonsterSuggestionLookup.get(normalized) ?? null;
  }, [statsExcludeMonsterInput, statsMonsterSuggestionLookup]);
  const statsExcludeMonsterInputStyle = useMemo(
    () => (matchedStatsExcludeMonster?.color ? { color: matchedStatsExcludeMonster.color } : undefined),
    [matchedStatsExcludeMonster]
  );
  const statsMonsterColorLookups = useMemo(() => {
    const exactLookup = new Map<string, string>();
    const looseLookup = new Map<string, string>();
    for (const monster of monsters) {
      const color = monster.categoryId ? categoryMap.get(monster.categoryId)?.color : null;
      if (!color) {
        continue;
      }
      const normalizedName = normalizeMonsterNameForLookup(monster.name);
      if (normalizedName && !exactLookup.has(normalizedName)) {
        exactLookup.set(normalizedName, color);
      }
      const looseKey = toLooseMonsterNameLookupKey(monster.name);
      if (looseKey && !looseLookup.has(looseKey)) {
        looseLookup.set(looseKey, color);
      }
    }
    return {
      exactLookup,
      looseLookup,
    };
  }, [categoryMap, monsters]);
  const normalizedExcludedMonsterNames = useMemo(
    () =>
      Array.from(
        new Set(
          excludedMonsterNames
            .map((name) => name.trim().toLowerCase())
            .filter((name) => name.length > 0)
        )
      ),
    [excludedMonsterNames]
  );
  const getStatsMonsterNameColor = useCallback(
    (monsterName: string): string | undefined => {
      const normalizedName = normalizeMonsterNameForLookup(monsterName);
      if (!normalizedName) {
        return undefined;
      }
      const exactColor = statsMonsterColorLookups.exactLookup.get(normalizedName);
      if (exactColor) {
        return exactColor;
      }
      const looseKey = toLooseMonsterNameLookupKey(normalizedName);
      if (looseKey) {
        const looseColor = statsMonsterColorLookups.looseLookup.get(looseKey);
        if (looseColor) {
          return looseColor;
        }
      }
      for (const [knownName, knownColor] of statsMonsterColorLookups.exactLookup.entries()) {
        if (knownName.includes(normalizedName) || normalizedName.includes(knownName)) {
          return knownColor;
        }
      }
      return undefined;
    },
    [statsMonsterColorLookups]
  );
  const statsMostActiveMonsterColor = useMemo(() => {
    const monsterName = statsOverviewState.mostActiveMonster?.name;
    if (!monsterName) {
      return undefined;
    }
    return getStatsMonsterNameColor(monsterName);
  }, [getStatsMonsterNameColor, statsOverviewState.mostActiveMonster]);
  const topMonsterTrackedByUser = useMemo(() => {
    const lookup = new Map<string, { monsterName: string; count: number }>();
    for (const entry of statsOverviewState.users.topMonsterTracked) {
      lookup.set(getStatsUserLookupKey(entry.uid, entry.nickname), {
        monsterName: entry.monsterName,
        count: entry.count,
      });
    }
    return lookup;
  }, [statsOverviewState.users.topMonsterTracked]);
  const excludedStatsMonsterNameSet = useMemo(
    () => new Set(normalizedExcludedMonsterNames),
    [normalizedExcludedMonsterNames]
  );
  const statsMonsterRows = useMemo(() => {
    const rowsByNormalizedName = new Map<
      string,
      {
        monsterName: string;
        trackedCount: number;
        editOffsetCount: number;
        setExactCount: number;
        mostKilledBy: Array<{ uid: string | null; nickname: string; count: number }>;
        leastKilledBy: Array<{ uid: string | null; nickname: string; count: number }>;
      }
    >();
    const mergeTrackedUsers = (
      left: Array<{ uid: string | null; nickname: string; count: number }>,
      right: Array<{ uid: string | null; nickname: string; count: number }>
    ) => {
      const merged = new Map<string, { uid: string | null; nickname: string; count: number }>();
      for (const entry of [...left, ...right]) {
        const key = entry.uid ? `uid:${entry.uid}` : `name:${entry.nickname.trim().toLowerCase()}`;
        if (!merged.has(key)) {
          merged.set(key, entry);
        }
      }
      return Array.from(merged.values()).sort((a, b) => compareText(a.nickname, b.nickname));
    };

    for (const row of statsOverviewState.monsters.perMonster) {
      const trimmedName = row.monsterName.trim();
      const normalizedName = normalizeMonsterNameForLookup(trimmedName);
      if (!normalizedName || excludedStatsMonsterNameSet.has(normalizedName)) {
        continue;
      }

      const existing = rowsByNormalizedName.get(normalizedName);
      if (!existing) {
        rowsByNormalizedName.set(normalizedName, {
          monsterName: trimmedName,
          trackedCount: row.trackedCount,
          editOffsetCount: row.editOffsetCount,
          setExactCount: row.setExactCount,
          mostKilledBy: row.mostKilledBy,
          leastKilledBy: row.leastKilledBy,
        });
        continue;
      }

      existing.trackedCount += row.trackedCount;
      existing.editOffsetCount += row.editOffsetCount;
      existing.setExactCount += row.setExactCount;
      existing.mostKilledBy = mergeTrackedUsers(existing.mostKilledBy, row.mostKilledBy);
      existing.leastKilledBy = mergeTrackedUsers(existing.leastKilledBy, row.leastKilledBy);
    }

    for (const monster of monsters) {
      const trimmedName = monster.name.trim();
      const normalizedName = normalizeMonsterNameForLookup(trimmedName);
      if (!normalizedName || excludedStatsMonsterNameSet.has(normalizedName)) {
        continue;
      }
      const existing = rowsByNormalizedName.get(normalizedName);
      if (existing) {
        existing.monsterName = trimmedName;
        continue;
      }
      rowsByNormalizedName.set(normalizedName, {
        monsterName: trimmedName,
        trackedCount: 0,
        editOffsetCount: 0,
        setExactCount: 0,
        mostKilledBy: [],
        leastKilledBy: [],
      });
    }

    return Array.from(rowsByNormalizedName.values())
      .sort((left, right) => compareText(left.monsterName, right.monsterName))
      .map((entry) => ({
        ...entry,
        color: getStatsMonsterNameColor(entry.monsterName),
      }));
  }, [
    excludedStatsMonsterNameSet,
    getStatsMonsterNameColor,
    monsters,
    statsOverviewState.monsters.perMonster,
  ]);
  const activeStatsMonsterMetricLabel = useMemo(
    () =>
      STATS_MONSTER_METRIC_OPTIONS.find((option) => option.key === activeStatsMonsterMetric)?.label ?? "Tracked",
    [activeStatsMonsterMetric]
  );
  const statsMonsterPieData = useMemo(
    () =>
      statsMonsterRows
        .map((row) => ({
          monsterName: row.monsterName,
          value: getStatsMonsterMetricValue(row, activeStatsMonsterMetric),
        }))
        .filter((entry) => entry.value > 0)
        .sort((left, right) => right.value - left.value || compareText(left.monsterName, right.monsterName)),
    [activeStatsMonsterMetric, statsMonsterRows]
  );
  const statsMonsterCategoryLookups = useMemo(() => {
    const exactLookup = new Map<
      string,
      { categoryKey: string; categoryName: string; color: string; isUncategorized: boolean }
    >();
    const looseLookup = new Map<
      string,
      { categoryKey: string; categoryName: string; color: string; isUncategorized: boolean }
    >();
    for (const monster of monsters) {
      const normalizedName = normalizeMonsterNameForLookup(monster.name);
      if (!normalizedName) {
        continue;
      }
      const category = monster.categoryId ? categoryMap.get(monster.categoryId) ?? null : null;
      const categoryEntry = {
        categoryKey: category ? `category:${category.id}` : STATS_UNCATEGORIZED_CATEGORY_KEY,
        categoryName: category?.name.trim() || STATS_UNCATEGORIZED_CATEGORY_LABEL,
        color: category?.color || STATS_UNCATEGORIZED_CATEGORY_COLOR,
        isUncategorized: !category,
      };
      if (!exactLookup.has(normalizedName)) {
        exactLookup.set(normalizedName, categoryEntry);
      }
      const looseKey = toLooseMonsterNameLookupKey(monster.name);
      if (looseKey && !looseLookup.has(looseKey)) {
        looseLookup.set(looseKey, categoryEntry);
      }
    }
    return {
      exactLookup,
      looseLookup,
    };
  }, [categoryMap, monsters]);
  const getStatsMonsterCategory = useCallback(
    (monsterName: string) => {
      const normalizedName = normalizeMonsterNameForLookup(monsterName);
      if (normalizedName) {
        const exactMatch = statsMonsterCategoryLookups.exactLookup.get(normalizedName);
        if (exactMatch) {
          return exactMatch;
        }
        const looseKey = toLooseMonsterNameLookupKey(normalizedName);
        if (looseKey) {
          const looseMatch = statsMonsterCategoryLookups.looseLookup.get(looseKey);
          if (looseMatch) {
            return looseMatch;
          }
        }
        for (const [knownName, categoryEntry] of statsMonsterCategoryLookups.exactLookup.entries()) {
          if (knownName.includes(normalizedName) || normalizedName.includes(knownName)) {
            return categoryEntry;
          }
        }
      }
      return {
        categoryKey: STATS_UNCATEGORIZED_CATEGORY_KEY,
        categoryName: STATS_UNCATEGORIZED_CATEGORY_LABEL,
        color: STATS_UNCATEGORIZED_CATEGORY_COLOR,
        isUncategorized: true,
      };
    },
    [statsMonsterCategoryLookups]
  );
  const statsCategoryRows = useMemo<StatsCategoryRollup[]>(() => {
    const rowsByCategory = new Map<
      string,
      {
        categoryKey: string;
        categoryName: string;
        color: string;
        isUncategorized: boolean;
        trackedCount: number;
        editOffsetCount: number;
        setExactCount: number;
        monsters: Array<{ monsterName: string; trackedCount: number; color?: string }>;
      }
    >();
    const ensureCategoryRow = ({
      categoryKey,
      categoryName,
      color,
      isUncategorized,
    }: {
      categoryKey: string;
      categoryName: string;
      color: string;
      isUncategorized: boolean;
    }) => {
      const existing = rowsByCategory.get(categoryKey);
      if (existing) {
        return existing;
      }
      const created = {
        categoryKey,
        categoryName,
        color,
        isUncategorized,
        trackedCount: 0,
        editOffsetCount: 0,
        setExactCount: 0,
        monsters: [],
      };
      rowsByCategory.set(categoryKey, created);
      return created;
    };

    for (const category of Array.from(categoryMap.values()).sort((left, right) => compareText(left.name, right.name))) {
      ensureCategoryRow({
        categoryKey: `category:${category.id}`,
        categoryName: category.name,
        color: category.color,
        isUncategorized: false,
      });
    }

    for (const row of statsMonsterRows) {
      const categoryEntry = getStatsMonsterCategory(row.monsterName);
      const categoryRow = ensureCategoryRow(categoryEntry);
      categoryRow.trackedCount += row.trackedCount;
      categoryRow.editOffsetCount += row.editOffsetCount;
      categoryRow.setExactCount += row.setExactCount;
      categoryRow.monsters.push({
        monsterName: row.monsterName,
        trackedCount: row.trackedCount,
        color: getStatsMonsterNameColor(row.monsterName),
      });
    }

    return Array.from(rowsByCategory.values())
      .filter(
        (entry) =>
          !entry.isUncategorized ||
          entry.monsters.length > 0 ||
          entry.trackedCount > 0 ||
          entry.editOffsetCount > 0 ||
          entry.setExactCount > 0
      )
      .map((entry) => {
        const maxTrackedCount = entry.monsters.reduce(
          (highest, monsterEntry) => (monsterEntry.trackedCount > highest ? monsterEntry.trackedCount : highest),
          0
        );
        const minTrackedCount = entry.monsters.reduce(
          (lowest, monsterEntry) => (monsterEntry.trackedCount < lowest ? monsterEntry.trackedCount : lowest),
          Number.POSITIVE_INFINITY
        );
        const hasAnyTrackedActivity = maxTrackedCount > 0;
        const mostTracked =
          hasAnyTrackedActivity
            ? entry.monsters
                .filter((monsterEntry) => monsterEntry.trackedCount === maxTrackedCount)
                .sort((left, right) => compareText(left.monsterName, right.monsterName))
                .map((monsterEntry) => ({
                  monsterName: monsterEntry.monsterName,
                  count: monsterEntry.trackedCount,
                  color: monsterEntry.color,
                }))
            : [];
        const leastTracked =
          hasAnyTrackedActivity && Number.isFinite(minTrackedCount) && entry.monsters.length > 0
            ? entry.monsters
                .filter((monsterEntry) => monsterEntry.trackedCount === minTrackedCount)
                .sort((left, right) => compareText(left.monsterName, right.monsterName))
                .map((monsterEntry) => ({
                  monsterName: monsterEntry.monsterName,
                  count: monsterEntry.trackedCount,
                  color: monsterEntry.color,
                }))
            : [];
        return {
          categoryKey: entry.categoryKey,
          categoryName: entry.categoryName,
          color: entry.color,
          isUncategorized: entry.isUncategorized,
          trackedCount: entry.trackedCount,
          editOffsetCount: entry.editOffsetCount,
          setExactCount: entry.setExactCount,
          mostTracked,
          leastTracked,
        };
      })
      .sort(
        (left, right) =>
          right.trackedCount - left.trackedCount ||
          compareText(left.categoryName, right.categoryName)
      );
  }, [categoryMap, getStatsMonsterCategory, getStatsMonsterNameColor, statsMonsterRows]);
  const activeStatsCategoryMetricLabel = useMemo(
    () =>
      STATS_MONSTER_METRIC_OPTIONS.find((option) => option.key === activeStatsCategoryMetric)?.label ?? "Tracked",
    [activeStatsCategoryMetric]
  );
  const statsCategoryPieData = useMemo(
    () =>
      statsCategoryRows
        .map((row) => ({
          monsterName: row.categoryName,
          value: getStatsMonsterMetricValue(row, activeStatsCategoryMetric),
          color: row.color,
        }))
        .filter((entry) => entry.value > 0)
        .sort((left, right) => right.value - left.value || compareText(left.monsterName, right.monsterName)),
    [activeStatsCategoryMetric, statsCategoryRows]
  );
  const statsMonsterAverageRangeDays = useMemo(() => {
    if (activeStatsTimeRange === "All Time") {
      const totalDays = statsOverviewState.distribution.days.length;
      if (!Number.isFinite(totalDays) || totalDays <= 0) {
        return 1;
      }
      return Math.max(1, Math.trunc(totalDays));
    }
    const rangeStartMs = getStatsRangeStartMs(activeStatsTimeRange);
    if (rangeStartMs === null) {
      return 1;
    }
    const elapsedDays = (Date.now() - rangeStartMs) / STATS_DAY_MS;
    if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) {
      return 1;
    }
    return elapsedDays;
  }, [activeStatsTimeRange, statsOverviewState.distribution.days.length]);
  const statsShouldShowTracksPerDay = useMemo(
    () => shouldShowTracksPerDayForRange(activeStatsTimeRange),
    [activeStatsTimeRange]
  );
  const statsDistributionInterval = useMemo(
    () => (activeStatsTimeRange === "8h" || activeStatsTimeRange === "Today" ? "hour" : "day"),
    [activeStatsTimeRange]
  );
  const statsTimeTrendBuckets = useMemo(
    () => statsOverviewState.timeTrends.buckets,
    [statsOverviewState.timeTrends.buckets]
  );
  const statsTimeTrendBucketKeys = useMemo(
    () => statsTimeTrendBuckets.map((entry) => entry.bucket),
    [statsTimeTrendBuckets]
  );
  const statsTrackVolumeSeries = useMemo<StatsTrendSeries[]>(
    () => [
      {
        key: "tracked",
        label: "Tracked Monster",
        color: "#59b5ff",
        values: statsTimeTrendBuckets.map((entry) => entry.trackedCount),
      },
      {
        key: "movingAverage",
        label: "Moving Average",
        color: "#f5c26b",
        values: statsTimeTrendBuckets.map((entry) => entry.trackedMovingAverage),
      },
    ],
    [statsTimeTrendBuckets]
  );
  const statsActiveTrackerSeries = useMemo<StatsTrendSeries[]>(
    () => [
      {
        key: "activeTrackers",
        label: "Unique Active Trackers",
        color: "#72d6a4",
        values: statsTimeTrendBuckets.map((entry) => entry.activeTrackerCount),
      },
    ],
    [statsTimeTrendBuckets]
  );
  const statsActionMixSeries = useMemo<StatsTrendSeries[]>(
    () => [
      {
        key: "tracked",
        label: "Tracked Monster",
        color: "#59b5ff",
        values: statsTimeTrendBuckets.map((entry) => entry.trackedCount),
      },
      {
        key: "editOffset",
        label: "Edit Offset",
        color: "#f0a552",
        values: statsTimeTrendBuckets.map((entry) => entry.editOffsetCount),
      },
      {
        key: "setExact",
        label: "Set Exact Spawn",
        color: "#68cf95",
        values: statsTimeTrendBuckets.map((entry) => entry.setExactCount),
      },
      {
        key: "editLastKilled",
        label: "Edit Last Killed",
        color: "#e57d6f",
        values: statsTimeTrendBuckets.map((entry) => entry.editLastKilledCount),
      },
      {
        key: "resetAllTimers",
        label: "Reset All Timers",
        color: "#8ca0b4",
        values: statsTimeTrendBuckets.map((entry) => entry.resetAllTimersCount),
      },
    ],
    [statsTimeTrendBuckets]
  );
  const statsCorrectionRateSeries = useMemo<StatsTrendSeries[]>(
    () => [
      {
        key: "correctionRate",
        label: "Timer Correction Rate %",
        color: "#ffb971",
        values: statsTimeTrendBuckets.map((entry) => entry.correctionRatePercent),
      },
    ],
    [statsTimeTrendBuckets]
  );
  const statsAverageCorrectionRate = useMemo(() => {
    if (statsTimeTrendBuckets.length === 0) {
      return 0;
    }
    const totalRate = statsTimeTrendBuckets.reduce((sum, entry) => sum + entry.correctionRatePercent, 0);
    return totalRate / statsTimeTrendBuckets.length;
  }, [statsTimeTrendBuckets]);
  const statsTrackVolumeMovingAverageLabel = useMemo(
    () =>
      statsOverviewState.timeTrends.bucketInterval === "hour"
        ? "6-hour moving average"
        : "7-day moving average",
    [statsOverviewState.timeTrends.bucketInterval]
  );
  const shouldFetchStatsOverview = useMemo(
    () =>
      activeStatsView === "Overview" ||
      activeStatsView === "Users" ||
      activeStatsView === "Monsters" ||
      activeStatsView === "Time & Trends" ||
      activeStatsView === "Categories",
    [activeStatsView]
  );
  const statsHasMeaningfulData = useMemo(
    () =>
      statsOverviewState.totalTracksAllTime > 0 ||
      statsOverviewState.totalTracksRange > 0 ||
      statsOverviewState.topUsers.length > 0 ||
      statsOverviewState.users.leaderboard.length > 0 ||
      statsOverviewState.monsters.perMonster.length > 0 ||
      statsOverviewState.distribution.summary.totalAllDays > 0 ||
      statsOverviewState.timeTrends.buckets.some((bucket) => bucket.trackedCount > 0),
    [statsOverviewState]
  );
  const shouldShowStatsInitialLoading =
    statsOverviewLoadStatus === "loading" &&
    !statsHasMeaningfulData &&
    !statsOverviewError;
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
    return () => {
      if (statsMonsterSuggestionsCloseTimeoutRef.current !== null) {
        window.clearTimeout(statsMonsterSuggestionsCloseTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const unsubscribe = window.electronAPI?.onOpenSetExactByIndex?.((rowIndex) => {
      const currentSortedMonsters = sortedMonstersRef.current;
      if (rowIndex < 0 || rowIndex >= currentSortedMonsters.length) {
        return;
      }
      onSetExact(currentSortedMonsters[rowIndex].monster.id);
    });

    return () => {
      unsubscribe?.();
    };
  }, [onSetExact]);

  const fetchStatsOverview = useCallback(async () => {
    if (typeof window === "undefined" || !window.electronAPI?.queryStatsOverview || !statsUserUid) {
      setStatsOverviewState(buildEmptyStatsOverviewState());
      setStatsOverviewLoadStatus("success");
      setStatsOverviewError(null);
      statsOverviewRangeCacheRef.current.clear();
      return;
    }

    const cacheKey = JSON.stringify({
      userUid: statsUserUid,
      range: activeStatsTimeRange,
      excluded: normalizedExcludedMonsterNames,
    });
    const nowTimestampMs = Date.now();
    const cachedEntry = statsOverviewRangeCacheRef.current.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > nowTimestampMs) {
      setStatsOverviewState(cachedEntry.result);
      setStatsOverviewError(null);
      setStatsOverviewLoadStatus("success");
      return;
    }

    if (statsOverviewInFlightRef.current) {
      return;
    }

    statsOverviewInFlightRef.current = true;
    const requestId = statsOverviewRequestSequenceRef.current + 1;
    statsOverviewRequestSequenceRef.current = requestId;
    setStatsOverviewLoadStatus((current) =>
      current === "success" && statsHasMeaningfulData ? current : "loading"
    );

    try {
      const response = await window.electronAPI.queryStatsOverview({
        userUid: statsUserUid,
        rangeStartMs: getStatsRangeStartMs(activeStatsTimeRange),
        includeTracksPerDay: shouldShowTracksPerDayForRange(activeStatsTimeRange),
        excludeMonsterNames: normalizedExcludedMonsterNames,
        distributionInterval: statsDistributionInterval,
      });
      if (requestId !== statsOverviewRequestSequenceRef.current) {
        return;
      }

      setStatsOverviewState(response);
      setStatsOverviewError(null);
      setStatsOverviewLoadStatus("success");
      statsOverviewRangeCacheRef.current.set(cacheKey, {
        expiresAt: Date.now() + STATS_RANGE_CACHE_TTL_MS,
        result: response,
      });
      if (statsOverviewRangeCacheRef.current.size > 12) {
        const cacheEntries = Array.from(statsOverviewRangeCacheRef.current.entries()).sort(
          (left, right) => left[1].expiresAt - right[1].expiresAt
        );
        while (statsOverviewRangeCacheRef.current.size > 10 && cacheEntries.length > 0) {
          const oldest = cacheEntries.shift();
          if (!oldest) {
            break;
          }
          statsOverviewRangeCacheRef.current.delete(oldest[0]);
        }
      }
    } catch (error) {
      if (requestId !== statsOverviewRequestSequenceRef.current) {
        return;
      }
      setStatsOverviewError(error instanceof Error ? error.message : "Failed to load stats.");
      setStatsOverviewLoadStatus("error");
    } finally {
      if (requestId === statsOverviewRequestSequenceRef.current) {
        statsOverviewInFlightRef.current = false;
      }
    }
  }, [
    activeStatsTimeRange,
    normalizedExcludedMonsterNames,
    statsDistributionInterval,
    statsHasMeaningfulData,
    statsUserUid,
  ]);

  useEffect(() => {
    if (!isStatsModalOpen || !shouldFetchStatsOverview) {
      statsOverviewRequestSequenceRef.current += 1;
      statsOverviewInFlightRef.current = false;
      setStatsOverviewLoadStatus("idle");
      return;
    }

    let isDisposed = false;
    const debounceHandle = window.setTimeout(() => {
      if (isDisposed) {
        return;
      }
      void fetchStatsOverview();
    }, STATS_QUERY_DEBOUNCE_MS);
    const refreshHandle = window.setInterval(() => {
      if (isDisposed) {
        return;
      }
      void fetchStatsOverview();
    }, STATS_QUERY_REFRESH_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearTimeout(debounceHandle);
      window.clearInterval(refreshHandle);
      statsOverviewRequestSequenceRef.current += 1;
      statsOverviewInFlightRef.current = false;
    };
  }, [fetchStatsOverview, isStatsModalOpen, shouldFetchStatsOverview]);

  const indexedMonsters = useMemo(
    () =>
      monsters.map((monster) => {
        const trackedByNickname = monster.lastTrackedByUid
          ? (trackedByUserMap.get(monster.lastTrackedByUid)?.nickname ?? "")
          : "";
        return {
          monster,
          normalizedName: monster.name.toLowerCase(),
          respawnHours: monster.respawnDuration / 3600,
          nextSpawnMs: calculateNextSpawn(monster),
          lastKilledMs: Date.parse(monster.lastKilledTimestamp),
          offsetSeconds: monster.offsetSeconds ?? 0,
          normalizedTrackedBy: trackedByNickname.trim().toLowerCase(),
        };
      }),
    [monsters, trackedByUserMap]
  );

  const baseFilteredMonsters = useMemo(() => {
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
      next.push(indexedMonster);
    }

    return next;
  }, [
    indexedMonsters,
    maxRespawnHours,
    minRespawnHours,
    normalizedSearchTerm,
    categoryFilter,
    selectedCategoryId,
  ]);

  const filteredMonsters = useMemo(() => {
    if (readyFilter === "all") {
      return baseFilteredMonsters;
    }

    const next: IndexedMonster[] = [];
    for (const indexedMonster of baseFilteredMonsters) {
      if (matchesReadyFilter(readyFilter, indexedMonster.nextSpawnMs, nowMs)) {
        next.push(indexedMonster);
      }
    }
    return next;
  }, [baseFilteredMonsters, readyFilter, nowMs]);

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

  useEffect(() => {
    sortedMonstersRef.current = sortedMonsters;
  }, [sortedMonsters]);

  useEffect(() => {
    const handleSetExactHotkey = (event: KeyboardEvent) => {
      const rowIndex = getSetExactRowIndexFromHotkey(event);
      if (rowIndex === null) {
        return;
      }
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest(".modal")) {
        return;
      }

      const currentSortedMonsters = sortedMonstersRef.current;
      if (rowIndex < 0 || rowIndex >= currentSortedMonsters.length) {
        return;
      }

      event.preventDefault();
      onSetExact(currentSortedMonsters[rowIndex].monster.id);
    };

    window.addEventListener("keydown", handleSetExactHotkey);
    return () => {
      window.removeEventListener("keydown", handleSetExactHotkey);
    };
  }, [onSetExact]);

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
  const longestMonsterNameLength = useMemo(() => {
    let longest = "Name".length;
    for (const monster of monsters) {
      longest = Math.max(longest, monster.name.trim().length);
    }
    return longest;
  }, [monsters]);
  const nameColumnWidthCh = useMemo(
    () => Math.max(NAME_COLUMN_MIN_WIDTH_CH, longestMonsterNameLength + NAME_COLUMN_EXTRA_CH),
    [longestMonsterNameLength]
  );
  const tableStyle = useMemo(
    () =>
      ({
        "--monster-name-col-width": `${nameColumnWidthCh}ch`,
      }) as CSSProperties,
    [nameColumnWidthCh]
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
  const handleColumnHeaderSortClick = useCallback(
    (columnKey: MonsterTableColumnKey) => {
      const sortableColumn = HEADER_SORT_COLUMN_BY_TABLE_COLUMN[columnKey];
      if (!sortableColumn) {
        return;
      }
      onSortOptionChange(getNextSortOptionForColumn(sortOption, sortableColumn));
    },
    [onSortOptionChange, sortOption]
  );

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
  const handleOpenStatsModal = useCallback(() => {
    setActiveStatsView(DEFAULT_STATS_VIEW_TAB);
    setActiveStatsTimeRange(DEFAULT_STATS_TIME_RANGE);
    setIsStatsExcludesOpen(false);
    setIsStatsMonsterSuggestionsOpen(false);
    setStatsExcludeMonsterInput("");
    setStatsExcludeMonsterError(null);
    setStatsOverviewError(null);
    setStatsOverviewLoadStatus("loading");
    setIsStatsModalOpen(true);
  }, []);
  const handleCloseStatsModal = useCallback(() => {
    setActiveStatsView(DEFAULT_STATS_VIEW_TAB);
    setActiveStatsTimeRange(DEFAULT_STATS_TIME_RANGE);
    setIsStatsExcludesOpen(false);
    setIsStatsMonsterSuggestionsOpen(false);
    setStatsExcludeMonsterInput("");
    setStatsExcludeMonsterError(null);
    setStatsOverviewError(null);
    setStatsOverviewLoadStatus("idle");
    setIsStatsModalOpen(false);
  }, []);
  const handleStatsExcludesToggle = useCallback(() => {
    setIsStatsExcludesOpen((current) => !current);
    setIsStatsMonsterSuggestionsOpen(false);
    setStatsExcludeMonsterError(null);
  }, []);
  const handleStatsExcludeMonsterInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setStatsExcludeMonsterInput(event.target.value);
    setIsStatsMonsterSuggestionsOpen(true);
    if (statsExcludeMonsterError) {
      setStatsExcludeMonsterError(null);
    }
  }, [statsExcludeMonsterError]);
  const handleStatsExcludeMonsterInputFocus = useCallback(() => {
    if (statsMonsterSuggestionsCloseTimeoutRef.current !== null) {
      window.clearTimeout(statsMonsterSuggestionsCloseTimeoutRef.current);
      statsMonsterSuggestionsCloseTimeoutRef.current = null;
    }
    setIsStatsMonsterSuggestionsOpen(true);
  }, []);
  const handleStatsExcludeMonsterInputBlur = useCallback(() => {
    if (statsMonsterSuggestionsCloseTimeoutRef.current !== null) {
      window.clearTimeout(statsMonsterSuggestionsCloseTimeoutRef.current);
    }
    statsMonsterSuggestionsCloseTimeoutRef.current = window.setTimeout(() => {
      setIsStatsMonsterSuggestionsOpen(false);
      statsMonsterSuggestionsCloseTimeoutRef.current = null;
    }, 120);
  }, []);
  const handleStatsMonsterSuggestionMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const suggestionName = event.currentTarget.dataset.suggestionName;
      if (!suggestionName) {
        return;
      }
      if (statsMonsterSuggestionsCloseTimeoutRef.current !== null) {
        window.clearTimeout(statsMonsterSuggestionsCloseTimeoutRef.current);
        statsMonsterSuggestionsCloseTimeoutRef.current = null;
      }
      setStatsExcludeMonsterInput(suggestionName);
      setStatsExcludeMonsterError(null);
      setIsStatsMonsterSuggestionsOpen(false);
      statsExcludeMonsterInputRef.current?.focus();
    },
    []
  );
  const handleStatsExcludeMonsterSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = statsExcludeMonsterInput.trim();
      if (!trimmed) {
        setStatsExcludeMonsterError("Choose a monster to exclude.");
        return;
      }

      const matchingSuggestion = statsMonsterSuggestionLookup.get(trimmed.toLowerCase());
      if (!matchingSuggestion) {
        setStatsExcludeMonsterError("Monster not found.");
        return;
      }

      const canonicalName = matchingSuggestion.name;
      const alreadyExcluded = excludedMonsterNames.some(
        (existingName) => existingName.toLowerCase() === canonicalName.toLowerCase()
      );
      if (alreadyExcluded) {
        setStatsExcludeMonsterError("Monster is already excluded.");
        return;
      }

      const didSave = await onStatsExcludeMonsterAdd(canonicalName);
      if (!didSave) {
        setStatsExcludeMonsterError("Failed to save excluded monster.");
        return;
      }

      setStatsExcludeMonsterInput("");
      setStatsExcludeMonsterError(null);
      setIsStatsMonsterSuggestionsOpen(false);
    },
    [excludedMonsterNames, onStatsExcludeMonsterAdd, statsExcludeMonsterInput, statsMonsterSuggestionLookup]
  );
  const handleStatsExcludedMonsterDelete = useCallback(
    async (monsterName: string) => {
      const didDelete = await onStatsExcludeMonsterDelete(monsterName);
      if (didDelete) {
        setStatsExcludeMonsterError(null);
        return;
      }

      setStatsExcludeMonsterError("Failed to remove excluded monster.");
    },
    [onStatsExcludeMonsterDelete]
  );

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
  const loadingColSpan = Math.max(1, visibleColumnCount);
  const shouldShowLoadingRow = isLoading && sortedMonsters.length === 0;

  return (
    <>
      <section className="panel table-panel">
      <div className="table-panel-header">
        <div className="table-panel-title-group">
          <h2>All Monsters</h2>
          <button
            type="button"
            className="table-panel-action-btn table-stats-btn"
            onClick={handleOpenStatsModal}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 20h16v-2H4v2zm2-4h3V8H6v8zm5 0h3V4h-3v12zm5 0h3v-6h-3v6z"
                fill="currentColor"
              />
            </svg>
            <span>Stats</span>
          </button>
          <button type="button" className="table-panel-action-btn table-stats-btn" onClick={onOpenHistory}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-2.34-5.66L15 9h7V2l-2.89 2.89A9.96 9.96 0 0 0 12 2zm-.75 5.25v5.06l4.2 2.52 1.1-1.82-3.3-1.98V7.25h-2z"
                fill="currentColor"
              />
            </svg>
            <span>History</span>
          </button>
        </div>
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
        <table style={tableStyle}>
          <thead>
            <tr>
              {TABLE_COLUMNS.map((column) => {
                if (!columnVisibility[column.key]) {
                  return null;
                }

                const sortableColumn = HEADER_SORT_COLUMN_BY_TABLE_COLUMN[column.key];
                const isSortable = typeof sortableColumn === "string";
                const activeSortMeta = SORT_OPTION_META[sortOption];
                const isSortActive = isSortable && activeSortMeta.column === sortableColumn;
                const sortDirection = isSortActive ? activeSortMeta.direction : null;
                const nextDirectionLabel =
                  isSortActive && sortDirection === "asc" ? "descending" : "ascending";

                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      isSortable
                        ? (isSortActive
                            ? (sortDirection === "asc" ? "ascending" : "descending")
                            : "none")
                        : undefined
                    }
                    className={
                      [
                        column.key === "name" ? "sticky-name-col" : "",
                        column.key === "lastKilled" || column.key === "nextSpawnTime"
                          ? "table-col-datetime"
                          : "",
                        isSortable ? "table-col-sortable" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        className={["table-sort-header", isSortActive ? "is-active" : ""].filter(Boolean).join(" ")}
                        onClick={() => handleColumnHeaderSortClick(column.key)}
                        aria-label={`Sort by ${column.label} (${nextDirectionLabel})`}
                        title={`Sort by ${column.label}`}
                      >
                        <span>{column.label}</span>
                        <span className="table-sort-header-indicator" aria-hidden="true">
                          {isSortActive
                            ? (sortDirection === "asc" ? "\u25B2" : "\u25BC")
                            : "\u00A0"}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shouldShowLoadingRow ? (
              <tr>
                <td className="table-loading-row" colSpan={loadingColSpan}>
                  <span className="history-loading-indicator" role="status" aria-live="polite">
                    <span className="history-loading-spinner" aria-hidden="true" />
                    Loading monster records...
                  </span>
                </td>
              </tr>
            ) : null}
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
                onOffsetSubmitByEnter={onOffsetSubmitByEnter}
                onTrackLeftClick={onTrackLeftClick}
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

      {isStatsModalOpen ? (
        <ModalBackdrop onClose={handleCloseStatsModal}>
          <section
            className="modal stats-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stats-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="stats-modal-header">
              <h3 id="stats-modal-title">Stats</h3>
              <button type="button" className="stats-modal-close-btn" onClick={handleCloseStatsModal}>
                Close
              </button>
            </div>
            <div className="stats-modal-controls">
              <div className="stats-modal-tab-group" role="tablist" aria-label="Stats views">
                {STATS_VIEW_TABS.map((tab) => {
                  const isActive = activeStatsView === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`stats-modal-tab${isActive ? " is-active" : ""}`}
                      onClick={() => setActiveStatsView(tab)}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
              <div className="stats-modal-range-group" aria-label="Stats time range">
                {STATS_TIME_RANGE_OPTIONS.map((timeRange) => {
                  const isActive = activeStatsTimeRange === timeRange;
                  return (
                    <button
                      key={timeRange}
                      type="button"
                      className={`stats-modal-range-btn stats-modal-time-range-btn${isActive ? " is-active" : ""}`}
                      aria-pressed={isActive}
                      onClick={() => setActiveStatsTimeRange(timeRange)}
                    >
                      {timeRange}
                    </button>
                  );
                })}
                <span className="stats-modal-range-separator" aria-hidden="true" />
                <button
                  type="button"
                  className={`stats-modal-range-btn stats-excludes-toggle-btn${
                    isStatsExcludesOpen ? " is-active" : ""
                  }`}
                  onClick={handleStatsExcludesToggle}
                  aria-expanded={isStatsExcludesOpen}
                  aria-controls="stats-excludes-panel"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      d="M3 5h18l-7 8v6l-4 2v-8L3 5z"
                      fill="currentColor"
                    />
                  </svg>
                  <span>Excludes</span>
                </button>
              </div>
            </div>
            {isStatsExcludesOpen ? (
              <section className="stats-excludes-panel" id="stats-excludes-panel" aria-label="Stats excludes">
                <form className="stats-excludes-form" onSubmit={handleStatsExcludeMonsterSubmit}>
                  <label className="stats-excludes-field">
                    <span>Monster</span>
                    <div className="stats-excludes-autocomplete">
                      <input
                        ref={statsExcludeMonsterInputRef}
                        type="text"
                        value={statsExcludeMonsterInput}
                        onChange={handleStatsExcludeMonsterInputChange}
                        onFocus={handleStatsExcludeMonsterInputFocus}
                        onBlur={handleStatsExcludeMonsterInputBlur}
                        style={statsExcludeMonsterInputStyle}
                        placeholder="Select or type monster name"
                      />
                      {isStatsMonsterSuggestionsOpen ? (
                        <div className="stats-excludes-suggestions" role="listbox" aria-label="Monster suggestions">
                          {filteredStatsMonsterSuggestions.length > 0 ? (
                            filteredStatsMonsterSuggestions.map((suggestion) => (
                              <button
                                key={suggestion.name}
                                type="button"
                                role="option"
                                aria-selected={statsExcludeMonsterInput.trim() === suggestion.name}
                                className="stats-excludes-suggestion-option"
                                data-suggestion-name={suggestion.name}
                                onMouseDown={handleStatsMonsterSuggestionMouseDown}
                                style={suggestion.color ? { color: suggestion.color } : undefined}
                              >
                                {suggestion.name}
                              </button>
                            ))
                          ) : (
                            <p className="stats-excludes-suggestion-empty">No matching monsters.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </label>
                  <button type="submit" className="stats-excludes-submit-btn">
                    Exclude Monster
                  </button>
                </form>
                {statsExcludeMonsterError ? (
                  <p className="stats-excludes-error" role="alert">
                    {statsExcludeMonsterError}
                  </p>
                ) : null}
                <div className="stats-excludes-table-wrap">
                  <table className="stats-excludes-table">
                    <thead>
                      <tr>
                        <th scope="col">Monster</th>
                      </tr>
                    </thead>
                    <tbody>
                      {excludedMonsterNames.length > 0 ? (
                        excludedMonsterNames.map((monsterName) => (
                          <tr key={monsterName}>
                            <td>
                              <div className="stats-excludes-monster-cell">
                                <span>{monsterName}</span>
                                <button
                                  type="button"
                                  className="stats-excludes-delete-btn"
                                  onClick={() => {
                                    void handleStatsExcludedMonsterDelete(monsterName);
                                  }}
                                  aria-label={`Delete excluded monster ${monsterName}`}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                    <path
                                      d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2h4v2H4V6h4l1-2z"
                                      fill="currentColor"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="stats-excludes-empty-row">No excluded monsters yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {shouldShowStatsInitialLoading ? (
              <div className="stats-overview">
                <section className="stats-loading-gate" role="status" aria-live="polite">
                  <div className="stats-loading-gate-orb" aria-hidden="true" />
                  <div className="stats-loading-gate-headline">
                    <span className="stats-loading-gate-spinner" aria-hidden="true" />
                    <span>Building stats from history</span>
                    <span className="stats-loading-gate-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </div>
                  <p className="stats-loading-gate-subtitle">
                    Initial sync can take longer on large history datasets.
                  </p>
                  <div className="stats-loading-gate-skeleton-grid" aria-hidden="true">
                    <div className="stats-loading-gate-skeleton-card">
                      <span className="stats-loading-gate-skeleton-line is-short" />
                      <span className="stats-loading-gate-skeleton-line is-long" />
                      <span className="stats-loading-gate-skeleton-line is-medium" />
                    </div>
                    <div className="stats-loading-gate-skeleton-card">
                      <span className="stats-loading-gate-skeleton-line is-short" />
                      <span className="stats-loading-gate-skeleton-line is-long" />
                      <span className="stats-loading-gate-skeleton-line is-medium" />
                    </div>
                    <div className="stats-loading-gate-skeleton-card">
                      <span className="stats-loading-gate-skeleton-line is-short" />
                      <span className="stats-loading-gate-skeleton-line is-long" />
                      <span className="stats-loading-gate-skeleton-line is-medium" />
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
            {activeStatsView === "Overview" && !shouldShowStatsInitialLoading ? (
              <div className="stats-overview">
                <div className="stats-overview-row stats-overview-row-three">
                  <section className="stats-overview-card" aria-label="Total Tracks in selected range">
                    <h4>{`Total Tracks (${activeStatsTimeRange})`}</h4>
                    <p className="stats-overview-value">
                      {formatStatsLargeNumber(statsOverviewState.totalTracksRange)}
                    </p>
                  </section>
                  <section className="stats-overview-card" aria-label="Total Tracks across all time">
                    <h4>Total Tracks (All time)</h4>
                    <p className="stats-overview-value">
                      {formatStatsLargeNumber(statsOverviewState.totalTracksAllTime)}
                    </p>
                  </section>
                  <section className="stats-overview-card" aria-label="Most Active Monster">
                    <h4>Most Active Monster</h4>
                    {statsOverviewState.mostActiveMonster ? (
                      <p className="stats-overview-value stats-most-active-monster">
                        <span
                          className="stats-most-active-monster-name"
                          style={statsMostActiveMonsterColor ? { color: statsMostActiveMonsterColor } : undefined}
                        >
                          {statsOverviewState.mostActiveMonster.name}
                        </span>
                        <span className="stats-most-active-monster-count">
                          {formatStatsLargeNumber(statsOverviewState.mostActiveMonster.count)}
                        </span>
                      </p>
                    ) : (
                      <p className="stats-overview-value stats-overview-empty">No tracks in range.</p>
                    )}
                  </section>
                </div>
                <div className="stats-overview-row stats-overview-row-two">
                  <section className="stats-overview-card" aria-label="Tracks Per Day">
                    <h4>Tracks Per Day</h4>
                    {statsShouldShowTracksPerDay ? (
                      statsOverviewState.tracksPerDay.length > 0 ? (
                        <div className="stats-overview-list-wrap">
                          <table className="stats-overview-list-table">
                            <thead>
                              <tr>
                                <th scope="col">Day</th>
                                <th scope="col">Tracks</th>
                              </tr>
                            </thead>
                            <tbody>
                              {statsOverviewState.tracksPerDay.map((entry) => (
                                <tr key={entry.day}>
                                  <td>{formatStatsDayLabel(entry.day)}</td>
                                  <td>{formatStatsLargeNumber(entry.count)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="stats-overview-empty">No tracks in range.</p>
                      )
                    ) : (
                      <p className="stats-overview-empty">Available for This Week, This Month, and All Time.</p>
                    )}
                  </section>
                  <section className="stats-overview-card" aria-label="User Ranking">
                    <h4>User Ranking</h4>
                    {statsOverviewState.topUsers.length > 0 ? (
                      <div className="stats-overview-list-wrap">
                        <table className="stats-overview-list-table stats-user-ranking-table">
                          <thead>
                            <tr>
                              <th scope="col">Place</th>
                              <th scope="col">User</th>
                              <th scope="col">Tracks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.topUsers.map((entry, index) => {
                              const rank = index + 1;
                              const isTopThree = rank <= 3;
                              const placeClassName = [
                                "stats-user-ranking-place",
                                isTopThree ? "is-top-three" : "",
                                rank === 1 ? "is-top-1" : "",
                                rank === 2 ? "is-top-2" : "",
                                rank === 3 ? "is-top-3" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");
                              return (
                                <tr key={`${entry.uid ?? "unknown"}:${entry.nickname}`}>
                                  <td>
                                    <span className={placeClassName}>
                                      {formatStatsRankingPlace(rank)}
                                    </span>
                                  </td>
                                  <td>{entry.nickname}</td>
                                  <td>{formatStatsLargeNumber(entry.count)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No tracked users in range.</p>
                    )}
                  </section>
                </div>
                <div className="stats-overview-row stats-overview-row-single">
                  <section
                    className="stats-overview-card stats-distribution-card"
                    aria-label={`Track Distribution of ${activeStatsTimeRange}`}
                  >
                    <h4>Track Distribution of {activeStatsTimeRange}</h4>
                    {statsOverviewState.distribution.days.length > 0 ? (
                      <>
                        <StatsDistributionChart
                          data={statsOverviewState.distribution}
                          formatNumber={formatStatsLargeNumber}
                          formatBucketAxisLabel={formatStatsDistributionAxisLabel}
                          formatBucketTooltipLabel={formatStatsDistributionTooltipLabel}
                        />
                        <div className="stats-distribution-footer">
                          <span>
                            Total: {formatStatsLargeNumber(statsOverviewState.distribution.summary.totalAllDays)}
                          </span>
                          <span>
                            Avg: {formatStatsDecimalValue(statsOverviewState.distribution.summary.avgPerDay)}
                          </span>
                          <span>
                            Max: {formatStatsLargeNumber(statsOverviewState.distribution.summary.maxDayTotal)}
                          </span>
                          <span>
                            Active Users: {formatStatsLargeNumber(statsOverviewState.distribution.summary.activeUsers)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="stats-overview-empty">No tracks in range.</p>
                    )}
                  </section>
                </div>
                {statsOverviewLoadStatus === "loading" ? (
                  <p className="stats-overview-status" role="status">
                    Refreshing overview...
                  </p>
                ) : null}
                {statsOverviewError ? (
                  <p className="stats-overview-status stats-overview-status-error" role="alert">
                    {statsOverviewError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {activeStatsView === "Users" && !shouldShowStatsInitialLoading ? (
              <div className="stats-users">
                <div className="stats-users-row stats-users-row-three">
                  <section className="stats-overview-card" aria-label={`Leaderboard for ${activeStatsTimeRange}`}>
                    <h4>Leaderboards</h4>
                    {statsOverviewState.users.leaderboard.length > 0 ? (
                      <div className="stats-overview-list-wrap">
                        <table className="stats-overview-list-table stats-user-ranking-table">
                          <thead>
                            <tr>
                              <th scope="col">Place</th>
                              <th scope="col">User</th>
                              <th scope="col">Tracks</th>
                              <th scope="col">Share %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.users.leaderboard.map((entry, index) => {
                              const rank = index + 1;
                              const isTopThree = rank <= 3;
                              const placeClassName = [
                                "stats-user-ranking-place",
                                isTopThree ? "is-top-three" : "",
                                rank === 1 ? "is-top-1" : "",
                                rank === 2 ? "is-top-2" : "",
                                rank === 3 ? "is-top-3" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");
                              return (
                                <tr key={`leaderboard:${entry.uid ?? "unknown"}:${entry.nickname}`}>
                                  <td>
                                    <span className={placeClassName}>{formatStatsRankingPlace(rank)}</span>
                                  </td>
                                  <td>{entry.nickname}</td>
                                  <td>{formatStatsLargeNumber(entry.count)}</td>
                                  <td>{formatStatsPercent(entry.sharePercent)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No tracked users in range.</p>
                    )}
                  </section>

                  <section className="stats-overview-card" aria-label={`Most tracks in a day for ${activeStatsTimeRange}`}>
                    <h4>Most Tracks in a Day</h4>
                    {statsOverviewState.users.mostTracksInDay.length > 0 ? (
                      <div className="stats-overview-list-wrap">
                        <table className="stats-overview-list-table">
                          <thead>
                            <tr>
                              <th scope="col">User</th>
                              <th scope="col">Day</th>
                              <th scope="col">Tracked</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.users.mostTracksInDay.map((entry) => (
                              <tr key={`most-tracks-day:${entry.uid ?? "unknown"}:${entry.nickname}`}>
                                <td>{entry.nickname}</td>
                                <td>{formatStatsDayLabel(entry.day)}</td>
                                <td>{formatStatsLargeNumber(entry.count)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No tracked monster activity in range.</p>
                    )}
                  </section>

                  <section
                    className="stats-overview-card"
                    aria-label={`Longest streak in hours for ${activeStatsTimeRange}`}
                  >
                    <h4>Longest Streak</h4>
                    {statsOverviewState.users.longestStreakHours.length > 0 ? (
                      <div className="stats-overview-list-wrap">
                        <table className="stats-overview-list-table">
                          <thead>
                            <tr>
                              <th scope="col">User</th>
                              <th scope="col">Longest Streak (hrs)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.users.longestStreakHours.map((entry) => (
                              <tr key={`streak:${entry.uid ?? "unknown"}:${entry.nickname}`}>
                                <td>{entry.nickname}</td>
                                <td>{formatStatsLargeNumber(entry.hours)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No streak activity in range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-users-row stats-users-row-single">
                  <section className="stats-overview-card" aria-label={`Additional per user stats for ${activeStatsTimeRange}`}>
                    <h4>Additional per user stats</h4>
                    {statsOverviewState.users.additionalStats.length > 0 ? (
                      <div className="stats-overview-list-wrap stats-users-wide-table-wrap">
                        <table className="stats-overview-list-table stats-users-wide-table">
                          <thead>
                            <tr>
                              <th scope="col">User</th>
                              <th scope="col">Least Favorite Monster</th>
                              <th scope="col">Top Monster Tracked</th>
                              <th scope="col"># Set Exacts</th>
                              <th scope="col"># Edits Done</th>
                              <th scope="col">Times Reset</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.users.additionalStats.map((entry) => {
                              const leastFavoriteMonsterColor = entry.leastFavoriteMonster
                                ? getStatsMonsterNameColor(entry.leastFavoriteMonster.name)
                                : undefined;
                              const topMonsterTracked = topMonsterTrackedByUser.get(
                                getStatsUserLookupKey(entry.uid, entry.nickname)
                              );
                              const topMonsterTrackedColor = topMonsterTracked
                                ? getStatsMonsterNameColor(topMonsterTracked.monsterName)
                                : undefined;
                              return (
                                <tr key={`extra:${entry.uid ?? "unknown"}:${entry.nickname}`}>
                                  <td>{entry.nickname}</td>
                                  <td>
                                    {entry.leastFavoriteMonster ? (
                                      <>
                                        <span
                                          style={
                                            leastFavoriteMonsterColor
                                              ? { color: leastFavoriteMonsterColor }
                                              : undefined
                                          }
                                        >
                                          {entry.leastFavoriteMonster.name}
                                        </span>{" "}
                                        ({formatStatsLargeNumber(entry.leastFavoriteMonster.count)})
                                      </>
                                    ) : (
                                      "N/A"
                                    )}
                                  </td>
                                  <td>
                                    {topMonsterTracked ? (
                                      <>
                                        <span
                                          style={
                                            topMonsterTrackedColor
                                              ? { color: topMonsterTrackedColor }
                                              : undefined
                                          }
                                        >
                                          {topMonsterTracked.monsterName}
                                        </span>{" "}
                                        ({formatStatsLargeNumber(topMonsterTracked.count)})
                                      </>
                                    ) : (
                                      "N/A"
                                    )}
                                  </td>
                                  <td>{formatStatsLargeNumber(entry.setExacts)}</td>
                                  <td>{formatStatsLargeNumber(entry.editsDone)}</td>
                                  <td>{formatStatsLargeNumber(entry.timesReset)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No user activity in range.</p>
                    )}
                  </section>
                </div>

                {statsOverviewLoadStatus === "loading" ? (
                  <p className="stats-overview-status" role="status">
                    Refreshing user stats...
                  </p>
                ) : null}
                {statsOverviewError ? (
                  <p className="stats-overview-status stats-overview-status-error" role="alert">
                    {statsOverviewError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {activeStatsView === "Monsters" && !shouldShowStatsInitialLoading ? (
              <div className="stats-monsters">
                <div className="stats-monsters-row stats-monsters-row-single">
                  <section className="stats-overview-card stats-monster-distribution-card" aria-label="Monster Pie Chart Distribution">
                    <h4>Monster Pie Chart Distribution</h4>
                    <div className="stats-monster-metric-toggle-group" role="tablist" aria-label="Monster distribution metric">
                      {STATS_MONSTER_METRIC_OPTIONS.map((option) => {
                        const isActive = activeStatsMonsterMetric === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`stats-modal-range-btn stats-monster-metric-btn${isActive ? " is-active" : ""}`}
                            onClick={() => setActiveStatsMonsterMetric(option.key)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    {statsMonsterPieData.length > 0 ? (
                      <StatsMonsterPieChart
                        data={statsMonsterPieData}
                        metricLabel={activeStatsMonsterMetricLabel}
                        formatNumber={formatStatsLargeNumber}
                      />
                    ) : (
                      <p className="stats-overview-empty">No monster activity in range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-monsters-row stats-monsters-row-single">
                  <section className="stats-overview-card" aria-label={`Individual Monster Stats for ${activeStatsTimeRange}`}>
                    <h4>Individual Monster Stats</h4>
                    {statsMonsterRows.length > 0 ? (
                      <div className="stats-overview-list-wrap stats-monsters-table-wrap">
                        <table className="stats-overview-list-table stats-monsters-table">
                          <thead>
                            <tr>
                              <th scope="col">Name</th>
                              <th scope="col">Times Tracked</th>
                              <th scope="col">{`Avg. T. Tracked ${activeStatsTimeRange}`}</th>
                              <th scope="col">Times Edit Offset</th>
                              <th scope="col">{`Avg. T. Edit Offset ${activeStatsTimeRange}`}</th>
                              <th scope="col">Times Set Exact</th>
                              <th scope="col">{`Avg. T. Set Exact ${activeStatsTimeRange}`}</th>
                              <th scope="col">Most Tracked by</th>
                              <th scope="col">Least Tracked by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsMonsterRows.map((entry) => (
                              <tr key={`monster-stats:${entry.monsterName}`}>
                                <td>
                                  <span style={entry.color ? { color: entry.color } : undefined}>{entry.monsterName}</span>
                                </td>
                                <td>{formatStatsLargeNumber(entry.trackedCount)}</td>
                                <td>
                                  {formatStatsDecimalValue(
                                    entry.trackedCount / statsMonsterAverageRangeDays
                                  )}
                                </td>
                                <td>{formatStatsLargeNumber(entry.editOffsetCount)}</td>
                                <td>
                                  {formatStatsDecimalValue(
                                    entry.editOffsetCount / statsMonsterAverageRangeDays
                                  )}
                                </td>
                                <td>{formatStatsLargeNumber(entry.setExactCount)}</td>
                                <td>
                                  {formatStatsDecimalValue(
                                    entry.setExactCount / statsMonsterAverageRangeDays
                                  )}
                                </td>
                                <td>
                                  {entry.mostKilledBy.length > 0
                                    ? entry.mostKilledBy
                                        .map(
                                          (person) =>
                                            `${person.nickname} (${formatStatsLargeNumber(person.count)})`
                                        )
                                        .join(", ")
                                    : "N/A"}
                                </td>
                                <td>
                                  {entry.leastKilledBy.length > 0
                                    ? entry.leastKilledBy
                                        .map(
                                          (person) =>
                                            `${person.nickname} (${formatStatsLargeNumber(person.count)})`
                                        )
                                        .join(", ")
                                    : "N/A"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No monsters available in this range.</p>
                    )}
                  </section>
                </div>

                {statsOverviewLoadStatus === "loading" ? (
                  <p className="stats-overview-status" role="status">
                    Refreshing monster stats...
                  </p>
                ) : null}
                {statsOverviewError ? (
                  <p className="stats-overview-status stats-overview-status-error" role="alert">
                    {statsOverviewError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {activeStatsView === "Time & Trends" && !shouldShowStatsInitialLoading ? (
              <div className="stats-time-trends">
                <div className="stats-time-trends-row stats-time-trends-row-two">
                  <section className="stats-overview-card" aria-label={`Track volume trend for ${activeStatsTimeRange}`}>
                    <h4 title="Tracks Tracked Monster event volume per time bucket and overlays a moving average to reveal peaks and slumps.">
                      Track Volume Trend
                    </h4>
                    {statsTimeTrendBucketKeys.length > 0 ? (
                      <>
                        <StatsTrendLineChart
                          ariaLabel="Tracked monster volume trend with moving average"
                          buckets={statsTimeTrendBucketKeys}
                          series={statsTrackVolumeSeries}
                          formatNumber={formatStatsLargeNumber}
                          formatBucketAxisLabel={formatStatsDistributionAxisLabel}
                          formatBucketTooltipLabel={formatStatsDistributionTooltipLabel}
                        />
                        <p className="stats-overview-empty">Window: {statsTrackVolumeMovingAverageLabel}</p>
                      </>
                    ) : (
                      <p className="stats-overview-empty">No tracked monster activity in range.</p>
                    )}
                  </section>
                  <section className="stats-overview-card" aria-label={`Active tracker trend for ${activeStatsTimeRange}`}>
                    <h4 title="Tracks unique tracker users (tracked_by_uid) per bucket to show real participation over time.">
                      Active Tracker Trend
                    </h4>
                    {statsTimeTrendBucketKeys.length > 0 ? (
                      <StatsTrendLineChart
                        ariaLabel="Active unique trackers over time"
                        buckets={statsTimeTrendBucketKeys}
                        series={statsActiveTrackerSeries}
                        formatNumber={formatStatsLargeNumber}
                        formatBucketAxisLabel={formatStatsDistributionAxisLabel}
                        formatBucketTooltipLabel={formatStatsDistributionTooltipLabel}
                      />
                    ) : (
                      <p className="stats-overview-empty">No tracked monster activity in range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-time-trends-row stats-time-trends-row-two">
                  <section className="stats-overview-card" aria-label={`Action mix trend for ${activeStatsTimeRange}`}>
                    <h4 title="Shows stacked counts over time for Tracked Monster, Edit Offset, Set Exact Spawn, Edit Last Killed, and Reset All Timers.">
                      Action Mix Over Time
                    </h4>
                    {statsTimeTrendBucketKeys.length > 0 ? (
                      <StatsStackedTrendChart
                        ariaLabel="Stacked trend of tracked and timer correction actions"
                        buckets={statsTimeTrendBucketKeys}
                        series={statsActionMixSeries}
                        formatNumber={formatStatsLargeNumber}
                        formatBucketAxisLabel={formatStatsDistributionAxisLabel}
                        formatBucketTooltipLabel={formatStatsDistributionTooltipLabel}
                      />
                    ) : (
                      <p className="stats-overview-empty">No action activity in range.</p>
                    )}
                  </section>
                  <section className="stats-overview-card" aria-label={`Timer correction rate trend for ${activeStatsTimeRange}`}>
                    <h4 title="Shows (Edit Offset + Set Exact Spawn + Edit Last Killed) divided by Tracked Monster per bucket as a timer stability signal.">
                      Timer Correction Rate
                    </h4>
                    {statsTimeTrendBucketKeys.length > 0 ? (
                      <>
                        <StatsTrendLineChart
                          ariaLabel="Timer correction rate percentage over time"
                          buckets={statsTimeTrendBucketKeys}
                          series={statsCorrectionRateSeries}
                          formatNumber={(value) => `${formatStatsDecimalValue(value)}%`}
                          formatBucketAxisLabel={formatStatsDistributionAxisLabel}
                          formatBucketTooltipLabel={formatStatsDistributionTooltipLabel}
                        />
                        <p className="stats-overview-empty">
                          Avg rate: {formatStatsDecimalValue(statsAverageCorrectionRate)}%
                        </p>
                      </>
                    ) : (
                      <p className="stats-overview-empty">No correction data in range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-time-trends-row stats-time-trends-row-single">
                  <section className="stats-overview-card" aria-label={`Monster momentum for ${activeStatsTimeRange}`}>
                    <h4 title="Compares each monster's current-period tracked count against the previous equal window, including delta and percent change.">
                      Monster Momentum
                    </h4>
                    {statsOverviewState.timeTrends.monsterMomentum.length > 0 ? (
                      <div className="stats-overview-list-wrap">
                        <table className="stats-overview-list-table stats-time-trends-table">
                          <thead>
                            <tr>
                              <th scope="col">Monster</th>
                              <th scope="col">Current</th>
                              <th scope="col">Previous</th>
                              <th scope="col">Delta</th>
                              <th scope="col">Delta %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.timeTrends.monsterMomentum.map((entry) => {
                              const monsterColor = getStatsMonsterNameColor(entry.monsterName);
                              const deltaClassName =
                                entry.delta > 0
                                  ? "stats-time-trends-delta is-positive"
                                  : entry.delta < 0
                                    ? "stats-time-trends-delta is-negative"
                                    : "stats-time-trends-delta";
                              return (
                                <tr key={`momentum:${entry.monsterName}`}>
                                  <td>
                                    <span style={monsterColor ? { color: monsterColor } : undefined}>
                                      {entry.monsterName}
                                    </span>
                                  </td>
                                  <td>{formatStatsLargeNumber(entry.currentTracks)}</td>
                                  <td>{formatStatsLargeNumber(entry.previousTracks)}</td>
                                  <td>
                                    <span className={deltaClassName}>{formatStatsSignedNumber(entry.delta)}</span>
                                  </td>
                                  <td>
                                    <span className={deltaClassName}>
                                      {formatStatsSignedPercent(entry.deltaPercent)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No momentum data for this range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-time-trends-row stats-time-trends-row-single">
                  <section className="stats-overview-card" aria-label={`Hour of week heatmap for ${activeStatsTimeRange}`}>
                    <h4 title="Shows Tracked Monster counts by day of week and hour of day to highlight the best online windows.">
                      Hour-of-Week Heatmap
                    </h4>
                    {statsOverviewState.timeTrends.hourOfWeekHeatmap.length > 0 ? (
                      <StatsHourOfWeekHeatmap
                        ariaLabel="Tracked monster counts by day of week and hour"
                        cells={statsOverviewState.timeTrends.hourOfWeekHeatmap}
                        formatNumber={formatStatsLargeNumber}
                      />
                    ) : (
                      <p className="stats-overview-empty">No tracked activity in range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-time-trends-row stats-time-trends-row-single">
                  <section className="stats-overview-card" aria-label={`Handoff rate by monster for ${activeStatsTimeRange}`}>
                    <h4 title="Shows each monster's percentage of consecutive tracked events where the tracker changed user, indicating coordination and load sharing.">
                      Handoff Rate
                    </h4>
                    {statsOverviewState.timeTrends.handoffRates.length > 0 ? (
                      <div className="stats-overview-list-wrap">
                        <table className="stats-overview-list-table stats-time-trends-table">
                          <thead>
                            <tr>
                              <th scope="col">Monster</th>
                              <th scope="col">Handoffs</th>
                              <th scope="col">Comparable Transitions</th>
                              <th scope="col">Handoff Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsOverviewState.timeTrends.handoffRates.map((entry) => {
                              const monsterColor = getStatsMonsterNameColor(entry.monsterName);
                              return (
                                <tr key={`handoff:${entry.monsterName}`}>
                                  <td>
                                    <span style={monsterColor ? { color: monsterColor } : undefined}>
                                      {entry.monsterName}
                                    </span>
                                  </td>
                                  <td>{formatStatsLargeNumber(entry.handoffCount)}</td>
                                  <td>{formatStatsLargeNumber(entry.comparableTransitions)}</td>
                                  <td>{formatStatsDecimalValue(entry.handoffRatePercent)}%</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No handoff transitions in range.</p>
                    )}
                  </section>
                </div>

                {statsOverviewLoadStatus === "loading" ? (
                  <p className="stats-overview-status" role="status">
                    Refreshing time trend stats...
                  </p>
                ) : null}
                {statsOverviewError ? (
                  <p className="stats-overview-status stats-overview-status-error" role="alert">
                    {statsOverviewError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {activeStatsView === "Categories" && !shouldShowStatsInitialLoading ? (
              <div className="stats-categories">
                <div className="stats-monsters-row stats-monsters-row-single">
                  <section className="stats-overview-card stats-monster-distribution-card" aria-label="Category Distribution">
                    <h4>Category Distribution</h4>
                    <div className="stats-monster-metric-toggle-group" role="tablist" aria-label="Category distribution metric">
                      {STATS_MONSTER_METRIC_OPTIONS.map((option) => {
                        const isActive = activeStatsCategoryMetric === option.key;
                        return (
                          <button
                            key={`category-metric:${option.key}`}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            className={`stats-modal-range-btn stats-monster-metric-btn${isActive ? " is-active" : ""}`}
                            onClick={() => setActiveStatsCategoryMetric(option.key)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    {statsCategoryPieData.length > 0 ? (
                      <StatsMonsterPieChart
                        data={statsCategoryPieData}
                        metricLabel={activeStatsCategoryMetricLabel}
                        formatNumber={formatStatsLargeNumber}
                      />
                    ) : (
                      <p className="stats-overview-empty">No category activity in range.</p>
                    )}
                  </section>
                </div>

                <div className="stats-monsters-row stats-monsters-row-single">
                  <section className="stats-overview-card" aria-label={`Category Stats for ${activeStatsTimeRange}`}>
                    <h4>Category Stats</h4>
                    {statsCategoryRows.length > 0 ? (
                      <div className="stats-overview-list-wrap stats-monsters-table-wrap">
                        <table className="stats-overview-list-table stats-monsters-table stats-categories-table">
                          <thead>
                            <tr>
                              <th scope="col">Name</th>
                              <th scope="col">Total Tracks</th>
                              <th scope="col">Total Edit Offset</th>
                              <th scope="col">Total Set Exact</th>
                              <th scope="col">Most Tracked</th>
                              <th scope="col">Least Tracked</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statsCategoryRows.map((entry) => (
                              <tr key={`category-stats:${entry.categoryKey}`}>
                                <td>
                                  <span
                                    className={`stats-category-name${entry.isUncategorized ? " is-uncategorized" : ""}`}
                                    style={!entry.isUncategorized ? { color: entry.color } : undefined}
                                  >
                                    {entry.categoryName}
                                  </span>
                                </td>
                                <td>{formatStatsLargeNumber(entry.trackedCount)}</td>
                                <td>{formatStatsLargeNumber(entry.editOffsetCount)}</td>
                                <td>{formatStatsLargeNumber(entry.setExactCount)}</td>
                                <td>
                                  {entry.mostTracked.length > 0
                                    ? entry.mostTracked.map((monster, index) => (
                                        <span key={`category-most:${entry.categoryKey}:${monster.monsterName}`}>
                                          {index > 0 ? ", " : ""}
                                          <span style={monster.color ? { color: monster.color } : undefined}>
                                            {monster.monsterName}
                                          </span>{" "}
                                          ({formatStatsLargeNumber(monster.count)})
                                        </span>
                                      ))
                                    : "N/A"}
                                </td>
                                <td>
                                  {entry.leastTracked.length > 0
                                    ? entry.leastTracked.map((monster, index) => (
                                        <span key={`category-least:${entry.categoryKey}:${monster.monsterName}`}>
                                          {index > 0 ? ", " : ""}
                                          <span style={monster.color ? { color: monster.color } : undefined}>
                                            {monster.monsterName}
                                          </span>{" "}
                                          ({formatStatsLargeNumber(monster.count)})
                                        </span>
                                      ))
                                    : "N/A"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="stats-overview-empty">No categories available in this range.</p>
                    )}
                  </section>
                </div>

                {statsOverviewLoadStatus === "loading" ? (
                  <p className="stats-overview-status" role="status">
                    Refreshing category stats...
                  </p>
                ) : null}
                {statsOverviewError ? (
                  <p className="stats-overview-status stats-overview-status-error" role="alert">
                    {statsOverviewError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        </ModalBackdrop>
      ) : null}
    </>
  );
});
