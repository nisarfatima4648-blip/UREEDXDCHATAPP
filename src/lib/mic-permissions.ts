// ─── Microphone Permission Helper ───────────────────────────────────────────
// Handles media device permissions cleanly and degrades gracefully.

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * Check if the browser supports microphone access.
 */
export function isMicSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia;
}

/**
 * Check the current microphone permission state without prompting.
 * Returns 'unsupported' if the Permissions API isn't available.
 */
export async function getMicPermission(): Promise<MicPermissionState> {
  if (!isMicSupported()) return 'unsupported';

  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state as MicPermissionState;
  } catch {
    // Permissions API not supported (e.g. iOS Safari) — assume prompt
    return 'prompt';
  }
}

/**
 * Request microphone access with graceful error handling.
 * Returns the MediaStream if successful, or null if denied/failed.
 */
export async function requestMicAccess(constraints?: MediaStreamConstraints): Promise<MediaStream | null> {
  if (!isMicSupported()) {
    return null;
  }

  const defaultConstraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints || defaultConstraints);
  } catch (err: any) {
    // Handle specific error types gracefully
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      // User denied permission or it was blocked
      return null;
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      // No microphone device available
      return null;
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      // Microphone is in use by another app or hardware error
      return null;
    }
    // Any other error
    return null;
  }
}

/**
 * Check if we're running inside an in-app browser (Pinterest, Instagram, etc.)
 * that blocks microphone access. These environments need PWA install.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const inAppPatterns = [
    'Pinterest',
    'Instagram',
    'FBAN', // Facebook
    'FBAV', // Facebook
    'Line/',
    'Snapchat',
    'TikTok',
    'Twitter',
    'WhatsApp',
  ];

  return inAppPatterns.some((pattern) => ua.includes(pattern));
}

/**
 * Check if the app is running in standalone (installed PWA) mode.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

/**
 * Returns a human-readable error message for mic failures.
 */
export function getMicErrorMessage(err: any): string {
  if (!err) return 'Unknown microphone error';

  switch (err.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access was denied. Please allow microphone permission in your browser settings.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found. Please connect a microphone and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Microphone is in use by another application. Please close it and try again.';
    case 'OverconstrainedError':
      return 'Microphone does not meet the required constraints. Try different audio settings.';
    case 'SecurityError':
      return 'Microphone access blocked due to security restrictions. Install the app to enable voice.';
    default:
      return err.message || 'Failed to access microphone.';
  }
}
