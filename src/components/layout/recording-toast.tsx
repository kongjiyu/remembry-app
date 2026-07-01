"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Mic, Square, X, Pause, Play } from "lucide-react";
import { useRecording } from "@/components/layout/recording-provider";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";
import { navigateTo } from "@/lib/navigation";

function formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

const TOAST_ID = "recording-active";

export function RecordingToast() {
    const rec = useRecording();
    const pathname = usePathname();
    const [nowMs, setNowMs] = React.useState(0);
    const isPaused = rec.status === "paused";

    // The toast is a global control surface for the recording — but when
    // the user is already on the create event page the live recording UI
    // is right there, so the toast would be redundant clutter. Hide it on
    // /events/new so the user isn't fighting two views of the same state.
    const isOnCreateEventPage = pathname?.startsWith("/events/new") ?? false;

    // Safety-net polling: every 2s, ask the provider to re-sync from the
    // Rust backend. Catches state drift after navigation, page refresh,
    // or any path where the provider state fell out of sync (e.g. an
    // external HTTP /api/recording/start hit the backend but no Tauri
    // event fired in the WebView).
    //
    // We hold refresh in a ref so the interval is only (re)created when
    // active flips on/off, not on every provider state update. And the
    // interval is only created when a recording is actually in progress —
    // running it for the entire app lifetime was 14,400 wasted IPC calls
    // per 8-hour workday for no benefit.
    const refreshRef = React.useRef(rec.refresh);
    React.useEffect(() => {
        refreshRef.current = rec.refresh;
    });
    const isActiveForPolling = rec.status !== "idle";
    React.useEffect(() => {
        if (!isActiveForPolling) return;
        const interval = setInterval(() => {
            void refreshRef.current();
        }, 2000);
        return () => clearInterval(interval);
    }, [isActiveForPolling]);

    React.useEffect(() => {
        // Only tick the clock when actively recording. When paused, freeze
        // the elapsed counter so the user sees time stop during pause.
        if (rec.status !== "recording" || !rec.startedAt) {
            return;
        }
        const update = () => setNowMs(new Date().getTime());
        update();
        const id = setInterval(update, 1000);
        return () => clearInterval(id);
    }, [rec.status, rec.startedAt]);

    // When paused, freeze elapsed at the moment of pause so it doesn't
    // drift up while the user is in pause mode.
    const elapsedMs = rec.startedAt && (rec.status === "recording" || rec.status === "paused")
        ? Math.max(0, nowMs - rec.startedAt)
        : 0;

    const isActive = rec.status === "recording" || rec.status === "paused";
    const elapsed = rec.startedAt ? formatElapsed(elapsedMs) : "00:00";

    // Stable refs to the provider's actions. The provider's stop/pause/resume
    // are useCallback with [] deps (stable), but `rec` is a new object on
    // every render. Without these refs the toast's useCallback with [rec]
    // would create new handler functions on every render — and the sonner
    // toast portal may not re-render with the fresh closures on every tick.
    // The refs guarantee the buttons always call the latest provider methods.
    const stopRef = React.useRef(rec.stop);
    const pauseRef = React.useRef(rec.pause);
    const resumeRef = React.useRef(rec.resume);
    React.useEffect(() => {
        stopRef.current = rec.stop;
        pauseRef.current = rec.pause;
        resumeRef.current = rec.resume;
    });

    const handleStop = React.useCallback(async () => {
        try {
            await stopRef.current();
            // The provider surfaces save errors via state.lastError, which
            // a separate effect below reads to show an error toast. Either
            // way, dismiss the lingering active-recording toast here — it
            // has duration: Infinity and would otherwise stay on screen
            // forever if the error path was taken.
            sonnerToast.dismiss(TOAST_ID);
        } catch (err) {
            // Even on a thrown error, dismiss the lingering active-recording
            // toast — it has duration: Infinity and would otherwise stay on
            // screen forever, blocking the user from starting a new recording
            // via the toast (the in-page controls still work, but the toast
            // itself is a stuck artifact).
            sonnerToast.dismiss(TOAST_ID);
            const message = err instanceof Error ? err.message : "Failed to stop recording";
            sonnerToast.error(message);
        }
    }, []);

    // Surface provider.lastError as a sonner toast. The provider sets this
    // when save_audio_blob fails inside the onstop handler, OR when start()
    // encounters a non-recoverable backend error. The effect fires once per
    // new error value (we keep the last shown one in a ref to avoid replay).
    const lastShownErrorRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!rec.lastError) {
            lastShownErrorRef.current = null;
            return;
        }
        if (rec.lastError === lastShownErrorRef.current) return;
        lastShownErrorRef.current = rec.lastError;
        sonnerToast.error(rec.lastError);
    }, [rec.lastError]);

    // Show a success toast and navigate to the create-event page when a
    // recording completes successfully. The provider sets lastCompleted
    // only when save_audio_blob succeeded, so this is a reliable signal
    // that the audio is on disk and ready to use. The lastCompletedAt
    // ref ensures we only react to NEW completions, not the initial null
    // → {…} transition on first mount.
    const lastSeenCompletedAtRef = React.useRef<number | null>(null);
    React.useEffect(() => {
        if (!rec.lastCompleted) return;
        if (rec.lastCompleted.completedAt === lastSeenCompletedAtRef.current) return;
        lastSeenCompletedAtRef.current = rec.lastCompleted.completedAt;
        sonnerToast.success("Recording stopped");
        // Take the user to the create event page WITHOUT ?mode=record so the
        // page mounts in its default (upload) mode and doesn't auto-start
        // another recording. They can re-record or pick the stopped audio.
        navigateTo("/events/new");
    }, [rec.lastCompleted]);

    const handlePause = React.useCallback(() => {
        pauseRef.current();
    }, []);

    const handleResume = React.useCallback(() => {
        resumeRef.current();
    }, []);

    const handleDismiss = React.useCallback(() => {
        sonnerToast.dismiss(TOAST_ID);
    }, []);

    const handleOpenRecording = React.useCallback(() => {
        sonnerToast.dismiss(TOAST_ID);
        navigateTo("/events/new?mode=record");
    }, []);

    // Create / update toast (no cleanup — sonner.custom() with the same id
    // updates the existing toast in place, so we DON'T dismiss + re-create
    // on every tick of `elapsed`. The previous implementation had a cleanup
    // that dismissed the toast on every effect re-run, which made the toast
    // flash off-screen every second — looks like the toast "disappears").
    React.useEffect(() => {
        if (!isActive || !rec.title || isOnCreateEventPage) return;
        sonnerToast.custom(
            (toastId) => (
                <RecordingCard
                    title={rec.title}
                    elapsed={elapsed}
                    isPaused={isPaused}
                    onStop={handleStop}
                    onPause={handlePause}
                    onResume={handleResume}
                    onDismiss={handleDismiss}
                    onOpenRecording={handleOpenRecording}
                />
            ),
            {
                id: TOAST_ID,
                duration: Infinity,
                position: "top-center",
            }
        );
    }, [
        isActive,
        isPaused,
        isOnCreateEventPage,
        rec.title,
        elapsed,
        handleStop,
        handlePause,
        handleResume,
        handleDismiss,
        handleOpenRecording,
    ]);

    // Separate dismiss effect — runs when recording ends OR when the user
    // navigates to the create event page. Kept apart from the create/update
    // effect so the per-second `elapsed` ticks don't dismiss the toast.
    React.useEffect(() => {
        if (!isActive || isOnCreateEventPage) {
            sonnerToast.dismiss(TOAST_ID);
        }
    }, [isActive, isOnCreateEventPage]);

    return null;
}

