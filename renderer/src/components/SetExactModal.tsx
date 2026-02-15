import { FormEvent, memo, useEffect, useState } from "react";
import { SetExactMode } from "../types";

type SetExactModalProps = {
  isOpen: boolean;
  monsterName: string;
  onCancel: () => void;
  onConfirm: (hours: number, minutes: number, mode: SetExactMode) => void;
};

function parseIntInRange(value: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
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
  const [mode, setMode] = useState<SetExactMode>("exactTilNext");
  const [showValidation, setShowValidation] = useState(false);

  const parsedHours = parseIntInRange(hoursInput, 0, 23);
  const parsedMinutes = parseIntInRange(minutesInput, 0, 59);
  const isValid = parsedHours !== null && parsedMinutes !== null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setHoursInput("0");
    setMinutesInput("0");
    setMode("exactTilNext");
    setShowValidation(false);
  }, [isOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (parsedHours === null || parsedMinutes === null) {
      setShowValidation(true);
      return;
    }

    setHoursInput(String(parsedHours));
    setMinutesInput(String(parsedMinutes));
    onConfirm(parsedHours, parsedMinutes, mode);
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
        aria-describedby="set-exact-modal-description"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="set-exact-modal-title">Set Exact Respawn Time</h3>
        <p className="set-exact-modal-subtitle">{monsterName}</p>
        <p id="set-exact-modal-description">
          {mode === "exactRespawn"
            ? "Set next spawn to a local clock time."
            : "Set next spawn to now plus this duration."}
        </p>
        <form className="modal-form" onSubmit={handleSubmit}>
          <fieldset className="set-exact-mode-group" aria-label="Set Mode">
            <legend>Set Mode</legend>
            <label htmlFor="set-exact-mode-til-next">
              <input
                id="set-exact-mode-til-next"
                type="radio"
                name="set-exact-mode"
                value="exactTilNext"
                checked={mode === "exactTilNext"}
                aria-label="Exact Til Next"
                onChange={() => setMode("exactTilNext")}
              />
              <span>Exact Til Next</span>
            </label>
            <label htmlFor="set-exact-mode-respawn">
              <input
                id="set-exact-mode-respawn"
                type="radio"
                name="set-exact-mode"
                value="exactRespawn"
                checked={mode === "exactRespawn"}
                aria-label="Exact Respawn"
                onChange={() => setMode("exactRespawn")}
              />
              <span>Exact Respawn</span>
            </label>
          </fieldset>

          <div className="set-exact-input-row">
            <label className="set-exact-input-field" htmlFor="set-exact-hours">
              <span>Hours</span>
              <input
                id="set-exact-hours"
                type="number"
                min={0}
                max={23}
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
            </label>

            <label className="set-exact-input-field" htmlFor="set-exact-minutes">
              <span>Minutes</span>
              <input
                id="set-exact-minutes"
                type="number"
                min={0}
                max={59}
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
            </label>
          </div>
          {showValidation && !isValid ? (
            <p className="set-exact-validation" role="alert">
              Hours must be 0-23 and minutes must be 0-59.
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Set Exact</button>
          </div>
        </form>
      </section>
    </div>
  );
});
