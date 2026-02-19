import { useEffect, useState } from "react";

export function WindowTitleBar() {
  const controls = window.electronAPI?.windowControls;
  const getAppVersion = window.electronAPI?.getAppVersion;
  const getTitleBarIcon = window.electronAPI?.getTitleBarIcon;
  const [isMaximized, setIsMaximized] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [titleBarIconSrc, setTitleBarIconSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!controls) {
      return;
    }

    let isMounted = true;
    void controls
      .isMaximized()
      .then((value) => {
        if (isMounted) {
          setIsMaximized(value);
        }
      })
      .catch(() => {});

    const unsubscribe = controls.onMaximizedStateChange(setIsMaximized);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [controls]);

  useEffect(() => {
    if (!getAppVersion) {
      return;
    }

    let isMounted = true;
    void getAppVersion()
      .then((version) => {
        if (isMounted) {
          setAppVersion(version);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [getAppVersion]);

  useEffect(() => {
    if (!getTitleBarIcon) {
      return;
    }

    let isMounted = true;
    void getTitleBarIcon()
      .then((iconSrc) => {
        if (isMounted) {
          setTitleBarIconSrc(iconSrc);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [getTitleBarIcon]);

  if (!controls) {
    return null;
  }

  return (
    <header className="window-titlebar">
      <div className="window-titlebar-drag-region">
        <div className="window-titlebar-meta">
          {titleBarIconSrc ? (
            <img
              className="window-titlebar-icon"
              src={titleBarIconSrc}
              alt="MVP Tracker"
            />
          ) : null}
          <span className="window-titlebar-version">v{appVersion || "..."}</span>
        </div>
      </div>
      <div className="window-titlebar-controls">
        <button
          type="button"
          className="window-titlebar-btn"
          aria-label="Minimize window"
          onClick={controls.minimize}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2 6.5h8" />
          </svg>
        </button>
        <button
          type="button"
          className="window-titlebar-btn"
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
          onClick={controls.toggleMaximize}
        >
          {isMaximized ? (
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <rect x="4" y="2" width="6" height="6" />
              <rect x="2" y="4" width="6" height="6" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <rect x="2" y="2" width="8" height="8" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="window-titlebar-btn window-titlebar-btn-close"
          aria-label="Close window"
          onClick={controls.close}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
          </svg>
        </button>
      </div>
    </header>
  );
}
