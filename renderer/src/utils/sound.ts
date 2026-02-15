import { AlertSettings } from "./settings";

const CUSTOM_SOUND_VOLUME = 0.2;
const ALERT_GAP_MS = 170;
const BEEP_DURATION_SECONDS = 0.15;

let audioContext: AudioContext | null = null;
let customAudio: HTMLAudioElement | null = null;
let customAudioPath: string | null = null;
let isQueueRunning = false;
const pendingAlertsQueue: AlertSettings[] = [];

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return null;
  }
  if (!audioContext) {
    audioContext = new window.AudioContext();
  }
  return audioContext;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function pathToPlayableUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) {
    return path;
  }

  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }

  return `file://${encodeURI(normalized)}`;
}

function getCustomAudio(path: string): HTMLAudioElement {
  if (customAudio && customAudioPath === path) {
    return customAudio;
  }

  if (customAudio) {
    customAudio.pause();
  }

  const audio = new Audio(pathToPlayableUrl(path));
  audio.preload = "auto";
  audio.volume = CUSTOM_SOUND_VOLUME;

  customAudio = audio;
  customAudioPath = path;
  return audio;
}

function playReadyBeep(): Promise<void> {
  return new Promise((resolve) => {
    const context = getAudioContext();
    if (!context) {
      resolve();
      return;
    }

    const startBeep = () => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = 740;
      gainNode.gain.value = 0.03;

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.onended = () => resolve();
      const startAt = context.currentTime;
      oscillator.start(startAt);
      oscillator.stop(startAt + BEEP_DURATION_SECONDS);
    };

    if (context.state === "suspended") {
      context
        .resume()
        .then(startBeep)
        .catch(() => resolve());
      return;
    }

    startBeep();
  });
}

function playCustomAlert(path: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const audio = getCustomAudio(path);
      audio.pause();
      audio.currentTime = 0;

      const cleanup = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      const onEnded = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        resolve();
      };

      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onError, { once: true });

      void audio.play().catch(() => {
        cleanup();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function playAlert(settings: AlertSettings): Promise<void> {
  if (settings.alertMode === "custom" && settings.customSoundPath) {
    await playCustomAlert(settings.customSoundPath);
    return;
  }

  await playReadyBeep();
}

async function flushPendingAlerts(): Promise<void> {
  if (isQueueRunning) {
    return;
  }

  isQueueRunning = true;
  while (pendingAlertsQueue.length > 0) {
    const nextSettings = pendingAlertsQueue.shift();
    if (!nextSettings) {
      break;
    }

    await playAlert(nextSettings);
    if (pendingAlertsQueue.length > 0) {
      await wait(ALERT_GAP_MS);
    }
  }
  isQueueRunning = false;
}

export function queueReadyAlert(settings: AlertSettings, count: number): void {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  if (safeCount <= 0) {
    return;
  }

  for (let index = 0; index < safeCount; index += 1) {
    pendingAlertsQueue.push({ ...settings });
  }

  void flushPendingAlerts();
}

export function preloadCustomAlert(path: string | null): void {
  if (!path) {
    return;
  }

  try {
    const audio = getCustomAudio(path);
    audio.load();
  } catch {
    // Ignore preload errors and gracefully fallback at playback time.
  }
}
