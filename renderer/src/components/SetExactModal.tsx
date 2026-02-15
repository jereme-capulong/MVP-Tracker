import { FormEvent, memo, useEffect, useState } from "react";

type SetExactModalProps = {
  isOpen: boolean;
  monsterName: string;
  onCancel: () => void;
  onConfirm: (hours: number, minutes: number) => void;
};

function parseNonNegativeInt(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export const SetExactModal = memo(function SetExactModal({
  isOpen,
  monsterName,
  onCancel,
  onConfirm,
}: SetExactModalProps) {
  const [hoursInput, setHoursInput] = useState("0");
  const [minutesInput, setMinutesInput] = useState("0");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setHoursInput("0");
    setMinutesInput("0");
  }, [isOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const parsedHours = parseNonNegativeInt(hoursInput);
    const parsedMinutes = parseNonNegativeInt(minutesInput);
    const normalizedTotalMinutes = parsedHours * 60 + parsedMinutes;
    const normalizedHours = Math.floor(normalizedTotalMinutes / 60);
    const normalizedMinutes = normalizedTotalMinutes % 60;

    setHoursInput(String(normalizedHours));
    setMinutesInput(String(normalizedMinutes));
    onConfirm(normalizedHours, normalizedMinutes);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-exact-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="set-exact-modal-title">Set Exact Respawn Time</h3>
        <p className="set-exact-modal-subtitle">{monsterName}</p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="set-exact-input-row">
            <label className="set-exact-input-field" htmlFor="set-exact-hours">
              <span>Hours</span>
              <input
                id="set-exact-hours"
                type="number"
                min={0}
                step={1}
                value={hoursInput}
                onChange={(event) => setHoursInput(event.target.value)}
              />
            </label>

            <label className="set-exact-input-field" htmlFor="set-exact-minutes">
              <span>Minutes</span>
              <input
                id="set-exact-minutes"
                type="number"
                min={0}
                step={1}
                value={minutesInput}
                onChange={(event) => setMinutesInput(event.target.value)}
              />
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Confirm</button>
          </div>
        </form>
      </section>
    </div>
  );
});
