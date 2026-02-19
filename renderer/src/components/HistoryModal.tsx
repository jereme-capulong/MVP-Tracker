import { memo } from "react";
import { MonsterHistoryEntry } from "../types";
import { formatDateTime } from "../utils/time";
import { ModalBackdrop } from "./ModalBackdrop";

type HistoryModalProps = {
  isOpen: boolean;
  entries: MonsterHistoryEntry[];
  onClose: () => void;
};

function renderValueCell(value: string): string {
  const trimmed = value.trim();
  return trimmed || "-";
}

export const HistoryModal = memo(function HistoryModal({ isOpen, entries, onClose }: HistoryModalProps) {
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
        <h3 id="history-modal-title">Edit History</h3>
        <p className="history-modal-subtitle">Recent monster changes across all users.</p>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Name</th>
                <th scope="col">Monster Name</th>
                <th scope="col">Action</th>
                <th scope="col">Previous Value</th>
                <th scope="col">Current Value</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td className="history-empty-row" colSpan={6}>
                    No history entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.timestampIso)}</td>
                    <td>{entry.userNickname}</td>
                    <td>{entry.monsterName}</td>
                    <td>{entry.action}</td>
                    <td>{renderValueCell(entry.previousValue)}</td>
                    <td>{renderValueCell(entry.currentValue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
