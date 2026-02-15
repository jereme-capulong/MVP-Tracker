let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    return null;
  }
  if (!audioContext) {
    audioContext = new window.AudioContext();
  }
  return audioContext;
}

export function playReadyBeep(): void {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  if (context.state === "suspended") {
    void context.resume();
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 740;
  gainNode.gain.value = 0.03;

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  const startAt = context.currentTime;
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.15);
}
