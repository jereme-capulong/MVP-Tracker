import { FormEvent, KeyboardEvent as ReactKeyboardEvent, memo, useEffect, useRef, useState } from "react";
import { ModalBackdrop } from "./ModalBackdrop";

type SetExactModalProps = {
  isOpen: boolean;
  monsterName: string;
  onCancel: () => void;
  onConfirm: (hours: number, minutes: number) => void;
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
  const [showValidation, setShowValidation] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const parsedHours = parseIntInRange(hoursInput, 0, 23);
  const parsedMinutes = parseIntInRange(minutesInput, 0, 59);
  const isValid = parsedHours !== null && parsedMinutes !== null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setHoursInput("0");
    setMinutesInput("0");
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
    onConfirm(parsedHours, parsedMinutes);
  }

  function handleDurationInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    formRef.current?.requestSubmit();
  }

  if (!isOpen) {
    return null;
  }

  return (
    <ModalBackdrop onClose={onCancel}>
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
        <p id="set-exact-modal-description">Set next spawn to now plus this duration.</p>
        <form ref={formRef} className="modal-form" onSubmit={handleSubmit}>
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
                onKeyDown={handleDurationInputKeyDown}
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
                onKeyDown={handleDurationInputKeyDown}
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
    </ModalBackdrop>
  );
});
