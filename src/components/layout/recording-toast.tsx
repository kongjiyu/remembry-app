"use client";

import * as React from "react";
import { Mic, Square, X, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRecording } from "@/components/layout/recording-provider";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";

function formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

export function RecordingToast() {
    const rec = useRecording();
    const [nowMs, setNowMs] = React.useState(0);
    const isPaused = rec.status === "paused";

    // Safety-net polling: every 2s, ask the provider to re-sync from the
    // Rust backend. Catches state drift after navigation, page refresh,
    // or any path where the provider state fell out of sync (e.g. an
    // external HTTP /api/recording/start hit the backend but no Tauri
    // event fired in the WebView).
    // We hold refresh in a ref so the interval is only (re)created when
    // status flips, not on every provider state update.
    const refreshRef = React.useRef(rec.refresh);
    React.useEffect(() => {
        refreshRef.current = rec.refresh;
    });
    React.useEffect(() => {
        const interval = setInterval(() => {
            void refreshRef.current();
        }, 2000);
        return () => clearInterval(interval);
    }, [rec.status]);

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

    React.useEffect(() => {
        if (isActive && rec.title) {
            sonnerToast.custom(
                (toastId) => (
                    <RecordingCard
                        title={rec.title}
                        elapsed={rec.startedAt ? formatElapsed(elapsedMs) : "00:00"}
                        isPaused={isPaused}
                        onStop={async () => {
                            try {
                                await rec.stop();
                                sonnerToast.dismiss(toastId);
                                sonnerToast.success("Recording stopped");
                            } catch {
                                sonnerToast.error("Failed to stop recording");
                            }
                        }}
                        onPause={() => rec.pause()}
                        onResume={() => rec.resume()}
                        onDismiss={() => sonnerToast.dismiss(toastId)}
                    />
                ),
                {
                    id: "recording-active",
                    duration: Infinity,
                    position: "top-center",
                }
            );
        } else {
            sonnerToast.dismiss("recording-active");
        }
        // elapsedMs is intentionally excluded — changes to it trigger the interval above
        // which re-renders and re-invokes this effect via nowMs dependencies.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, isPaused, rec.title, rec.startedAt, nowMs, rec.stop, rec.pause, rec.resume]);

    return null;
}

function RecordingCard({ title, elapsed, isPaused, onStop, onPause, onResume, onDismiss }: {
    title: string;
    elapsed: string;
    isPaused: boolean;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onDismiss: () => void;
}) {
    return (
        <div className="pointer-events-auto flex w-[380px] items-start gap-3 rounded-xl border border-border/60 bg-zinc-900 px-4 py-3 text-zinc-100 shadow-2xl ring-1 ring-black/20">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                <Mic className="size-4 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="relative flex size-2">
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
                    <p className="text-sm font-medium leading-tight truncate">
                        {isPaused ? "Paused:" : "Recording:"} {title}
                    </p>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400 tabular-nums">{elapsed}</p>
                <div className="mt-2 flex gap-2">
                    {isPaused ? (
                        <Button size="sm" variant="outline" onClick={onResume} className="h-7 text-xs bg-zinc-800 text-zinc-100 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-50">
                            <Play className="size-3 mr-1" />Resume
                        </Button>
                    ) : (
                        <Button size="sm" variant="outline" onClick={onPause} className="h-7 text-xs bg-zinc-800 text-zinc-100 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-50">
                            <Pause className="size-3 mr-1" />Pause
                        </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={onStop} className="h-7 text-xs">
                        <Square className="size-3 mr-1" />Stop
                    </Button>
                </div>
            </div>
            <button onClick={onDismiss} aria-label="Dismiss" className="text-zinc-500 hover:text-zinc-300">
                <X className="size-4" />
            </button>
        </div>
    );
}
