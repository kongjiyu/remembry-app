"use client";

import * as React from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface RecordingProviderState {
    status: "idle" | "recording";
    jobId: string | null;
    title: string;
    startedAt: number | null;
    audioPath: string | null;
    start: (title: string) => Promise<void>;
    stop: () => Promise<void>;
    refresh: () => Promise<void>;
}

const RecordingContext = React.createContext<RecordingProviderState | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = React.useState<Omit<RecordingProviderState, "start" | "stop" | "refresh">>({
        status: "idle",
        jobId: null,
        title: "",
        startedAt: null,
        audioPath: null,
    });
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const chunksRef = React.useRef<Blob[]>([]);
    const streamRef = React.useRef<MediaStream | null>(null);

    const refreshFromBackend = React.useCallback(async () => {
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const session = await invoke<{ job_id: string; title: string; started_at_ms: number; audio_path: string } | null>("get_recording_state");
            if (session) {
                setState({
                    status: "recording",
                    jobId: session.job_id,
                    title: session.title,
                    startedAt: session.started_at_ms,
                    audioPath: session.audio_path,
                });
            } else {
                setState({ status: "idle", jobId: null, title: "", startedAt: null, audioPath: null });
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
                    const jobId = stateNow?.job_id ?? mediaRecorderRef.current?.stream?.id ?? "rec_unknown";
                    await invoke("save_audio_blob", { jobId, bytes });
                } catch (err) {
                    console.error("[RecordingProvider] save_audio_blob failed", err);
                }
                stream.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            };
            mr.start(1000); // collect chunks every 1s
            const { invoke } = await import("@tauri-apps/api/core");
            const session = await invoke<{ job_id: string; title: string; started_at_ms: number; audio_path: string }>("start_recording_session", { title });
            setState({
                status: "recording",
                jobId: session.job_id,
                title: session.title,
                startedAt: session.started_at_ms,
                audioPath: session.audio_path,
            });
        } catch (err) {
            console.error("[RecordingProvider] start failed", err);
            throw err;
        }
    }, []);

    const stop = React.useCallback(async () => {
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            }
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("stop_recording_session");
            setState({ status: "idle", jobId: null, title: "", startedAt: null, audioPath: null });
        } catch (err) {
            console.error("[RecordingProvider] stop failed", err);
            throw err;
        }
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
        <RecordingContext.Provider value={{ ...state, start, stop, refresh }}>
            {children}
        </RecordingContext.Provider>
    );
}

export function useRecording(): RecordingProviderState {
    const ctx = React.useContext(RecordingContext);
    if (!ctx) throw new Error("useRecording must be used within RecordingProvider");
    return ctx;
}
