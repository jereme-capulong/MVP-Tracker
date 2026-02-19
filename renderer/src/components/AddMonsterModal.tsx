import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import { Category } from "../types";
import { ModalBackdrop } from "./ModalBackdrop";

type AddMonsterModalProps = {
  isOpen: boolean;
  categories: Category[];
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    respawnDurationSeconds: number;
    categoryId: string | null;
  }) => Promise<boolean>;
};

function parseNonNegativeInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export const AddMonsterModal = memo(function AddMonsterModal({
  isOpen,
  categories,
  onCancel,
  onCreate,
}: AddMonsterModalProps) {
  const [name, setName] = useState("");
  const [hoursInput, setHoursInput] = useState("0");
  const [minutesInput, setMinutesInput] = useState("30");
  const [categoryIdInput, setCategoryIdInput] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const parsedHours = useMemo(() => parseNonNegativeInteger(hoursInput), [hoursInput]);
  const parsedMinutes = useMemo(() => parseNonNegativeInteger(minutesInput), [minutesInput]);
  const totalSeconds = useMemo(() => {
    if (parsedHours === null || parsedMinutes === null) {
      return 0;
    }
    return parsedHours * 3600 + parsedMinutes * 60;
  }, [parsedHours, parsedMinutes]);
  const selectedCategoryColor = useMemo(() => {
    if (!categoryIdInput) {
      return undefined;
    }
    return categories.find((category) => category.id === categoryIdInput)?.color;
  }, [categories, categoryIdInput]);
  const isValid = name.trim().length > 0 && parsedHours !== null && parsedMinutes !== null && totalSeconds > 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName("");
    setHoursInput("0");
    setMinutesInput("30");
    setCategoryIdInput("");
    setShowValidation(false);
    setIsSaving(false);
  }, [isOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isValid || isSaving) {
      setShowValidation(true);
      return;
    }

    setIsSaving(true);
    const created = await onCreate({
      name: name.trim(),
      respawnDurationSeconds: totalSeconds,
      categoryId: categoryIdInput || null,
    });
    setIsSaving(false);

    if (created) {
      onCancel();
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <ModalBackdrop onClose={onCancel}>
      <section
        className="modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-monster-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="add-monster-modal-title">Add Monster</h3>
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="form-row" htmlFor="add-monster-name">
            <span>Name</span>
            <input
              id="add-monster-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              autoFocus
            />
          </label>

          <label className="form-row" htmlFor="add-monster-hours">
            <span>Respawn Duration</span>
            <div className="inline-offset-group">
              <input
                id="add-monster-hours"
                className="table-input table-num inline-offset-input"
                type="number"
                min={0}
                step={1}
                value={hoursInput}
                aria-invalid={showValidation && parsedHours === null}
                onChange={(event) => {
                  setHoursInput(event.target.value);
                  if (showValidation) {
                    setShowValidation(false);
                  }
                }}
              />
              <span className="offset-separator">h</span>
              <input
                id="add-monster-minutes"
                className="table-input table-num inline-offset-input"
                type="number"
                min={0}
                step={1}
                value={minutesInput}
                aria-invalid={showValidation && parsedMinutes === null}
                onChange={(event) => {
                  setMinutesInput(event.target.value);
                  if (showValidation) {
                    setShowValidation(false);
                  }
                }}
              />
              <span className="offset-separator">m</span>
            </div>
          </label>

          <label className="form-row" htmlFor="add-monster-category">
            <span>Category</span>
            <select
              id="add-monster-category"
              value={categoryIdInput}
              onChange={(event) => setCategoryIdInput(event.target.value)}
              style={selectedCategoryColor ? { color: selectedCategoryColor } : undefined}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id} style={{ color: category.color }}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          {showValidation && !isValid ? (
            <p className="set-exact-validation" role="alert">
              Name is required and respawn must be at least 1 minute.
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" onClick={onCancel} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving}>
              Add Monster
            </button>
          </div>
        </form>
      </section>
    </ModalBackdrop>
  );
});
