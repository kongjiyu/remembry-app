"use client";

import { useState, useRef, useCallback, useEffect } from "react";

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
}

export function useAudioRecorder(): AudioRecorderState & AudioRecorderActions {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [duration, setDuration] = useState(0);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

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

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
        };
    }, [audioUrl]);

    const requestPermission = useCallback(async (): Promise<boolean> => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            setHasPermission(true);
            setError(null);
            return true;
        } catch (err) {
            setHasPermission(false);
            if (err instanceof Error) {
                if (err.name === "NotAllowedError") {
                    setError("Microphone access was denied. Please allow microphone access in your browser settings.");
                } else if (err.name === "NotFoundError") {
                    setError("No microphone found. Please connect a microphone and try again.");
                } else {
                    setError(`Microphone error: ${err.message}`);
                }
            }
            return false;
        }
    }, []);

    const startRecording = useCallback(async () => {
        try {
            setError(null);
            chunksRef.current = [];

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            streamRef.current = stream;
            setHasPermission(true);

            // Setup Audio Analysis
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const analyserNode = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyserNode);
            
            analyserNode.fftSize = 256;
            audioContextRef.current = audioContext;
            sourceRef.current = source;
            setAnalyser(analyserNode);

            // Try WebM first (better quality), fall back to alternatives
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/webm")
                    ? "audio/webm"
                    : "audio/mp4";

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                // Stop timer first
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                    timerRef.current = null;
                }

                const blob = new Blob(chunksRef.current, { type: mimeType });
                setAudioBlob(blob);

                // Revoke previous URL if exists
                if (audioUrl) {
                    URL.revokeObjectURL(audioUrl);
                }

                const url = URL.createObjectURL(blob);
                setAudioUrl(url);

                setIsRecording(false);
                setIsPaused(false);

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());

                // Close Audio Context
                if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                    audioContextRef.current.close();
                }
                setAnalyser(null);
            };

            mediaRecorder.onerror = () => {
                setError("Recording error occurred. Please try again.");
                setIsRecording(false);
                setIsPaused(false);
            };

            mediaRecorder.start(1000); // Collect data every second
            setIsRecording(true);
            setIsPaused(false);
            setDuration(0);

            // Start timer
            timerRef.current = setInterval(() => {
                setDuration(prev => prev + 1);
            }, 1000);

        } catch (err) {
            setHasPermission(false);
            if (err instanceof Error) {
                if (err.name === "NotAllowedError") {
                    setError("Microphone access was denied. Please allow microphone access.");
                } else if (err.name === "NotFoundError") {
                    setError("No microphone found. Please connect a microphone.");
                } else {
                    setError(`Failed to start recording: ${err.message}`);
                }
            }
        }
    }, [audioUrl]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setIsPaused(false);

            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
    }, [isRecording]);

    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording && !isPaused) {
            mediaRecorderRef.current.pause();
            setIsPaused(true);

            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
    }, [isRecording, isPaused]);

    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording && isPaused) {
            mediaRecorderRef.current.resume();
            setIsPaused(false);

            timerRef.current = setInterval(() => {
                setDuration(prev => prev + 1);
            }, 1000);
        }
    }, [isRecording, isPaused]);

    const resetRecording = useCallback(() => {
        if (isRecording) {
            stopRecording();
        }

        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }

        setAudioBlob(null);
        setAudioUrl(null);
        setDuration(0);
        setError(null);
        chunksRef.current = [];
    }, [isRecording, stopRecording, audioUrl]);

    return {
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
    };
}
