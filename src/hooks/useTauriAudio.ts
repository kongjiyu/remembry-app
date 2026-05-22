import { isRunningInTauri } from '@/lib/tauriApi';

// Browser audio works in Tauri WebView since it uses standard WebView APIs
// The existing useAudioRecorder hook already works - no Tauri-specific audio needed
export function canUseBrowserAudioInTauri(): boolean {
  return isRunningInTauri();
}

// Placeholder for future native audio implementation
export async function getAudioDevices(): Promise<string[]> {
  return [];
}