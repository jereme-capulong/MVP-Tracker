import { FormEvent, memo, useEffect, useState } from "react";
import { Monster, MonsterEditInput } from "../types";
import {
  isoToLocalInputValue,
  localInputValueToIso,
  OffsetSign,
  offsetPartsToSeconds,
  offsetSecondsToParts,
} from "../utils/time";

type EditMonsterModalProps = {
  isOpen: boolean;
  monster: Monster | null;
  onClose: () => void;
  onSave: (input: MonsterEditInput) => void;
};

export const EditMonsterModal = memo(function EditMonsterModal({
  isOpen,
  monster,
  onClose,
  onSave,
}: EditMonsterModalProps) {
  const [name, setName] = useState("");
  const [respawnMinutes, setRespawnMinutes] = useState(30);
  const [lastKilledLocal, setLastKilledLocal] = useState("");
  const [offsetSign, setOffsetSign] = useState<OffsetSign>(1);
  const [offsetHours, setOffsetHours] = useState(0);
  const [offsetMinutes, setOffsetMinutes] = useState(0);

  useEffect(() => {
    if (!monster || !isOpen) {
      return;
    }
    const parts = offsetSecondsToParts(monster.offsetSeconds ?? 0);
    setName(monster.name);
    setRespawnMinutes(Math.max(1, Math.round(monster.respawnDuration / 60)));
    setLastKilledLocal(isoToLocalInputValue(monster.lastKilledTimestamp));
    setOffsetSign(parts.sign);
    setOffsetHours(parts.hours);
    setOffsetMinutes(parts.minutes);
  }, [monster, isOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!monster || !name.trim() || respawnMinutes <= 0 || !lastKilledLocal) {
      return;
    }

    onSave({
      id: monster.id,
      name: name.trim(),
      respawnDurationMinutes: Math.max(1, Math.trunc(respawnMinutes)),
      lastKilledTimestamp: localInputValueToIso(lastKilledLocal),
      offsetSeconds: offsetPartsToSeconds(offsetSign, offsetHours, offsetMinutes),
      categoryId: monster.categoryId,
    });
    onClose();
  }

  if (!isOpen || !monster) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-monster-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="edit-monster-title">Edit Monster</h3>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="edit-monster-name">Name</label>
            <input
              id="edit-monster-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
            />
          </div>

          <div className="form-row">
            <label htmlFor="edit-respawn-minutes">Respawn (minutes)</label>
            <input
              id="edit-respawn-minutes"
              type="number"
              min={1}
              value={respawnMinutes}
              onChange={(event) => setRespawnMinutes(Number(event.target.value))}
              required
            />
          </div>

          <div className="form-row">
            <label htmlFor="edit-last-killed">Last killed</label>
            <input
              id="edit-last-killed"
              type="datetime-local"
              step={60}
              value={lastKilledLocal}
              onChange={(event) => setLastKilledLocal(event.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <label>Offset</label>
            <div className="offset-group">
              <select
                aria-label="Offset sign"
                value={offsetSign}
                onChange={(event) => setOffsetSign(Number(event.target.value) < 0 ? -1 : 1)}
              >
                <option value={1}>+</option>
                <option value={-1}>-</option>
              </select>
              <input
                aria-label="Offset hours"
                type="number"
                min={0}
                value={offsetHours}
                onChange={(event) => setOffsetHours(Number(event.target.value))}
              />
              <span className="offset-separator">h</span>
              <input
                aria-label="Offset minutes"
                type="number"
                min={0}
                max={59}
                value={offsetMinutes}
                onChange={(event) => setOffsetMinutes(Number(event.target.value))}
              />
              <span className="offset-separator">m</span>
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">Save Changes</button>
          </div>
        </form>
      </section>
    </div>
  );
});
