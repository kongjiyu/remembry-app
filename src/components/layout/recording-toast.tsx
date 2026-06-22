"use client";

import * as React from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRecording } from "@/components/layout/recording-provider";
import { toast as sonnerToast } from "sonner";

function formatElapsed(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

export function RecordingToast() {
    const rec = useRecording();
    const [now, setNow] = React.useState(Date.now());

    React.useEffect(() => {
        if (rec.status !== "recording" || !rec.startedAt) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [rec.status, rec.startedAt]);

    React.useEffect(() => {
        if (rec.status === "recording" && rec.title) {
            sonnerToast.custom(
                (toastId) => (
                    <RecordingCard
                        title={rec.title}
                        elapsed={rec.startedAt ? formatElapsed(now - rec.startedAt) : "00:00"}
                        onStop={async () => {
                            try {
                                await rec.stop();
                                sonnerToast.dismiss(toastId);
                                sonnerToast.success("Recording stopped");
                            } catch (err) {
                                sonnerToast.error("Failed to stop recording");
                            }
                        }}
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
    }, [rec.status, rec.title, rec.startedAt, now, rec.stop]);

    return null;
}

function RecordingCard({ title, elapsed, onStop, onDismiss }: { title: string; elapsed: string; onStop: () => void; onDismiss: () => void }) {
    return (
        <div className="pointer-events-auto flex w-[380px] items-start gap-3 rounded-xl border border-border/60 bg-zinc-900 px-4 py-3 text-zinc-100 shadow-2xl ring-1 ring-black/20">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                <Mic className="size-4 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"></span>
                        <span className="relative inline-flex size-2 rounded-full bg-red-500"></span>
                    </span>
                    <p className="text-sm font-medium leading-tight truncate">Recording: {title}</p>
                </div>
                <p className="mt-0.5 text-xs text-zinc-400 tabular-nums">{elapsed}</p>
                <div className="mt-2 flex gap-2">
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
