import { memo, useEffect, useRef } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Monster } from "../types";
import { calculateNextSpawn, calculateTimeRemaining, shouldTriggerReady } from "../utils/time";
import { playReadyBeep } from "../utils/sound";

type ReadyNotificationManagerProps = {
  monsters: Monster[];
  soundEnabled: boolean;
  onMarkReadyNotified: (ids: string[]) => void;
};

export const ReadyNotificationManager = memo(function ReadyNotificationManager({
  monsters,
  soundEnabled,
  onMarkReadyNotified,
}: ReadyNotificationManagerProps) {
  const nowMs = useGlobalNow();
  const previousRemainingByIdRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const previousRemainingById = previousRemainingByIdRef.current;
    const activeIds = new Set<string>();
    const triggeredIds: string[] = [];

    for (const monster of monsters) {
      activeIds.add(monster.id);
      const currentRemaining = calculateTimeRemaining(calculateNextSpawn(monster), nowMs);
      const previousRemaining = previousRemainingById.get(monster.id);

      if (
        previousRemaining !== undefined &&
        !monster.hasNotifiedReady &&
        shouldTriggerReady(previousRemaining, currentRemaining)
      ) {
        triggeredIds.push(monster.id);
      }

      previousRemainingById.set(monster.id, currentRemaining);
    }

    for (const id of Array.from(previousRemainingById.keys())) {
      if (!activeIds.has(id)) {
        previousRemainingById.delete(id);
      }
    }

    if (triggeredIds.length === 0) {
      return;
    }

    if (soundEnabled) {
      triggeredIds.forEach((_, index) => {
        window.setTimeout(() => {
          playReadyBeep();
        }, index * 170);
      });
    }

    onMarkReadyNotified(triggeredIds);
  }, [monsters, nowMs, onMarkReadyNotified, soundEnabled]);

  return null;
});
