let audioContext: AudioContext | null = null;
let lastPlayTime = 0;

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function getAudioSettings() {
  try {
    const raw = localStorage.getItem('ureedxdchat_audio_settings')
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

/** Play the default two-tone chime */
function playDefaultSound(ctx: AudioContext, startTime: number): void {
  playTone(ctx, 880, startTime, 0.1);
  playTone(ctx, 1100, startTime + 0.1, 0.1);
}

/** Play a custom notification sound from a data URL */
function playCustomSound(dataUrl: string, ctx: AudioContext): void {
  // Decode and play the audio buffer
  const audio = new Audio(dataUrl)
  const settings = getAudioSettings()
  if (settings?.outputDeviceId) {
    (audio as any).setSinkId(settings.outputDeviceId).catch(() => {})
  }
  audio.volume = (settings?.outputVolume ?? 100) / 100
  audio.play().catch(() => {})
}

export function playNotificationSound(): void {
  const now = Date.now();
  if (now - lastPlayTime < 1000) return;
  lastPlayTime = now;

  const settings = getAudioSettings()
  const customSound = settings?.messageNotifSound

  if (customSound) {
    playCustomSound(customSound, getAudioContext());
    return;
  }

  // Default sound
  const ctx = getAudioContext();
  const startTime = ctx.currentTime;
  playDefaultSound(ctx, startTime);
}

export function playCallNotificationSound(): void {
  const settings = getAudioSettings()
  const customSound = settings?.callNotifSound

  if (customSound) {
    playCustomSound(customSound, getAudioContext());
    return;
  }

  // Default call ring: repeating tone
  const ctx = getAudioContext();
  const startTime = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    playTone(ctx, 600, startTime + i * 0.4, 0.15);
    playTone(ctx, 800, startTime + i * 0.4 + 0.15, 0.15);
  }
}