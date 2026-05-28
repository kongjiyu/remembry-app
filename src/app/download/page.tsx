import type { NextConfig } from "next";
import Image from "next/image";

const DOWNLOAD_URL = process.env.NEXT_PUBLIC_REMEMBRY_WINDOWS_DOWNLOAD_URL || "https://github.com/kongjiyu/remembry-app/releases/latest";

export default function DownloadPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <Image src="/remembry-logo.png" alt="Remembry" fill className="object-contain" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">Remembry</h1>
          <p className="text-xl text-muted-foreground">
            AI-powered meeting notes that transform audio recordings into structured, searchable insights.
          </p>
        </div>

        <div className="bg-card rounded-xl border p-8 mb-8 text-center">
          <h2 className="text-2xl font-semibold mb-2">Download for Windows</h2>
          <p className="text-muted-foreground mb-6">
            Install Remembry on your Windows machine. No account or internet required after setup.
          </p>
          <a
            href={DOWNLOAD_URL}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-medium px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 20.25v-13.5h7.5l9 9.75-9 9.75H3v-6zm15-2.25L13.5 13.5v5.25H18v-5.25z"/>
            </svg>
            Download Installer (.exe)
          </a>
          <p className="text-sm text-muted-foreground mt-3">
            Windows 10/11 &middot; ~50MB
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
                <p className="text-sm text-muted-foreground">Run the downloaded installer and open the app.</p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-shrink-0 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">2</span>
              <div>
                <p className="font-medium">Add your Gemini API key</p>
                <p className="text-sm text-muted-foreground">Go to Settings and paste a key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" className="text-primary hover:underline">Google AI Studio</a> (free tier available).</p>
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
          <a
            href="https://github.com/kongjiyu/remembry-app"
            target="_blank"
            rel="noopener"
            className="text-primary hover:underline"
          >
            View on GitHub
          </a>
          <span className="mx-2 text-muted-foreground">|</span>
          <span className="text-muted-foreground text-sm">Built with Tauri + Next.js + Gemini</span>
        </div>
      </div>
    </main>
  );
}

export const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};
