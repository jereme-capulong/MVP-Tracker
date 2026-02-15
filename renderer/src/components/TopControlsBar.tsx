import { memo } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { SoundToggle } from "./SoundToggle";

type TopControlsBarProps = {
  hasMonsters: boolean;
  soundEnabled: boolean;
  compactMode: boolean;
  onToggleSound: () => void;
  onToggleCompactMode: () => void;
  onResetAll: () => void;
  onClearAll: () => void;
  onImportCsv: () => void;
};

export const TopControlsBar = memo(function TopControlsBar({
  hasMonsters,
  soundEnabled,
  compactMode,
  onToggleSound,
  onToggleCompactMode,
  onResetAll,
  onClearAll,
  onImportCsv,
}: TopControlsBarProps) {
  const nowMs = useGlobalNow();

  return (
    <div className="top-controls">
      <div className="clock">{new Date(nowMs).toLocaleTimeString()}</div>
      <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
      <label className={`compact-toggle ${compactMode ? "enabled" : ""}`}>
        <input type="checkbox" checked={compactMode} onChange={onToggleCompactMode} />
        <span>Compact Mode</span>
      </label>
      <button type="button" onClick={onImportCsv}>
        Import CSV
      </button>
      <button type="button" onClick={onResetAll} disabled={!hasMonsters}>
        Reset All
      </button>
      <button type="button" className="danger-btn" onClick={onClearAll} disabled={!hasMonsters}>
        Delete All
      </button>
    </div>
  );
});
