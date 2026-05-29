"use client";

import { useEffect, useRef } from "react";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AudioVisualizer } from "@/components/ui/audio-visualizer";
import { Mic, Square, Pause, Play, RotateCcw, AlertCircle, Settings } from "lucide-react";
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

    const autoStartRef = useRef<boolean | undefined>(undefined);
    if (autoStartRef.current === undefined) {
        autoStartRef.current = autoStart;
    }

    // Track if we've already triggered auto-start to prevent double-recording
    const autoStartedRef = useRef(false);

    // Report unsaved recording state to parent
    useEffect(() => {
        if (!onUnsavedRecordingChange) return;
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
    if (audioUrl && audioBlob && !isRecording) {
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

    // Recording in progress
    if (isRecording) {
        return (
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
                                onClick={pauseRecording}
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
        );
    }

    // Permission request state (hasPermission is true but not recording yet)
    if (hasPermission === true && !isRecording && !audioUrl) {
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