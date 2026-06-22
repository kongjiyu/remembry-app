// DEPRECATED: Use `useRecording()` from `@/components/layout/recording-provider` instead.
// Recording is now root-scoped so MCP and other pages can interact with it.
// This file will be removed in a future commit.

"use client";

import { useEffect, useRef, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface UseRecordingBridgeOptions {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  hasPermission: boolean | null;
  onRecordingComplete?: (blob: Blob, duration: number) => void;
}

/**
 * Bridges Tauri HTTP API events to the MediaRecorder-based recording system.
 *
 * Listens for:
 * - `start-record` — triggers recording (called by MCP via HTTP API)
 * - `stop-record` — stops recording and auto-confirms (called by MCP via HTTP API)
 *
 * This allows the MCP server to control recording remotely while the
 * actual audio capture happens in the WebView via browser MediaRecorder.
 */
export function useRecordingBridge({
  startRecording,
  stopRecording,
  isRecording,
  hasPermission,
  onRecordingComplete,
}: UseRecordingBridgeOptions) {
  const audioBlobRef = useRef<Blob | null>(null);
  const durationRef = useRef<number>(0);
  const onCompleteRef = useRef(onRecordingComplete);
  onCompleteRef.current = onRecordingComplete;

  // Track the latest blob and duration from the recorder
  const handleBlobReady = useCallback((blob: Blob, duration: number) => {
    audioBlobRef.current = blob;
    durationRef.current = duration;
  }, []);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      // Listen for start-record event from Rust HTTP API
      const unlistenStart = await listen("start-record", async () => {
        console.log("[RecordingBridge] Received start-record event");
        if (!isRecording && hasPermission) {
          try {
            await startRecording();
            console.log("[RecordingBridge] Recording started");
          } catch (err) {
            console.error("[RecordingBridge] Failed to start recording:", err);
          }
        }
      });
      unlisteners.push(unlistenStart);

      // Listen for stop-record event from Rust HTTP API
      const unlistenStop = await listen("stop-record", () => {
        console.log("[RecordingBridge] Received stop-record event");
        if (isRecording) {
          stopRecording();
          console.log("[RecordingBridge] Recording stopped, waiting for blob...");
          // The blob will be ready after MediaRecorder.onstop fires
          // We need to wait a tick for the state to update
          setTimeout(() => {
            if (audioBlobRef.current && onCompleteRef.current) {
              console.log("[RecordingBridge] Auto-confirming recording");
              onCompleteRef.current(audioBlobRef.current, durationRef.current);
            }
          }, 500);
        }
      });
      unlisteners.push(unlistenStop);
    };

    setup();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [startRecording, stopRecording, isRecording, hasPermission]);

  return { handleBlobReady };
}
