import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Category, Monster, MonsterHistoryEntry, TrackedByUser } from "../types";
import { formatDateTime } from "../utils/time";
import { ModalBackdrop } from "./ModalBackdrop";

type HistoryModalProps = {
  isOpen: boolean;
  entries: MonsterHistoryEntry[];
  trackedByUserMap: Map<string, TrackedByUser>;
  monsterById: Map<string, Monster>;
  categoryMap: Map<string, Category>;
  onClose: () => void;
};

type HistorySortColumn =
  | "timestamp"
  | "name"
  | "monsterName"
  | "action"
  | "previousValue"
  | "currentValue";

type HistorySortDirection = "asc" | "desc";

type HistoryFilters = {
  name: string;
  monsterName: string;
  action: string;
  previousValue: string;
  currentValue: string;
};

const UTC_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g;
const ROW_HEIGHT_PX = 36;
const RESERVED_MODAL_HEIGHT_PX = 260;
const MIN_ROWS_PER_PAGE = 5;

const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  name: "",
  monsterName: "",
  action: "",
  previousValue: "",
  currentValue: "",
};

function formatUtcTimestamp(value: string): string {
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

function renderValueCell(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }

  return trimmed.replace(UTC_TIMESTAMP_PATTERN, (match) => formatUtcTimestamp(match));
}