function RecordingCard({ title, elapsed, isPaused, onStop, onPause, onResume, onDismiss, onOpenRecording }: {
    title: string;
    elapsed: string;
    isPaused: boolean;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onDismiss: () => void;
    onOpenRecording: () => void;
}) {
    // Button clicks stop propagation so they trigger their own actions
    // instead of opening the create event page.
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    return (
        <div
            className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-border bg-popover py-1.5 pl-1.5 pr-1.5 text-popover-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10 cursor-pointer hover:bg-accent/30 transition-colors"
            onClick={onOpenRecording}
            role="button"
            tabIndex={0}
            aria-label={`Open recording for ${title}`}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenRecording();
                }
            }}
        >
            <div className="flex size-8 items-center justify-center rounded-full bg-violet-500/20 shrink-0">
                <Mic className="size-4 text-violet-500" />
            </div>
            <span className="relative flex size-2 shrink-0">
                <span
                    className={cn(
                        "absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75",
                        isPaused ? "" : "animate-ping"
                    )}
                ></span>
                <span
                    className={cn(
                        "relative inline-flex size-2 rounded-full",
                        isPaused ? "bg-amber-500" : "bg-red-500"
                    )}
                ></span>
            </span>
            <span className="text-sm font-medium truncate max-w-[180px]">{title}</span>
            <span className="text-sm text-muted-foreground tabular-nums shrink-0">{elapsed}</span>
            <div className="flex items-center gap-0.5 ml-1" onClick={stop}>
                {isPaused ? (
                    <button
                        onClick={onResume}
                        aria-label="Resume"
                        className="flex size-8 items-center justify-center rounded-full hover:bg-accent text-foreground transition-colors"
                    >
                        <Play className="size-4" />
                    </button>
                ) : (
                    <button
                        onClick={onPause}
                        aria-label="Pause"
                        className="flex size-8 items-center justify-center rounded-full hover:bg-accent text-foreground transition-colors"
                    >
                        <Pause className="size-4" />
                    </button>
                )}
                <button
                    onClick={onStop}
                    aria-label="Stop"
                    className="flex size-8 items-center justify-center rounded-full hover:bg-destructive/10 text-destructive transition-colors"
                >
                    <Square className="size-4" />
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                    aria-label="Dismiss"
                    className="flex size-8 items-center justify-center rounded-full hover:bg-accent text-muted-foreground transition-colors"
                >
                    <X className="size-4" />
                </button>
            </div>
        </div>
    );
}
