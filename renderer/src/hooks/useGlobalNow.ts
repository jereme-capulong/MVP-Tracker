import { useSyncExternalStore } from "react";

let nowMs = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function startTicker(): void {
  if (intervalId !== null) {
    return;
  }

  // Single global 1-second ticker shared by the whole UI.
  intervalId = setInterval(() => {
    nowMs = Date.now();
    listeners.forEach((listener) => listener());
  }, 1000);
}

function stopTickerIfIdle(): void {
  if (listeners.size > 0 || intervalId === null) {
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startTicker();

  return () => {
    listeners.delete(listener);
    stopTickerIfIdle();
  };
}

function getSnapshot(): number {
  return nowMs;
}

export function useGlobalNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