function getNicknameInitial(nickname: string): string {
  const trimmed = nickname.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeRowsPerPageByViewport(): number {
  if (typeof window === "undefined") {
    return 12;
  }

  const visibleTableHeight = window.innerHeight - RESERVED_MODAL_HEIGHT_PX;
  const rows = Math.floor(visibleTableHeight / ROW_HEIGHT_PX);
  return Math.max(MIN_ROWS_PER_PAGE, rows);
}

function normalizeForFilter(value: string): string {
  return value.trim().toLowerCase();
}

function getActionDisplayLabel(action: string): string {
  return action.trim() === "Reset Timer Now" ? "Tracked Monster" : action;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function getSortValue(entry: MonsterHistoryEntry, column: HistorySortColumn): string | number {
  switch (column) {
    case "timestamp":
      return Date.parse(entry.timestampIso);
    case "name":
      return entry.userNickname.trim().toLowerCase();
    case "monsterName":
      return entry.monsterName.trim().toLowerCase();
    case "action":
      return getActionDisplayLabel(entry.action).trim().toLowerCase();
    case "previousValue":
      return renderValueCell(entry.previousValue).trim().toLowerCase();
    case "currentValue":
      return renderValueCell(entry.currentValue).trim().toLowerCase();
    default:
      return "";
  }
}

export const HistoryModal = memo(function HistoryModal({
  isOpen,
  entries,
  trackedByUserMap,
  monsterById,
  categoryMap,
  onClose,
}: HistoryModalProps) {
  const [sortColumn, setSortColumn] = useState<HistorySortColumn>("timestamp");
  const [sortDirection, setSortDirection] = useState<HistorySortDirection>("desc");
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(() => computeRowsPerPageByViewport());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const recalculateRowsPerPage = () => {
      setRowsPerPage(computeRowsPerPageByViewport());
    };

    recalculateRowsPerPage();
    window.addEventListener("resize", recalculateRowsPerPage);
    return () => {
      window.removeEventListener("resize", recalculateRowsPerPage);
    };
  }, [isOpen]);

  const handleSort = useCallback((column: HistorySortColumn) => {
    setSortColumn((prevColumn) => {
      if (prevColumn === column) {
        setSortDirection((prevDirection) => (prevDirection === "asc" ? "desc" : "asc"));
        return prevColumn;
      }

      setSortDirection(column === "timestamp" ? "desc" : "asc");
      return column;
    });
  }, []);

  const handleFilterChange = useCallback(
    (filterKey: keyof HistoryFilters, nextValue: string) => {
      setFilters((prev) => ({
        ...prev,
        [filterKey]: nextValue,
      }));
      setCurrentPage(1);
    },
    []
  );

  const filteredEntries = useMemo(() => {
    const nameFilter = normalizeForFilter(filters.name);
    const monsterNameFilter = normalizeForFilter(filters.monsterName);
    const actionFilter = normalizeForFilter(filters.action);
    const previousValueFilter = normalizeForFilter(filters.previousValue);
    const currentValueFilter = normalizeForFilter(filters.currentValue);

    return entries.filter((entry) => {
      const normalizedName = entry.userNickname.trim().toLowerCase();
      const normalizedMonsterName = entry.monsterName.trim().toLowerCase();
      const normalizedAction = getActionDisplayLabel(entry.action).trim().toLowerCase();
      const normalizedPreviousValue = renderValueCell(entry.previousValue).trim().toLowerCase();
      const normalizedCurrentValue = renderValueCell(entry.currentValue).trim().toLowerCase();

      if (nameFilter && !normalizedName.includes(nameFilter)) {
        return false;
      }
      if (monsterNameFilter && !normalizedMonsterName.includes(monsterNameFilter)) {
        return false;
      }
      if (actionFilter && !normalizedAction.includes(actionFilter)) {
        return false;
      }
      if (previousValueFilter && !normalizedPreviousValue.includes(previousValueFilter)) {
        return false;
      }
      if (currentValueFilter && !normalizedCurrentValue.includes(currentValueFilter)) {
        return false;
      }

      return true;
    });
  }, [entries, filters.action, filters.currentValue, filters.monsterName, filters.name, filters.previousValue]);

  const sortedEntries = useMemo(() => {
    const directionModifier = sortDirection === "asc" ? 1 : -1;

    return [...filteredEntries].sort((leftEntry, rightEntry) => {
      const leftValue = getSortValue(leftEntry, sortColumn);
      const rightValue = getSortValue(rightEntry, sortColumn);

      let comparison = 0;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        comparison = leftValue - rightValue;
      } else {
        comparison = compareStrings(String(leftValue), String(rightValue));
      }

      if (comparison !== 0) {
        return comparison * directionModifier;
      }

      return compareStrings(rightEntry.timestampIso, leftEntry.timestampIso);
    });
  }, [filteredEntries, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedEntries.length / rowsPerPage));

  useEffect(() => {
    setCurrentPage((prevPage) => clamp(prevPage, 1, totalPages));
  }, [totalPages]);

  const paginatedEntries = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedEntries.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, sortedEntries]);

  const handlePreviousPage = useCallback(() => {
    setCurrentPage((prevPage) => Math.max(1, prevPage - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage((prevPage) => Math.min(totalPages, prevPage + 1));
  }, [totalPages]);

  const isFiltering = Boolean(
    filters.name ||
      filters.monsterName ||
      filters.action ||
      filters.previousValue ||
      filters.currentValue
  );

  const sortIndicator = useCallback(
    (column: HistorySortColumn) => {
      if (sortColumn !== column) {
        return " ";
      }
      return sortDirection === "asc" ? " ▲" : " ▼";
    },
    [sortColumn, sortDirection]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="history-modal-title">History</h3>
        <p className="history-modal-subtitle">Recent monster changes across all users.</p>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">
                  <button type="button" className="history-sort-btn" onClick={() => handleSort("timestamp")}>
                    Timestamp{sortIndicator("timestamp")}
                  </button>
                </th>
                <th scope="col">
                  <button type="button" className="history-sort-btn" onClick={() => handleSort("name")}>
                    Name{sortIndicator("name")}
                  </button>
                </th>
                <th scope="col">
                  <button type="button" className="history-sort-btn" onClick={() => handleSort("monsterName")}>
                    Monster Name{sortIndicator("monsterName")}
                  </button>
                </th>
                <th scope="col">
                  <button type="button" className="history-sort-btn" onClick={() => handleSort("action")}>
                    Action{sortIndicator("action")}
                  </button>
                </th>
                <th scope="col">
                  <button type="button" className="history-sort-btn" onClick={() => handleSort("previousValue")}>
                    Previous Value{sortIndicator("previousValue")}
                  </button>
                </th>
                <th scope="col">
                  <button type="button" className="history-sort-btn" onClick={() => handleSort("currentValue")}>
                    Current Value{sortIndicator("currentValue")}
                  </button>
                </th>
              </tr>
              <tr className="history-filter-row">
                <th scope="col" />
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter name..."
                    value={filters.name}
                    onChange={(event) => handleFilterChange("name", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter monster..."
                    value={filters.monsterName}
                    onChange={(event) => handleFilterChange("monsterName", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter action..."
                    value={filters.action}
                    onChange={(event) => handleFilterChange("action", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter previous..."
                    value={filters.previousValue}
                    onChange={(event) => handleFilterChange("previousValue", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter current..."
                    value={filters.currentValue}
                    onChange={(event) => handleFilterChange("currentValue", event.target.value)}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td className="history-empty-row" colSpan={6}>
                    No history entries yet.
                  </td>
                </tr>
              ) : paginatedEntries.length === 0 ? (
                <tr>
                  <td className="history-empty-row" colSpan={6}>
                    {isFiltering ? "No matching history entries." : "No history entries yet."}
                  </td>
                </tr>
              ) : (
                paginatedEntries.map((entry) => {
                  const trackedUser = entry.userUid ? trackedByUserMap.get(entry.userUid) : undefined;
                  const photoUrl = trackedUser?.photoURL ?? null;
                  const monster = entry.monsterId ? monsterById.get(entry.monsterId) : undefined;
                  const category = monster?.categoryId ? categoryMap.get(monster.categoryId) : undefined;

                  return (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.timestampIso)}</td>
                      <td>
                        <span className="history-user-cell">
                          {photoUrl ? (
                            <img src={photoUrl} alt="" className="history-user-avatar" />
                          ) : (
                            <span className="history-user-avatar history-user-avatar-fallback" aria-hidden="true">
                              {getNicknameInitial(entry.userNickname)}
                            </span>
                          )}
                          <span className="history-user-name" title={entry.userNickname}>
                            {entry.userNickname}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span
                          className="history-monster-name"
                          style={category ? { color: category.color } : undefined}
                          title={entry.monsterName}
                        >
                          {entry.monsterName}
                        </span>
                      </td>
                      <td>{getActionDisplayLabel(entry.action)}</td>
                      <td>{renderValueCell(entry.previousValue)}</td>
                      <td>{renderValueCell(entry.currentValue)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="history-pagination">
          <span className="history-pagination-summary">
            Showing {paginatedEntries.length} of {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}.
          </span>
          <span className="history-pagination-summary">
            Page {currentPage} of {totalPages}
          </span>
          <button type="button" onClick={handlePreviousPage} disabled={currentPage <= 1}>
            Previous
          </button>
          <button type="button" onClick={handleNextPage} disabled={currentPage >= totalPages}>
            Next
          </button>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
});
