import { memo } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { ViewMode } from "../utils/time";
import { SoundToggle } from "./SoundToggle";

type TopControlsBarProps = {
  hasMonsters: boolean;
  soundEnabled: boolean;
  viewMode: ViewMode;
  onToggleSound: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  onResetAll: () => void;
  onClearAll: () => void;
  onImportCsv: () => void;
};

export const TopControlsBar = memo(function TopControlsBar({
  hasMonsters,
  soundEnabled,
  viewMode,
  onToggleSound,
  onViewModeChange,
  onResetAll,
  onClearAll,
  onImportCsv,
}: TopControlsBarProps) {
  const nowMs = useGlobalNow();

  return (
    <div className="top-controls">
      <div className="clock">{new Date(nowMs).toLocaleTimeString()}</div>
      <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
      <div className="view-mode-toggle" role="group" aria-label="View Mode">
        <span>View Mode</span>
        <button
          type="button"
          className={viewMode === "wide" ? "active" : undefined}
          onClick={() => onViewModeChange("wide")}
          aria-pressed={viewMode === "wide"}
        >
          Wide
        </button>
        <button
          type="button"
          className={viewMode === "portrait" ? "active" : undefined}
          onClick={() => onViewModeChange("portrait")}
          aria-pressed={viewMode === "portrait"}
        >
          Portrait
        </button>
      </div>
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
