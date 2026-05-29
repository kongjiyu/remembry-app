"use client";

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "upToDate" | "error";

export interface UpdateInfo {
  version: string;
  notes?: string;
}

let currentStatus: UpdateStatus = "idle";
let progress = 0;
let updateInfo: UpdateInfo | null = null;
let errorMessage = "";

type Listener = (status: UpdateStatus, info?: UpdateInfo, progress?: number) => void;
const listeners = new Set<Listener>();

function notify(status: UpdateStatus, info?: UpdateInfo, prog?: number) {
  currentStatus = status;
  progress = prog ?? 0;
  updateInfo = info ?? null;
  listeners.forEach((l) => l(status, info, prog));
}

export function subscribeToUpdates(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentStatus, updateInfo ?? undefined, progress);
  return () => listeners.delete(listener);
}

export async function checkForUpdates(): Promise<void> {
  if (currentStatus === "downloading" || currentStatus === "installing") return;
  notify("checking");
  try {
    const update = await check();
    if (update) {
      notify("available", { version: update.version, notes: update.body ?? undefined });
    } else {
      notify("upToDate");
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to check for updates";
    notify("error");
  }
}

export async function downloadAndInstall(onProgress?: (pct: number) => void): Promise<void> {
  if (!updateInfo) return;
  notify("downloading");
  try {
    const update = await check();
    if (!update) {
      notify("upToDate");
      return;
    }
    await update.downloadAndInstall((event) => {
      if (event.event === "Progress") {
        const total = (event.data as { contentLength?: number }).contentLength ?? 0;
        const downloaded = (event.data as { chunkLength?: number }).chunkLength ?? 0;
        const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        notify("downloading", updateInfo ?? undefined, pct);
        onProgress?.(pct);
      }
    });
    notify("installing");
    await relaunch();
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to install update";
    notify("error");
  }
}

export function getCurrentStatus(): { status: UpdateStatus; info?: UpdateInfo; progress: number } {
  return { status: currentStatus, info: updateInfo ?? undefined, progress };
}
