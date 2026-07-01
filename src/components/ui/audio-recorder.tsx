"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AudioVisualizer } from "@/components/ui/audio-visualizer";
import { Mic, Square, Pause, Play, RotateCcw, AlertCircle, Settings } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AudioRecorderProps {
    onRecordingComplete?: (blob: Blob, duration: number) => void;
    autoStart?: boolean;
    className?: string;
    onUnsavedRecordingChange?: (hasUnsavedRecording: boolean) => void;
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function AudioRecorder({ onRecordingComplete, autoStart, className, onUnsavedRecordingChange }: AudioRecorderProps) {
    const {
        isRecording,
        isPaused,
        duration,
        audioBlob,
        audioUrl,
        error,
        hasPermission,
        analyser,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        resetRecording,
        requestPermission,
        openSystemMicrophoneSettings,
    } = useAudioRecorder();

    // Soft-pause prompt: clicking Pause doesn't just freeze the
    // MediaRecorder — it surfaces a dialog asking the user to either
    // continue recording or end it. The previous behavior was "click
    // pause → UI flickers to the Ready-to-Record screen and the user
    // thinks pause is broken" because the recording UI was gated on
    // `isRecording` only and `isPaused` records were falling through
    // to the next branch. Now the recording UI is shown whenever the
    // provider is recording OR paused, and Pause opens a small modal
    // so the user explicitly decides to continue or end.
    const [pausePromptOpen, setPausePromptOpen] = useState(false);

    const handlePauseClick = () => {
        pauseRecording();
        setPausePromptOpen(true);
    };

    const handleContinue = () => {
        resumeRecording();
        setPausePromptOpen(false);
    };

    const handleEnd = () => {
        // Closing the prompt first so the recording-complete UI is the
        // next thing the user sees (and so the prompt doesn't briefly
        // overlay it during the async flush).
        setPausePromptOpen(false);
        stopRecording();
    };

    // NOTE: this component used to expose a forwardRef + useImperativeHandle
    // surface so a parent (events/new/page.tsx) could call
    // .startRecording() / .stopRecording() through a ref. That bridge is
    // dead — no caller in the repo ever reads audioRecorderRef.current —
    // and the real "Tauri event bridge" lives in RecordingProvider, which
    // subscribes to start-record/stop-record events directly. Keeping the
    // forwardRef wrapper would just be API surface inviting future bugs
    // (the ref could be wired up against the hook's still-async permission
    // flow and race the user into a NotAllowedError). The provider owns
    // the MediaRecorder, so the provider is the bridge.

    const autoStartRef = useRef<boolean | undefined>(undefined);
    if (autoStartRef.current === undefined) {
        autoStartRef.current = autoStart;
    }

    // Track if we've already triggered auto-start to prevent double-recording
    const autoStartedRef = useRef(false);

    // Report unsaved recording state to parent
    useEffect(() => {
        if (!onUnsavedRecordingChange) return;
        // A recording is "unsaved" while it's in progress, while it's
        // paused (audio captured but not finalized), or when there's a
        // captured audio preview that the user hasn't confirmed via
        // "Use Recording" yet.
        const isUnsaved = isRecording || isPaused || (audioUrl !== null && audioBlob !== null && !isRecording);
        onUnsavedRecordingChange(isUnsaved);
    }, [isRecording, isPaused, audioUrl, audioBlob, onUnsavedRecordingChange]);

    // Cleanup: report false on unmount
    useEffect(() => {
        return () => {
            if (onUnsavedRecordingChange) {
                onUnsavedRecordingChange(false);
            }
        };
    }, [onUnsavedRecordingChange]);

    const handleStopRecording = () => {
        stopRecording();
    };

    const handleConfirmRecording = () => {
        if (audioBlob && onRecordingComplete) {
            onRecordingComplete(audioBlob, duration);
            if (onUnsavedRecordingChange) onUnsavedRecordingChange(false);
        }
    };

    // Handle auto-start when autoStart is true - single guarded transition
    useEffect(() => {
        if (!autoStartRef.current || autoStartedRef.current) return;

        if (hasPermission === null) {
            requestPermission().then((granted) => {
                if (granted && autoStartRef.current && !autoStartedRef.current) {
                    autoStartedRef.current = true;
                    startRecording();
                }
            });
        } else if (hasPermission === true && !isRecording && !audioUrl && !autoStartedRef.current) {
            autoStartedRef.current = true;
            startRecording();
        }
    }, [hasPermission, requestPermission, startRecording, isRecording, audioUrl]);

    // Permission denied state
    if (hasPermission === false || error) {
        return (
            <Card className={cn("border-destructive/50", className)}>
                <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="flex size-20 items-center justify-center rounded-full bg-destructive/10 mb-6">
                        <AlertCircle className="size-10 text-destructive" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Microphone Permission Required</h3>
                    <p className="text-muted-foreground text-center max-w-sm mb-6">
                        {error || "Microphone access is blocked for Remembry. Enable microphone permission in your system settings."}
                    </p>
                    <div className="flex gap-3">
                        <Button onClick={openSystemMicrophoneSettings} variant="outline" className="gap-2">
                            <Settings className="size-4" />
                            Open Microphone Settings
                        </Button>
                        <Button onClick={requestPermission} variant="outline" className="gap-2">
                            <RotateCcw className="size-4" />
                            Try Again
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Recording complete - show preview
    if (audioUrl && audioBlob && !isRecording && !isPaused) {
        return (
            <Card className={cn("border-success/50 bg-success/5", className)}>
                <CardContent className="flex flex-col items-center justify-center py-8">
                    <div className="flex size-16 items-center justify-center rounded-full bg-success/10 mb-4">
                        <Mic className="size-8 text-success" />
                    </div>
                    <h3 className="text-lg font-semibold mb-1">Recording Complete</h3>
                    <p className="text-muted-foreground mb-4">
                        Duration: {formatDuration(duration)}
                    </p>

                    {/* Audio Player */}
                    <audio
                        src={audioUrl}
                        controls
                        className="w-full max-w-md mb-6 rounded-lg"
                    />

                    <div className="flex gap-3">
                        <Button variant="outline" onClick={resetRecording} className="gap-2">
                            <RotateCcw className="size-4" />
                            Re-record
                        </Button>
                        <Button onClick={handleConfirmRecording} className="gap-2">
                            <Mic className="size-4" />
                            Use Recording
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Recording in progress OR paused. We render the same shell for both
    // states and swap the action button (Resume vs. Pause). The duration
    // and visualizer are bound to the provider, so the counter freezes
    // when paused and resumes when continued.
    if (isRecording || isPaused) {
        return (
            <>
                <Card className={cn("border-primary/50", className)}>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                        {/* Visualizer */}
                        <div className="w-full max-w-md h-24 mb-6 flex items-center justify-center">
                            <AudioVisualizer
                                analyser={analyser}
                                isRecording={!isPaused}
                                className="w-full h-full"
                            />
                        </div>

                        <h3 className="text-lg font-semibold mb-1">
                            {isPaused ? "Recording Paused" : "Recording..."}
                        </h3>
                        <p className="text-3xl font-mono font-bold text-primary mb-6">
                            {formatDuration(duration)}
                        </p>

                        <div className="flex gap-3">
                            {isPaused ? (
                                <Button
                                    variant="outline"
                                    size="lg"
                                    onClick={resumeRecording}
                                    className="gap-2"
                                >
                                    <Play className="size-4" />
                                    Resume
                                </Button>
                            ) : (
                                <Button
                                    variant="outline"
                                    size="lg"
                                    onClick={handlePauseClick}
                                    className="gap-2"
                                >
                                    <Pause className="size-4" />
                                    Pause
                                </Button>
                            )}
                            <Button
                                variant="destructive"
                                size="lg"
                                onClick={handleStopRecording}
                                className="gap-2"
                            >
                                <Square className="size-4" />
                                Stop
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Dialog open={pausePromptOpen} onOpenChange={setPausePromptOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Recording paused</DialogTitle>
                            <DialogDescription>
                                Your recording is paused. Continue recording where you left off, or end and review the audio.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={handleEnd}
                            >
                                End Recording
                            </Button>
                            <Button
                                onClick={handleContinue}
                                className="gap-2"
                            >
                                <Play className="size-4" />
                                Continue Recording
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </>
        );
    }

    // Permission request state (hasPermission is true but not recording yet)
    if (hasPermission === true && !isRecording && !isPaused && !audioUrl) {
        return (
            <Card className={cn("border-dashed hover:border-primary/50 transition-colors", className)}>
                <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 mb-6 group-hover:bg-primary/20 transition-colors">
                        <Mic className="size-10 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Ready to Record</h3>
                    <p className="text-muted-foreground text-center max-w-sm mb-6">
                        Click the button below to start recording your meeting. Make sure you&apos;re in a quiet environment for best results.
                    </p>
                    <Button onClick={startRecording} size="lg" className="gap-2">
                        <Mic className="size-4" />
                        Start Recording
                    </Button>
                </CardContent>
            </Card>
        );
    }

    // Initial loading state (hasPermission is null and no autoStart)
    return (
        <Card className={cn("border-dashed", className)}>
            <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 mb-6">
                    <Mic className="size-10 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Enable Microphone</h3>
                <p className="text-muted-foreground text-center max-w-sm mb-6">
                    To record meetings directly, we need access to your microphone.
                </p>
                <Button onClick={requestPermission} size="lg" className="gap-2">
                    <Mic className="size-4" />
                    Allow Microphone Access
                </Button>
            </CardContent>
        </Card>
    );
}