import { memo, useCallback, useEffect, useState } from "react";
import {
  Category,
  type HistoryFilters,
  type HistorySort,
  type HistorySortColumn,
  Monster,
  MonsterHistoryEntry,
  TrackedByUser,
} from "../types";
import { formatDateTime } from "../utils/time";
import { ModalBackdrop } from "./ModalBackdrop";

type HistoryModalProps = {
  isOpen: boolean;
  isLoading: boolean;
  entries: MonsterHistoryEntry[];
  sort: HistorySort;
  currentPage: number;
  hasNextPage: boolean;
  totalEntries: number;
  filters: HistoryFilters;
  trackedByUserMap: Map<string, TrackedByUser>;
  monsterById: Map<string, Monster>;
  categoryMap: Map<string, Category>;
  onSortChange: (nextSort: HistorySort) => void;
  onFiltersChange: (nextFilters: HistoryFilters) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onClose: () => void;
};

const UTC_TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g;
const ROW_HEIGHT_PX = 36;
const RESERVED_MODAL_HEIGHT_PX = 260;
const MIN_ROWS_PER_PAGE = 5;
const FILTER_INPUT_DEBOUNCE_MS = 300;

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

function computeRowsPerPageByViewport(): number {
  if (typeof window === "undefined") {
    return 12;
  }

  const visibleTableHeight = window.innerHeight - RESERVED_MODAL_HEIGHT_PX;
  const rows = Math.floor(visibleTableHeight / ROW_HEIGHT_PX);
  return Math.max(MIN_ROWS_PER_PAGE, rows);
}

function getActionDisplayLabel(action: string): string {
  return action.trim() === "Reset Timer Now" ? "Tracked Monster" : action;
}

function areHistoryFiltersEqual(left: HistoryFilters, right: HistoryFilters): boolean {
  return (
    left.name === right.name &&
    left.monsterName === right.monsterName &&
    left.action === right.action &&
    left.previousValue === right.previousValue &&
    left.currentValue === right.currentValue
  );
}

export const HistoryModal = memo(function HistoryModal({
  isOpen,
  isLoading,
  entries,
  sort,
  currentPage,
  hasNextPage,
  totalEntries,
  filters,
  trackedByUserMap,
  monsterById,
  categoryMap,
  onSortChange,
  onFiltersChange,
  onNextPage,
  onPreviousPage,
  onRowsPerPageChange,
  onClose,
}: HistoryModalProps) {
  const [draftFilters, setDraftFilters] = useState<HistoryFilters>(filters);
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    onRowsPerPageChange(rowsPerPage);
  }, [isOpen, onRowsPerPageChange, rowsPerPage]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (areHistoryFiltersEqual(draftFilters, filters)) {
      return;
    }
    setDraftFilters(filters);
  }, [filters, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (areHistoryFiltersEqual(draftFilters, filters)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onFiltersChange(draftFilters);
    }, FILTER_INPUT_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftFilters, filters, isOpen, onFiltersChange]);

  const handleSort = useCallback(
    (column: HistorySortColumn) => {
      onSortChange({
        column,
        direction:
          sort.column === column
            ? (sort.direction === "asc" ? "desc" : "asc")
            : column === "timestamp"
              ? "desc"
              : "asc",
      });
    },
    [onSortChange, sort.column, sort.direction]
  );

  const handleFilterChange = useCallback((filterKey: keyof HistoryFilters, nextValue: string) => {
    setDraftFilters((previous) => ({
      ...previous,
      [filterKey]: nextValue,
    }));
  }, []);

  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalEntries) / rowsPerPage));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const handlePreviousPage = useCallback(() => {
    onPreviousPage();
  }, [onPreviousPage]);

  const handleNextPage = useCallback(() => {
    if (!hasNextPage) {
      return;
    }
    onNextPage();
  }, [hasNextPage, onNextPage]);

  const isFiltering = Boolean(
    draftFilters.name ||
      draftFilters.monsterName ||
      draftFilters.action ||
      draftFilters.previousValue ||
      draftFilters.currentValue
  );

  const sortIndicator = useCallback(
    (column: HistorySortColumn) => {
      if (sort.column !== column) {
        return " ";
      }
      return sort.direction === "asc" ? " ^" : " v";
    },
    [sort.column, sort.direction]
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
                    New Value{sortIndicator("currentValue")}
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
                    value={draftFilters.name}
                    onChange={(event) => handleFilterChange("name", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter monster..."
                    value={draftFilters.monsterName}
                    onChange={(event) => handleFilterChange("monsterName", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter action..."
                    value={draftFilters.action}
                    onChange={(event) => handleFilterChange("action", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter previous..."
                    value={draftFilters.previousValue}
                    onChange={(event) => handleFilterChange("previousValue", event.target.value)}
                  />
                </th>
                <th scope="col">
                  <input
                    type="text"
                    className="history-filter-input"
                    placeholder="Filter current..."
                    value={draftFilters.currentValue}
                    onChange={(event) => handleFilterChange("currentValue", event.target.value)}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="history-loading-row" colSpan={6}>
                    <span className="history-loading-indicator" role="status" aria-live="polite">
                      <span className="history-loading-spinner" aria-hidden="true" />
                      Loading history entries...
                    </span>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td className="history-empty-row" colSpan={6}>
                    {isFiltering ? "No matching history entries." : "No history entries yet."}
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
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
            Showing {entries.length} on this page. Total entries: {totalEntries}.
          </span>
          <span className="history-pagination-summary">
            Page {safeCurrentPage} of {totalPages}
          </span>
          <button type="button" onClick={handlePreviousPage} disabled={currentPage <= 1 || isLoading}>
            Previous
          </button>
          <button type="button" onClick={handleNextPage} disabled={!hasNextPage || isLoading}>
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
