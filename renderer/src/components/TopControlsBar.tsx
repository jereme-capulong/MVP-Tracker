import { memo, useEffect, useRef, useState } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { SoundToggle } from "./SoundToggle";

type TopControlsBarProps = {
  hasMonsters: boolean;
  soundEnabled: boolean;
  onOpenSettings: () => void;
  onToggleSound: () => void;
  onResetAll: () => void;
  onClearAll: () => void;
  onImportCsv: () => void;
  onImportClipboard: () => void;
};

export const TopControlsBar = memo(function TopControlsBar({
  hasMonsters,
  soundEnabled,
  onOpenSettings,
  onToggleSound,
  onResetAll,
  onClearAll,
  onImportCsv,
  onImportClipboard,
}: TopControlsBarProps) {
  const nowMs = useGlobalNow();
  const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isImportMenuOpen) {
      return;
    }

    const handleWindowMouseDown = (event: MouseEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) {
        setIsImportMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handleWindowMouseDown);
    return () => {
      window.removeEventListener("mousedown", handleWindowMouseDown);
    };
  }, [isImportMenuOpen]);

  return (
    <div className="top-controls">
      <div className="clock">{new Date(nowMs).toLocaleTimeString()}</div>
      <button type="button" className="icon-btn settings-btn" aria-label="Settings" onClick={onOpenSettings}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M19.14 12.94a7.87 7.87 0 0 0 .05-.94 7.87 7.87 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.28 7.28 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.87 7.87 0 0 0-.05.94c0 .32.02.63.05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
            fill="currentColor"
          />
        </svg>
      </button>
      <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
      <div className="import-menu" ref={importMenuRef}>
        <button
          type="button"
          className="import-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={isImportMenuOpen}
          onClick={() => setIsImportMenuOpen((previous) => !previous)}
        >
          Import
        </button>
        {isImportMenuOpen ? (
          <div className="import-menu-popover" role="menu" aria-label="Import Options">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsImportMenuOpen(false);
                onImportCsv();
              }}
            >
              Import CSV
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsImportMenuOpen(false);
                onImportClipboard();
              }}
            >
              Import from Clipboard
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={onResetAll} disabled={!hasMonsters}>
        Reset All
      </button>
      <button type="button" className="danger-btn" onClick={onClearAll} disabled={!hasMonsters}>
        Delete All
      </button>
    </div>
  );
});
