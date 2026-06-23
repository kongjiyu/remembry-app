"use client";

import * as React from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface CompletedRecording {
    jobId: string;
    title: string;
    blob: Blob;
    mimeType: string;
    durationSec: number;
    completedAt: number;
}

export interface RecordingProviderState {
    status: "idle" | "recording" | "paused";
    jobId: string | null;
    title: string;
    startedAt: number | null;
    audioPath: string | null;
    lastCompleted: CompletedRecording | null;
    start: (title: string) => Promise<void>;
    stop: () => Promise<void>;
    pause: () => void;
    resume: () => void;
    refresh: () => Promise<void>;
    clearLastCompleted: () => void;
}

const RecordingContext = React.createContext<RecordingProviderState | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = React.useState<Omit<RecordingProviderState, "start" | "stop" | "pause" | "resume" | "refresh" | "clearLastCompleted">>({
        status: "idle",
        jobId: null,
        title: "",
        startedAt: null,
        audioPath: null,
        lastCompleted: null,
    });
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const chunksRef = React.useRef<Blob[]>([]);
    const streamRef = React.useRef<MediaStream | null>(null);
    const stopPendingRef = React.useRef<{ resolve: (info: { blob: Blob; path: string }) => void; reject: (e: unknown) => void } | null>(null);
    const startedAtMsRef = React.useRef<number | null>(null);
    const titleRef = React.useRef<string>("");
    const jobIdRef = React.useRef<string | null>(null);

    const refreshFromBackend = React.useCallback(async () => {
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const session = await invoke<{ job_id: string; title: string; started_at_ms: number; audio_path: string } | null>("get_recording_state");
            if (session) {
                setState((prev) => ({
                    ...prev,
                    status: prev.status === "paused" ? "paused" : "recording",
                    jobId: session.job_id,
                    title: session.title,
                    startedAt: session.started_at_ms,
                    audioPath: session.audio_path,
                }));
                startedAtMsRef.current = session.started_at_ms;
                titleRef.current = session.title;
                jobIdRef.current = session.job_id;
            } else {
                setState((prev) => ({ ...prev, status: "idle", jobId: null, title: "", startedAt: null, audioPath: null }));
                startedAtMsRef.current = null;
                titleRef.current = "";
                jobIdRef.current = null;
            }
        } catch (err) {
            console.error("[RecordingProvider] refresh failed", err);
        }
    }, []);

    const start = React.useCallback(async (title: string) => {
        // Avoid starting if already recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = mr;
            chunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            mr.onstop = async () => {
                // Save the recorded blob to backend temp_uploads
                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                try {
                    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
                    const { invoke } = await import("@tauri-apps/api/core");
                    const stateNow = (await invoke<{ job_id: string } | null>("get_recording_state")) ?? null;
                    const jobId = stateNow?.job_id ?? jobIdRef.current ?? "rec_unknown";
                    const path = await invoke<string>("save_audio_blob", { jobId, bytes });
                    if (stopPendingRef.current) {
                        stopPendingRef.current.resolve({ blob, path });
                        stopPendingRef.current = null;
                    }
                } catch (err) {
                    console.error("[RecordingProvider] save_audio_blob failed", err);
                    if (stopPendingRef.current) {
                        stopPendingRef.current.reject(err);
                        stopPendingRef.current = null;
                    }
                }
                stream.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            };
            mr.start(1000); // collect chunks every 1s
            const { invoke } = await import("@tauri-apps/api/core");
            const session = await invoke<{ job_id: string; title: string; started_at_ms: number; audio_path: string }>("start_recording_session", { title });
            startedAtMsRef.current = session.started_at_ms;
            titleRef.current = session.title;
            jobIdRef.current = session.job_id;
            setState({
                status: "recording",
                jobId: session.job_id,
                title: session.title,
                startedAt: session.started_at_ms,
                audioPath: session.audio_path,
                lastCompleted: null, // clear any previous preview when a new recording starts
            });
        } catch (err) {
            console.error("[RecordingProvider] start failed", err);
            throw err;
        }
    }, []);

    const stop = React.useCallback(async () => {
        try {
            const wasActive = mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive";
            if (wasActive) {
                // Wait for the onstop handler to flush the blob to disk before resolving.
                const stopInfoPromise = new Promise<{ blob: Blob; path: string }>((resolve, reject) => {
                    stopPendingRef.current = { resolve, reject };
                });
                mediaRecorderRef.current!.stop();
                let info: { blob: Blob; path: string } | null = null;
                try {
                    info = await stopInfoPromise;
                } catch (err) {
                    // Even if save failed, fall through to clear the backend session.
                    console.error("[RecordingProvider] flush on stop failed", err);
                }
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("stop_recording_session");

                const startedAt = startedAtMsRef.current;
                const durationSec = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
                const jobId = jobIdRef.current;
                const title = titleRef.current;

                startedAtMsRef.current = null;
                jobIdRef.current = null;
                titleRef.current = "";

                const completed: CompletedRecording | null = (jobId && info) ? {
                    jobId,
                    title,
                    blob: info.blob,
                    mimeType: info.blob.type || "audio/webm",
                    durationSec,
                    completedAt: Date.now(),
                } : null;

                setState({
                    status: "idle",
                    jobId: null,
                    title: "",
                    startedAt: null,
                    audioPath: info?.path ?? null,
                    lastCompleted: completed,
                });
            } else {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("stop_recording_session");
                setState((prev) => ({ ...prev, status: "idle", jobId: null, title: "", startedAt: null, audioPath: null }));
            }
        } catch (err) {
            console.error("[RecordingProvider] stop failed", err);
            throw err;
        }
    }, []);

    const pause = React.useCallback(() => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state === "recording") {
            mr.pause();
            setState((prev) => ({ ...prev, status: "paused" }));
        }
    }, []);

    const resume = React.useCallback(() => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state === "paused") {
            mr.resume();
            setState((prev) => ({ ...prev, status: "recording" }));
        }
    }, []);

    const clearLastCompleted = React.useCallback(() => {
        setState((prev) => ({ ...prev, lastCompleted: null }));
    }, []);

    // Exposed so consumers (e.g. RecordingToast) can poll and re-sync from backend
    // after navigation, refresh, or any state drift.
    const refresh = React.useCallback(async () => {
        await refreshFromBackend();
    }, [refreshFromBackend]);

    // Listen for start-record/stop-record Tauri events from MCP/Rust
    React.useEffect(() => {
        let unlisteners: UnlistenFn[] = [];
        let cancelled = false;
        (async () => {
            const unlistenStart = await listen("start-record", async () => {
                try { await start("Recording from MCP"); } catch (err) { console.error(err); }
            });
            const unlistenStop = await listen("stop-record", async () => {
                try { await stop(); } catch (err) { console.error(err); }
            });
            if (cancelled) {
                unlistenStart();
                unlistenStop();
                return;
            }
            unlisteners = [unlistenStart, unlistenStop];
            // Sync initial state from backend
            await refreshFromBackend();
        })();
        return () => {
            cancelled = true;
            unlisteners.forEach((u) => u());
        };
    }, [start, stop, refreshFromBackend]);

    return (
        <RecordingContext.Provider value={{ ...state, start, stop, pause, resume, refresh, clearLastCompleted }}>
            {children}
        </RecordingContext.Provider>
    );
}

export function useRecording(): RecordingProviderState {
    const ctx = React.useContext(RecordingContext);
    if (!ctx) throw new Error("useRecording must be used within RecordingProvider");
    return ctx;
}
