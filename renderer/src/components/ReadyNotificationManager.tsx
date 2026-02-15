import { memo, useEffect, useRef } from "react";
import { useGlobalNow } from "../hooks/useGlobalNow";
import { Monster } from "../types";
import { AlertSettings } from "../utils/settings";
import { calculateNextSpawn, calculateTimeRemaining, shouldTriggerReady } from "../utils/time";
import { queueReadyAlert } from "../utils/sound";

type ReadyNotificationManagerProps = {
  monsters: Monster[];
  soundEnabled: boolean;
  alertSettings: AlertSettings;
  onMarkReadyNotified: (ids: string[]) => void;
};

export const ReadyNotificationManager = memo(function ReadyNotificationManager({
  monsters,
  soundEnabled,
  alertSettings,
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
      queueReadyAlert(alertSettings, triggeredIds.length);
    }

    onMarkReadyNotified(triggeredIds);
  }, [alertSettings, monsters, nowMs, onMarkReadyNotified, soundEnabled]);

  return null;
});
