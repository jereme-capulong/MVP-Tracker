import { ChangeEvent, FormEvent, memo, useCallback, useState } from "react";
import { MonsterInput } from "../types";
import { localInputValueToIso, nowAsLocalInputValue } from "../utils/time";

type AddMonsterFormProps = {
  onCreate: (input: MonsterInput) => void;
};

export const AddMonsterForm = memo(function AddMonsterForm({ onCreate }: AddMonsterFormProps) {
  const [name, setName] = useState("");
  const [respawnHoursInput, setRespawnHoursInput] = useState("0");
  const [respawnMinutesInput, setRespawnMinutesInput] = useState("30");
  const [lastKilledLocal, setLastKilledLocal] = useState(nowAsLocalInputValue());

  const parseNonNegativeInteger = useCallback((value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-" || trimmed === "+") {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }, []);

  const normalizeRespawnInputs = useCallback(
    (hoursRaw: string, minutesRaw: string) => {
      const parsedHours = parseNonNegativeInteger(hoursRaw) ?? 0;
      const parsedMinutes = parseNonNegativeInteger(minutesRaw) ?? 0;
      const totalMinutes = Math.max(1, parsedHours * 60 + parsedMinutes);
      const normalizedHours = Math.floor(totalMinutes / 60);
      const normalizedMinutes = totalMinutes % 60;

      return {
        normalizedHours,
        normalizedMinutes,
        totalMinutes,
      };
    },
    [parseNonNegativeInteger]
  );

  const commitRespawnInputs = useCallback(() => {
    const { normalizedHours, normalizedMinutes } = normalizeRespawnInputs(
      respawnHoursInput,
      respawnMinutesInput
    );
    setRespawnHoursInput(String(normalizedHours));
    setRespawnMinutesInput(String(normalizedMinutes));
  }, [normalizeRespawnInputs, respawnHoursInput, respawnMinutesInput]);

  const handleRespawnHoursChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRespawnHoursInput(event.target.value);
  }, []);

  const handleRespawnMinutesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRespawnMinutesInput(event.target.value);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const { totalMinutes } = normalizeRespawnInputs(
      respawnHoursInput,
      respawnMinutesInput
    );

    if (!name.trim() || totalMinutes <= 0) {
      return;
    }

    onCreate({
      name,
      respawnDurationMinutes: totalMinutes,
      lastKilledTimestamp: localInputValueToIso(lastKilledLocal),
    });

    setName("");
    setRespawnHoursInput("0");
    setRespawnMinutesInput("30");
    setLastKilledLocal(nowAsLocalInputValue());
  }

  return (
    <form className="panel add-form" onSubmit={handleSubmit}>
      <h2>Add Monster</h2>
      <div className="form-row">
        <label htmlFor="monster-name">Name</label>
        <input
          id="monster-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Monster name"
          maxLength={80}
          required
        />
      </div>

      <div className="form-row">
        <label>Respawn (hours/minutes)</label>
        <div className="inline-offset-group">
          <input
            id="respawn-hours"
            className="table-input table-num inline-offset-input"
            type="number"
            min={0}
            value={respawnHoursInput}
            onChange={handleRespawnHoursChange}
            onBlur={commitRespawnInputs}
            required
          />
          <span className="offset-separator">h</span>
          <input
            id="respawn-minutes"
            className="table-input table-num inline-offset-input"
            type="number"
            min={0}
            value={respawnMinutesInput}
            onChange={handleRespawnMinutesChange}
            onBlur={commitRespawnInputs}
            required
          />
          <span className="offset-separator">m</span>
        </div>
      </div>

      <div className="form-row">
        <label htmlFor="last-killed">Last killed</label>
        <input
          id="last-killed"
          type="datetime-local"
          step={60}
          value={lastKilledLocal}
          onChange={(event) => setLastKilledLocal(event.target.value)}
          required
        />
      </div>

      <button type="submit">Save Monster</button>
    </form>
  );
});
