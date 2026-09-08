type SoundKind = 'tap' | 'toggle' | 'download' | 'success';

const SOUND_ENABLED_KEY = 'sonora_ui_sounds_enabled';
let audioContext: AudioContext | null = null;

export function uiSoundsEnabled(): boolean {
  return localStorage.getItem(SOUND_ENABLED_KEY) !== '0';
}

export function setUiSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_ENABLED_KEY, enabled ? '1' : '0');
}

export function playUiSound(kind: SoundKind = 'tap'): void {
  if (!uiSoundsEnabled()) return;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioContext ||= new Ctx();
    const ctx = audioContext;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const settings = {
      tap: [420, 0.018, 0.025],
      toggle: [620, 0.02, 0.035],
      download: [760, 0.026, 0.05],
      success: [880, 0.03, 0.055],
    }[kind];
    osc.type = 'sine';
    osc.frequency.setValueAtTime(settings[0], now);
    osc.frequency.exponentialRampToValueAtTime(settings[0] * 0.72, now + settings[2]);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(settings[1], now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings[2]);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + settings[2] + 0.01);
  } catch {
    // UI feedback should never interfere with controls.
  }
}
