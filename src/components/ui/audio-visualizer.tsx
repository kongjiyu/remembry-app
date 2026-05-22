"use client";

import { useEffect, useRef } from "react";

interface AudioVisualizerProps {
    analyser: AnalyserNode | null;
    isRecording: boolean;
    className?: string;
}

// Get theme-appropriate muted line color
function getMutedLineColor(): string {
    const isDark = document.documentElement.classList.contains("dark");
    return isDark ? "oklch(0.98 0 0 / 0.35)" : "oklch(0.13 0.01 265 / 0.3)";
}

export function AudioVisualizer({ analyser, isRecording, className }: AudioVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !analyser || !isRecording) {
            // If not recording, clear canvas or show idle state
            if (canvas) {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    // Draw a straight line for idle state
                    const centerY = canvas.height / 2;
                    ctx.beginPath();
                    ctx.moveTo(0, centerY);
                    ctx.lineTo(canvas.width, centerY);
                    ctx.strokeStyle = getMutedLineColor();
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Configuration
        const barWidth = 4;
        const gap = 2;
        const maxBarHeight = canvas.height * 0.8;

        // We only need a subset of frequencies for voice (human voice is mostly low-mid)
        // bufferLength is usually 128 (fftSize/2).
        // Let's use the lower half which contains most voice frequencies
        const meaningfulDataLength = Math.floor(bufferLength * 0.7);

        // Helper for rounded rect
        function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
            if (height < radius * 2) radius = height / 2;
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fill();
        }

        const renderFrame = () => {
            animationRef.current = requestAnimationFrame(renderFrame);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const centerY = canvas.height / 2;
            const totalWidth = canvas.width;

            // Calculate number of bars that fit
            const totalBarSpace = barWidth + gap;
            const numBars = Math.floor(totalWidth / totalBarSpace);

            // Step size to sample the data array
            const step = Math.floor(meaningfulDataLength / numBars) || 1;

            // Get theme color for bars
            const isDark = document.documentElement.classList.contains("dark");
            const barColor = isDark ? "oklch(0.98 0 0)" : "oklch(0.13 0.01 265)";

            for (let i = 0; i < numBars; i++) {
                const dataIndex = Math.floor(i * step);
                // Get value and scale it
                // Using a slight curve to emphasize center frequencies if desired,
                // but linear mapping is fine for now.
                const value = dataArray[dataIndex] || 0;

                // Scale value (0-255) to bar height
                // Add a small base height so bars are always visible
                let barHeight = (value / 255) * maxBarHeight;
                if (barHeight < 2) barHeight = 2;

                // Center x position
                const x = i * totalBarSpace + (totalWidth - (numBars * totalBarSpace)) / 2;

                // Draw rounded bar with theme color
                ctx.fillStyle = barColor;

                // Draw symmetric bar (up and down from center)
                // Top half
                drawRoundedRect(ctx, x, centerY - barHeight / 2, barWidth, barHeight, barWidth / 2);
            }
        };

        renderFrame();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [analyser, isRecording]);

    return (
        <canvas
            ref={canvasRef}
            width={300}
            height={100}
            className={className}
        />
    );
}
