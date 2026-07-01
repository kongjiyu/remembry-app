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
    lastError: string | null;
    start: (title: string) => Promise<void>;
    stop: () => Promise<void>;
    pause: () => void;
    resume: () => void;
    refresh: () => Promise<void>;
    clearLastCompleted: () => void;
    /** Stop the backend session only if there is no live MediaRecorder.
     *  Used to clean up a "phantom" stale state after a full page reload
     *  without terminating a legitimate live recording the user is
     *  actively navigating around. */
    stopIfOrphaned: () => Promise<void>;
}

const RecordingContext = React.createContext<RecordingProviderState | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = React.useState<Omit<RecordingProviderState, "start" | "stop" | "pause" | "resume" | "refresh" | "clearLastCompleted" | "stopIfOrphaned">>({
        status: "idle",
        jobId: null,
        title: "",
        startedAt: null,
        audioPath: null,
        lastCompleted: null,
        lastError: null,
    });
    const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
    const streamRef = React.useRef<MediaStream | null>(null);
    const stopPendingRef = React.useRef<{ resolve: (info: { blob: Blob; path: string; durationSec: number }) => void; reject: (e: unknown) => void } | null>(null);
    const startedAtMsRef = React.useRef<number | null>(null);
    const titleRef = React.useRef<string>("");
    const jobIdRef = React.useRef<string | null>(null);
    // Synchronous guard against concurrent start() invocations. The state
    // check + ref check is non-atomic in async code (both can pass before
    // either side finishes getUserMedia or the backend invoke), so this
    // flag is the only thing that can guarantee one MediaRecorder is
    // created per start attempt. The MCP "start-record" event and a
    // user-clicked Start can both fire within a few ms of each other; this
    // ref is what keeps them from racing.
    const startingRef = React.useRef<boolean>(false);
    // Monotonically increasing generation counter. Each start() captures
    // its own generation and the onstop handler bails out if the
    // generation has advanced — a stale onstop from a previous MediaRecorder
    // must never resolve the new recording's stopPending promise.
    const generationRef = React.useRef<number>(0);
    // Mirror of the React state so async callbacks (start/stop) can read the
    // latest status without taking state as a dependency and re-creating
    // themselves on every render.
    const stateRef = React.useRef(state);
    stateRef.current = state;

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
        // Atomic guard: a single synchronous ref check that wins the race
        // between concurrent start() invocations. The state check + the
        // mediaRecorderRef check below are necessary but not sufficient on
        // their own — between the two async calls (getUserMedia, then
        // invoke), another start() can pass the same guards and orphan the
        // first MediaRecorder. The startingRef is set the instant we
        // decide to start, before any await, and cleared in finally.
        if (startingRef.current) {
            console.warn("[RecordingProvider] start skipped — already starting");
            return;
        }
        if (stateRef.current.status === "recording" || stateRef.current.status === "paused") {
            console.warn("[RecordingProvider] start skipped — recording already in progress");
            return;
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            console.warn("[RecordingProvider] start skipped — MediaRecorder still active");
            return;
        }
        startingRef.current = true;

        // Per-recording state captured in the closures of ondataavailable /
        // onstop. Reading the shared chunksRef/jobIdRef from inside onstop
        // is unsafe: a fast subsequent start() can reset chunksRef and
        // jobIdRef BEFORE the previous onstop runs, causing the previous
        // recording to be saved under the new recording's jobId (or to
        // the wrong path entirely).
        const myGen = ++generationRef.current;
        const myChunks: Blob[] = [];
        const myJobIdRef: { current: string | null } = { current: null };
        // Audio-only duration tracking. Wall-clock time would include
        // pauses (MediaRecorder emits no chunks while paused), making the
        // duration label lie. We accumulate the time between
        // onstart/onresume and onpause/onstop instead.
        const myRecordedMsRef: { current: number } = { current: 0 };
        const myLastResumeAtRef: { current: number | null } = { current: null };

        let mr: MediaRecorder | null = null;
        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Generation may have advanced (another start raced us before
            // the await resolved) — release the stream and bail.
            if (generationRef.current !== myGen) {
                stream.getTracks().forEach((t) => t.stop());
                return;
            }
            streamRef.current = stream;
            mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = mr;
            mr.ondataavailable = (e) => { if (e.data.size > 0) myChunks.push(e.data); };
            mr.onpause = () => {
                if (myLastResumeAtRef.current !== null) {
                    myRecordedMsRef.current += Date.now() - myLastResumeAtRef.current;
                    myLastResumeAtRef.current = null;
                }
            };
            mr.onresume = () => {
                myLastResumeAtRef.current = Date.now();
            };
            mr.onstop = async () => {
                // Stale onstop from a previous MediaRecorder — the user has
                // already started a new recording. Drop this on the floor:
                // don't resolve a stopPending, don't save to a wrong path.
                if (generationRef.current !== myGen) {
                    stream?.getTracks().forEach((t) => t.stop());
                    return;
                }
                // Close out the in-progress segment, if any, so the final
                // duration includes audio up to the moment of stop.
                if (myLastResumeAtRef.current !== null) {
                    myRecordedMsRef.current += Date.now() - myLastResumeAtRef.current;
                    myLastResumeAtRef.current = null;
                }
                const durationSec = Math.max(0, Math.floor(myRecordedMsRef.current / 1000));
                const blob = new Blob(myChunks, { type: "audio/webm" });
                try {
                    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
                    const { invoke } = await import("@tauri-apps/api/core");
                    const jobId = myJobIdRef.current ?? jobIdRef.current ?? "rec_unknown";
                    const path = await invoke<string>("save_audio_blob", { jobId, bytes });
                    if (stopPendingRef.current) {
                        stopPendingRef.current.resolve({ blob, path, durationSec });
                        stopPendingRef.current = null;
                    }
                } catch (err) {
                    console.error("[RecordingProvider] save_audio_blob failed", err);
                    // Surface the error to the UI so the toast doesn't show
                    // a misleading "Recording stopped" success message.
                    const message = err instanceof Error ? err.message : String(err);
                    setState((prev) => ({ ...prev, lastError: `Failed to save recording: ${message}` }));
                    if (stopPendingRef.current) {
                        stopPendingRef.current.reject(err);
                        stopPendingRef.current = null;
                    }
                }
                stream?.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            };
            mr.start(1000); // collect chunks every 1s
            // Now that mr is actually started, set the resume anchor.
            myLastResumeAtRef.current = Date.now();
            const { invoke } = await import("@tauri-apps/api/core");
            let session: { job_id: string; title: string; started_at_ms: number; audio_path: string };
            try {
                session = await invoke<{ job_id: string; title: string; started_at_ms: number; audio_path: string }>("start_recording_session", { title });
            } catch (err) {
                // Race condition: after a full page reload (e.g. clicking the
                // recording toast), the auto-start effect on /events/new can
                // fire before refreshFromBackend() syncs state from the
                // backend. The React state looks "idle" so the guard above
                // passes, but the Rust backend still has the prior session.
                // Tear down the just-created MediaRecorder and silently
                // bail out — the in-flight recording on the backend continues
                // unchanged.
                // Tauri wraps invoke errors — the string from Rust may come
                // through as a plain string OR an Error with .message. Handle
                // both so we don't re-throw the "already in progress" to the
                // outer catch (which would log it as a console error).
                const errMsg = typeof err === "string"
                    ? err
                    : err instanceof Error
                        ? err.message
                        : String(err);
                if (errMsg.includes("already in progress")) {
                    console.warn("[RecordingProvider] start skipped — backend has active session");
                    mr?.stop();
                    stream.getTracks().forEach((t) => t.stop());
                    mediaRecorderRef.current = null;
                    streamRef.current = null;
                    return;
                }
                // Any other backend error: release the MediaRecorder + stream
                // so the mic is freed and the user can retry. Without this,
                // mr.start(1000) has already begun capturing audio and the
                // mic LED stays on with no UI way to stop it.
                mr?.stop();
                stream.getTracks().forEach((t) => t.stop());
                mediaRecorderRef.current = null;
                streamRef.current = null;
                setState((prev) => ({ ...prev, lastError: `Failed to start recording: ${errMsg}` }));
                throw err;
            }
            // Generation guard after the backend invoke — if another start
            // raced us past the guard, abandon this one's results and let
            // the winning start own the state.
            if (generationRef.current !== myGen) {
                mr.stop();
                stream.getTracks().forEach((t) => t.stop());
                mediaRecorderRef.current = null;
                streamRef.current = null;
                return;
            }
            startedAtMsRef.current = session.started_at_ms;
            titleRef.current = session.title;
            jobIdRef.current = session.job_id;
            myJobIdRef.current = session.job_id;
            setState({
                status: "recording",
                jobId: session.job_id,
                title: session.title,
                startedAt: session.started_at_ms,
                audioPath: session.audio_path,
                lastCompleted: null, // clear any previous preview when a new recording starts
                lastError: null,
            });
        } catch (err) {
            // Top-level catch: only fires for non-'already in progress'
            // failures during start() itself. mr/stream are best-effort
            // released here too in case the throw happened between
            // getUserMedia and mr construction.
            console.error("[RecordingProvider] start failed", err);
            try { mr?.stop(); } catch { /* ignore */ }
            try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
            mediaRecorderRef.current = null;
            streamRef.current = null;
            throw err;
        } finally {
            startingRef.current = false;
        }
    }, []);

    const stop = React.useCallback(async () => {
        try {
            const wasActive = mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive";
            if (wasActive) {
                // Wait for the onstop handler to flush the blob to disk before resolving.
                const stopInfoPromise = new Promise<{ blob: Blob; path: string; durationSec: number }>((resolve, reject) => {
                    stopPendingRef.current = { resolve, reject };
                });
                mediaRecorderRef.current!.stop();
                let info: { blob: Blob; path: string; durationSec: number } | null = null;
                try {
                    info = await stopInfoPromise;
                } catch (err) {
                    // save_audio_blob failed — the toast will read state.lastError
                    // and show a "Failed to save recording" message instead of
                    // a misleading "Recording stopped" success. Fall through
                    // to clear the backend session so the next start works.
                    console.error("[RecordingProvider] flush on stop failed", err);
                }
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("stop_recording_session");

                const jobId = jobIdRef.current;
                const title = titleRef.current;

                startedAtMsRef.current = null;
                jobIdRef.current = null;
                titleRef.current = "";

                // Use the audio-only duration that onstop computed (excluding
                // pauses). Wall-clock duration would overstate the length and
                // mislead any downstream consumer that trusts this value.
                const durationSec = info?.durationSec ?? 0;

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
                    lastError: null,
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

    // Tear down the backend session only if there is no live MediaRecorder
    // backing it. Used after a full page reload to clean up the "phantom
    // UI" scenario (React state says recording but the MediaRecorder was
    // lost with the page). Critically, this does NOT call mr.stop() if a
    // live recorder exists — that would terminate a recording the user
    // is actively using.
    const stopIfOrphaned = React.useCallback(async () => {
        if (mediaRecorderRef.current) {
            // Live MediaRecorder — the React state is correct. Leave it alone.
            return;
        }
        const { invoke } = await import("@tauri-apps/api/core");
        try {
            await invoke("stop_recording_session");
        } catch (err) {
            console.warn("[RecordingProvider] stopIfOrphaned: stop_recording_session failed", err);
        }
        startedAtMsRef.current = null;
        jobIdRef.current = null;
        titleRef.current = "";
        setState((prev) => ({
            ...prev,
            status: "idle",
            jobId: null,
            title: "",
            startedAt: null,
            audioPath: null,
        }));
    }, []);

    const pause = React.useCallback(() => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state === "recording") {
            mr.pause();
            setState((prev) => ({ ...prev, status: "paused" }));
        } else if (stateRef.current.status === "recording") {
            // MediaRecorder is null (e.g. after a full page reload) but the
            // provider state still says recording. We can't actually pause
            // the in-flight MediaRecorder since the instance is gone, but
            // at least surface the paused state so the UI is consistent.
            // The next refreshFromBackend tick will reconcile.
            console.warn("[RecordingProvider] pause: no live MediaRecorder — UI-only pause");
            setState((prev) => ({ ...prev, status: "paused" }));
        }
    }, []);

    const resume = React.useCallback(() => {
        const mr = mediaRecorderRef.current;
        if (mr && mr.state === "paused") {
            mr.resume();
            setState((prev) => ({ ...prev, status: "recording" }));
        } else if (stateRef.current.status === "paused") {
            console.warn("[RecordingProvider] resume: no live MediaRecorder — UI-only resume");
            setState((prev) => ({ ...prev, status: "recording" }));
        }
    }, []);

    const clearLastCompleted = React.useCallback(() => {
        setState((prev) => ({ ...prev, lastCompleted: null, lastError: null }));
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
        <RecordingContext.Provider value={{ ...state, start, stop, pause, resume, refresh, clearLastCompleted, stopIfOrphaned }}>
            {children}
        </RecordingContext.Provider>
    );
}

export function useRecording(): RecordingProviderState {
    const ctx = React.useContext(RecordingContext);
    if (!ctx) throw new Error("useRecording must be used within RecordingProvider");
    return ctx;
}
