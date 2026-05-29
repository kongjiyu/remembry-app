"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

const VERSION = "v0.3.1";
const GITHUB_REPO = "https://github.com/kongjiyu/remembry-app";

const ASSETS = {
  windows: `${GITHUB_REPO}/releases/download/${VERSION}/Remembry_0.3.1_x64-setup.exe`,
};

function detectPlatform(): string {
  if (typeof window === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "windows";
}

export default function DownloadPage() {
  const [platform, setPlatform] = useState<string>("windows");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detectPlatform());
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <Image src="/remembry-logo.png" alt="Remembry" fill className="object-contain" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Remembry</h1>
          <p className="text-xl text-muted-foreground">
            Turn every recording into searchable memory.
          </p>
        </div>

        <div className="bg-card rounded-xl border p-8 mb-8 text-center">
          <h2 className="text-2xl font-semibold mb-2">Download Remembry</h2>
          <p className="text-muted-foreground mb-6">
            Install the desktop app on your machine. No account or internet required after setup.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
            {platform === "macos" ? (
              <a
                href={`${GITHUB_REPO}/releases`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.91 1.33-.34 2.61-.41 3.05-.43l.93-.03h.93v6.75c.01.81.08 1.54.26 2.16.28.91 1.01 1.51 2.09 1.51.73 0 1.4-.25 1.94-.65l.05.09.08.1v3.08h3.61v-.01c.28-.14.54-.32.79-.52.17-.14.33-.29.47-.45 1.36-1.58 1.7-3.77.95-5.64l-.04.04zm-6.03-3.25c-.47-.01-.94.09-1.4.27-.47.18-.87.47-1.19.82-.32.35-.55.77-.66 1.21-.11.44-.09.9.05 1.33.13.44.4.84.76 1.12.36.28.8.46 1.27.49.47.03.93-.09 1.33-.32.4-.23.73-.58.96-1.01.23-.43.32-.91.27-1.38-.05-.47-.26-.91-.58-1.24-.32-.33-.73-.56-1.17-.65l-.04-.04zm-3.56 1.77c-.29 0-.58.05-.85.17-.27.12-.5.29-.69.5-.19.21-.33.47-.42.74-.09.28-.09.57.01.84.1.28.28.52.51.69.23.18.51.28.81.29.3.01.59-.07.85-.23.26-.16.46-.39.59-.67.13-.28.17-.58.11-.88-.06-.3-.22-.56-.45-.76-.23-.2-.51-.32-.81-.35l-.15-.03.49-.31z"/>
                </svg>
                View macOS releases
              </a>
            ) : (
              <a
                href={ASSETS.windows}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 20.25v-13.5h7.5l9 9.75-9 9.75H3v-6zm15-2.25L13.5 13.5v5.25H18v-5.25z"/>
                </svg>
                Download for Windows (.exe)
              </a>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            {platform === "macos"
              ? "macOS build is created locally — see releases for DMG"
              : "Windows installer recommended."}
            {" "}
            <a href={`${GITHUB_REPO}/releases`} target="_blank" rel="noopener" className="text-primary hover:underline">
              View all releases
            </a>
          </p>
        </div>

        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4">Features</h3>
          <ul className="grid gap-3">
            {[
              "Record or upload audio — MP3, WAV, M4A, WebM, MP4 supported",
              "AI transcription with speaker diarization",
              "Extract summaries, decisions, action items, Q&A, and key points",
              "Generate notes in 12+ languages",
              "100% local storage — your data never leaves your machine",
            ].map((f) => (
              <li key={f} className="flex items-start gap-3">
                <span className="text-primary mt-1">&#10003;</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card rounded-xl border p-8 mb-8">
          <h3 className="text-lg font-semibold mb-4">Setup in 3 Steps</h3>
          <ol className="space-y-4">
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">1</span>
              <div>
                <p className="font-medium">Install and launch Remembry</p>
                <p className="text-sm text-muted-foreground">Download and run the installer for your platform.</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">2</span>
              <div>
                <p className="font-medium">Add your Gemini API key</p>
                <p className="text-sm text-muted-foreground">
                  Go to Settings and paste a key from{" "}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" className="text-primary hover:underline">
                    Google AI Studio
                  </a>{" "}
                  (free tier available).
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">3</span>
              <div>
                <p className="font-medium">Upload or record your first event</p>
                <p className="text-sm text-muted-foreground">Create a project, then upload an audio file or record directly in-app.</p>
              </div>
            </li>
          </ol>
        </div>

        <div className="text-center">
          <a href={GITHUB_REPO} target="_blank" rel="noopener" className="text-primary hover:underline">
            View on GitHub
          </a>
          <span className="mx-2 text-muted-foreground">|</span>
          <span className="text-muted-foreground text-sm">Built with Tauri + Next.js + Gemini</span>
        </div>
      </div>
    </main>
  );
}

