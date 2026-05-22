import { invoke, isTauri } from '@tauri-apps/api/core';

export function isRunningInTauri(): boolean {
  return isTauri();
}

export async function getAppTempDir(): Promise<string> {
  if (!isRunningInTauri()) {
    throw new Error('Not running in Tauri');
  }
  return invoke<string>('get_app_temp_dir');
}

export async function getAppDataDir(): Promise<string> {
  if (!isRunningInTauri()) {
    throw new Error('Not running in Tauri');
  }
  return invoke<string>('get_app_data_dir');
}