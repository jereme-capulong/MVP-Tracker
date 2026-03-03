import { useSyncExternalStore } from "react";

let nowMs = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
let isLifecycleBound = false;

function notifyListeners(): void {
  nowMs = Date.now();
  listeners.forEach((listener) => listener());
}

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible";
}

function shouldTickerRun(): boolean {
  return listeners.size > 0 && isDocumentVisible();
}

function startTicker(): void {
  if (intervalId !== null) {
    return;
  }

  // Single global 1-second ticker shared by the whole UI.
  intervalId = setInterval(() => {
    notifyListeners();
  }, 1000);
}

function stopTicker(): void {
  if (intervalId === null) {
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
}

function syncTickerState(): void {
  if (shouldTickerRun()) {
    startTicker();
    return;
  }
  stopTicker();
}

function handleLifecycleChange(): void {
  syncTickerState();
  if (listeners.size > 0 && isDocumentVisible()) {
    notifyListeners();
  }
}

function bindLifecycleListeners(): void {
  if (isLifecycleBound || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  window.addEventListener("focus", handleLifecycleChange);
  window.addEventListener("blur", handleLifecycleChange);
  document.addEventListener("visibilitychange", handleLifecycleChange);
  isLifecycleBound = true;
}

function unbindLifecycleListenersIfIdle(): void {
  if (!isLifecycleBound || listeners.size > 0 || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  window.removeEventListener("focus", handleLifecycleChange);
  window.removeEventListener("blur", handleLifecycleChange);
  document.removeEventListener("visibilitychange", handleLifecycleChange);
  isLifecycleBound = false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  bindLifecycleListeners();
  syncTickerState();

  return () => {
    listeners.delete(listener);
    syncTickerState();
    unbindLifecycleListenersIfIdle();
  };
}

function getSnapshot(): number {
  return nowMs;
}

export function useGlobalNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
