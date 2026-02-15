import { useCallback, useEffect, useRef, useState } from "react";

export const LOCK_DURATION_MS = 1000;

type UseInteractionLockOptions = {
  sortedIds: string[];
  liveIds: string[];
};

type UseInteractionLockResult = {
  isInteractionLocked: boolean;
  lockedOrderIds: string[];
  triggerInteractionLock: (sortedIdsOverride?: string[]) => void;
};

export function useInteractionLock({
  sortedIds,
  liveIds,
}: UseInteractionLockOptions): UseInteractionLockResult {
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  const [lockedOrderIds, setLockedOrderIds] = useState<string[]>([]);
  const interactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortedIdsRef = useRef(sortedIds);

  useEffect(() => {
    sortedIdsRef.current = sortedIds;
  }, [sortedIds]);

  useEffect(() => {
    if (!isInteractionLocked) {
      return;
    }

    const liveIdSet = new Set(liveIds);
    setLockedOrderIds((previous) => {
      const next = previous.filter((id) => liveIdSet.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [isInteractionLocked, liveIds]);

  const triggerInteractionLock = useCallback((sortedIdsOverride?: string[]) => {
    setIsInteractionLocked((previous) => {
      if (!previous) {
        setLockedOrderIds(sortedIdsOverride ?? sortedIdsRef.current);
      }
      return true;
    });

    if (interactionTimeoutRef.current !== null) {
      clearTimeout(interactionTimeoutRef.current);
    }

    interactionTimeoutRef.current = setTimeout(() => {
      setIsInteractionLocked(false);
    }, LOCK_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (interactionTimeoutRef.current !== null) {
        clearTimeout(interactionTimeoutRef.current);
      }
    };
  }, []);

  return {
    isInteractionLocked,
    lockedOrderIds,
    triggerInteractionLock,
  };
}
