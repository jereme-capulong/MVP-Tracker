import { useCallback, useEffect, useRef, useState } from "react";

export const LOCK_DURATION_MS = 1000;

type UseInteractionLockOptions = {
  sortedIds: string[];
  liveIds: string[];
};

type UseInteractionLockResult = {
  isInteractionLocked: boolean;
  lockedOrderIds: string[];
  activeInteractionMonsterId: string | null;
  persistentLockForTopCard: boolean;
  triggerInteractionLock: (
    sortedIdsOverride?: string[],
    options?: {
      mode?: "auto" | "persistentTopCard";
      activeInteractionMonsterId?: string | null;
    }
  ) => void;
  releaseInteractionLock: () => void;
};

export function useInteractionLock({
  sortedIds,
  liveIds,
}: UseInteractionLockOptions): UseInteractionLockResult {
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  const [lockedOrderIds, setLockedOrderIds] = useState<string[]>([]);
  const [activeInteractionMonsterId, setActiveInteractionMonsterId] = useState<string | null>(null);
  const [persistentLockForTopCard, setPersistentLockForTopCard] = useState(false);
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

  const clearInteractionTimeout = useCallback(() => {
    if (interactionTimeoutRef.current !== null) {
      clearTimeout(interactionTimeoutRef.current);
      interactionTimeoutRef.current = null;
    }
  }, []);

  const releaseInteractionLock = useCallback(() => {
    clearInteractionTimeout();
    setPersistentLockForTopCard(false);
    setActiveInteractionMonsterId(null);
    setIsInteractionLocked(false);
  }, [clearInteractionTimeout]);

  const triggerInteractionLock = useCallback((
    sortedIdsOverride?: string[],
    options?: {
      mode?: "auto" | "persistentTopCard";
      activeInteractionMonsterId?: string | null;
    }
  ) => {
    setIsInteractionLocked((previous) => {
      if (!previous) {
        setLockedOrderIds(sortedIdsOverride ?? sortedIdsRef.current);
      }
      return true;
    });

    if (options?.activeInteractionMonsterId !== undefined) {
      setActiveInteractionMonsterId(options.activeInteractionMonsterId);
    } else if (options?.mode !== "persistentTopCard") {
      setActiveInteractionMonsterId(null);
    }

    if (options?.mode === "persistentTopCard") {
      clearInteractionTimeout();
      setPersistentLockForTopCard(true);
      return;
    }

    setPersistentLockForTopCard(false);
    clearInteractionTimeout();
    interactionTimeoutRef.current = setTimeout(() => {
      setPersistentLockForTopCard(false);
      setActiveInteractionMonsterId(null);
      setIsInteractionLocked(false);
      interactionTimeoutRef.current = null;
    }, LOCK_DURATION_MS);
  }, [clearInteractionTimeout]);

  useEffect(() => {
    if (!persistentLockForTopCard || !activeInteractionMonsterId) {
      return;
    }

    if (!liveIds.includes(activeInteractionMonsterId)) {
      releaseInteractionLock();
    }
  }, [activeInteractionMonsterId, liveIds, persistentLockForTopCard, releaseInteractionLock]);

  useEffect(() => {
    return () => {
      clearInteractionTimeout();
    };
  }, [clearInteractionTimeout]);

  return {
    isInteractionLocked,
    lockedOrderIds,
    activeInteractionMonsterId,
    persistentLockForTopCard,
    triggerInteractionLock,
    releaseInteractionLock,
  };
}
