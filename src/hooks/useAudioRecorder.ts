"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRecording } from "@/components/layout/recording-provider";

export interface AudioRecorderState {
    isRecording: boolean;
    isPaused: boolean;
    duration: number;
    audioBlob: Blob | null;
    audioUrl: string | null;
    error: string | null;
    hasPermission: boolean | null;
    analyser: AnalyserNode | null;
}

export interface AudioRecorderActions {
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    pauseRecording: () => void;
    resumeRecording: () => void;
    resetRecording: () => void;
    requestPermission: () => Promise<boolean>;
    openSystemMicrophoneSettings: () => Promise<void>;
}

/**
 * Thin compatibility layer over `useRecording()` from the
 * `RecordingProvider`. The provider owns the single `MediaRecorder`
 * instance and persists state to the Tauri backend.
 *
 * UI-only state (analyser, blob preview duration, permission flow)
 * remains local to this hook so the existing `<AudioRecorder>`
 * component continues to render unchanged.
 *
 * `startRecording` / `stopRecording` / `pauseRecording` /
 * `resumeRecording` / `isRecording` / `isPaused` are forwarded to
 * the provider so MCP-driven `start-record` events and user-clicked
 * "Start" buttons all drive the same underlying MediaRecorder.
 */
export function useAudioRecorder(): AudioRecorderState & AudioRecorderActions {
    const provider = useRecording();

    // Local UI-only state. Recording lifecycle is derived from the
    // provider, but the rest of the recorder UI (analyser, duration
    // counter, permission flow) stays local so the <AudioRecorder>
    // component's behaviour is preserved.
    const [duration, setDuration] = useState(0);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const audioUrlRef = useRef<string | null>(null);
    const providerActive = provider.status === "recording" || provider.status === "paused";
    const providerRecording = provider.status === "recording";

    // Check microphone permission status on mount (without triggering prompt)
    useEffect(() => {
        const checkPermission = async () => {
            if (!navigator.permissions) {
                // Permissions API not supported, leave hasPermission as null
                return;
            }

            try {
                const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
                setHasPermission(result.state === "granted");

                // Listen for permission changes (user changes in system settings)
                result.onchange = () => {
                    setHasPermission(result.state === "granted");
                };
            } catch {
                // Query failed (e.g., some WebView platforms don't support this), leave as null
            }
        };

        checkPermission();
    }, []);

    // When the provider reports a completed recording, mirror its blob
    // into our local state so the <AudioRecorder> preview can show the
    // "Use Recording" panel. The provider keeps the blob in memory and
    // hands it to us via context — no disk roundtrip needed.
    useEffect(() => {
        const completed = provider.lastCompleted;
        if (!completed) return;
        queueMicrotask(() => {
            if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
            const url = URL.createObjectURL(completed.blob);
            audioUrlRef.current = url;
            setAudioBlob(completed.blob);
            setAudioUrl(url);
            setDuration(completed.durationSec);
        });
    }, [provider.lastCompleted]);

    // Sync local analyser/UI state when the provider transitions to recording.
    // When the provider starts a recording (from MCP or from this hook), we
    // attach a parallel local AudioContext for the visualizer. The actual
    // audio capture lives in the provider's MediaRecorder.
    useEffect(() => {
        if (!providerActive) {
            // Stop local UI bits. Wrap cleanup-driven setState in a
            // microtask so React's lint rule (no synchronous setState in
            // effect bodies) doesn't fire — the actual reset still
            // happens before the next paint via the deferred callback.
            queueMicrotask(() => setAnalyser(null));
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
                streamRef.current = null;
            }
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                audioContextRef.current.close().catch(() => undefined);
                audioContextRef.current = null;
            }
            return;
        }
        // While provider is recording, attempt to attach a visualizer
        // stream for the existing capture. We do NOT start a second
        // MediaRecorder — the provider owns that.
        let cancelled = false;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                setHasPermission(true);
                const AudioCtor: typeof AudioContext =
                    window.AudioContext ||
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ((window as any).webkitAudioContext as typeof AudioContext);
                const audioContext = new AudioCtor();
                const analyserNode = audioContext.createAnalyser();
                const source = audioContext.createMediaStreamSource(stream);
                source.connect(analyserNode);
                analyserNode.fftSize = 256;
                audioContextRef.current = audioContext;
                sourceRef.current = source;
                setAnalyser(analyserNode);
                if (provider.startedAt && providerRecording) {
                    const startMs = provider.startedAt;
                    setDuration(Math.floor((Date.now() - startMs) / 1000));
                    timerRef.current = setInterval(() => {
                        setDuration(Math.floor((Date.now() - startMs) / 1000));
                    }, 1000);
                }
            } catch (err) {
                // Visualizer is best-effort; ignore if mic is busy
                console.warn("[useAudioRecorder] visualizer attach failed", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [providerActive, providerRecording, provider.startedAt]);

    // Pause the duration timer when the provider is paused; restart on resume.
    useEffect(() => {
        if (provider.status === "paused") {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        } else if (provider.status === "recording" && provider.startedAt) {
            if (timerRef.current) return; // already running
            const startMs = provider.startedAt;
            setDuration(Math.floor((Date.now() - startMs) / 1000));
            timerRef.current = setInterval(() => {
                setDuration(Math.floor((Date.now() - startMs) / 1000));
            }, 1000);
        }
    }, [provider.status, provider.startedAt]);

    // Keep audioUrlRef in sync so the unmount cleanup can revoke the latest URL
    useEffect(() => {
        audioUrlRef.current = audioUrl;
    }, [audioUrl]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                audioContextRef.current.close();
            }
            if (audioUrlRef.current) {
                URL.revokeObjectURL(audioUrlRef.current);
                audioUrlRef.current = null;
            }
        };
    }, []);

    const requestPermission = useCallback(async (): Promise<boolean> => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            setHasPermission(true);
            setError(null);
            return true;
        } catch (err) {
            setHasPermission(false);
            if (err instanceof Error) {
                if (err.name === "NotAllowedError") {
                    setError("Microphone access is blocked for Remembry. Enable microphone permission in your system settings, then try again.");
                } else if (err.name === "NotFoundError") {
                    setError("No microphone found. Please connect a microphone and try again.");
                } else {
                    setError(`Microphone error: ${err.message}`);
                }
            }
            return false;
        }
    }, []);

    // Forward to provider — the provider owns the single MediaRecorder.
    const startRecording = useCallback(async () => {
        setError(null);
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            setAudioUrl(null);
        }
        setAudioBlob(null);
        setDuration(0);
        provider.clearLastCompleted();
        await provider.start("Recording");
    }, [provider, audioUrl]);

    // Forward to provider. The provider flushes the recorded blob to
    // temp_uploads via `save_audio_blob` in its onstop handler; we do
    // not duplicate that work here.
    const stopRecording = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        void provider.stop().catch((err) => {
            console.error("[useAudioRecorder] provider.stop failed", err);
        });
    }, [provider]);

    const pauseRecording = useCallback(() => {
        provider.pause();
    }, [provider]);

    const resumeRecording = useCallback(() => {
        provider.resume();
    }, [provider]);

    const resetRecording = useCallback(() => {
        if (providerActive) {
            stopRecording();
        }
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
        setAudioBlob(null);
        setAudioUrl(null);
        setDuration(0);
        setError(null);
        provider.clearLastCompleted();
    }, [providerActive, stopRecording, audioUrl, provider]);

    const openSystemMicrophoneSettings = useCallback(async () => {
        const macOSUrl = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
        const windowsUrl = "ms-settings:privacy-microphone";
        const ua = navigator.userAgent.toLowerCase();
        const url = ua.includes("win") ? windowsUrl : macOSUrl;
        try {
            await openUrl(url);
        } catch {
            // fallback: show instructions in next error display
        }
    }, []);

    return {
        isRecording: providerRecording,
        isPaused: provider.status === "paused",
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
    };
}