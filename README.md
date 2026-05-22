<p align="center">
  <img src="./public/logo.svg" alt="Remembry" width="120" />
</p>

<p align="center">
  <img alt="Typing animation" src="https://readme-typing-svg.demolab.com?font=Avenir&weight=700&size=24&duration=2200&pause=900&color=8B5CF6&center=true&vCenter=true&width=780&lines=AI-Powered+Meeting+Notes;Transform+Recordings+into+Structured+Notes;Search+Across+All+Your+Meetings">
</p>

<p align="center">
  <a href="https://nextjs.org/"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white"></a>
  <a href="https://tauri.app/"><img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black"></a>
  <a href="https://www.rust-lang.org/"><img alt="Rust" src="https://img.shields.io/badge/Rust-1.75+-000?logo=rust&logoColor=white"></a>
  <a href="https://ai.google.dev/"><img alt="Gemini" src="https://img.shields.io/badge/Gemini-3+Flash-92003B?logo=google&logoColor=white"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/Deploy-Self--hosted-FF6B6B">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green">
</p>

<p align="center">
  <strong>Remembry</strong> is a self-hosted AI-powered meeting notes desktop application. Meeting data is stored locally, while transcription and note generation use the Gemini API.
</p>

---

## Features

- **Audio recording** - Record directly in-app with microphone support.
- **File upload** - Upload MP3, WAV, M4A, WebM, or MP4 files.
- **AI transcription** - Generate transcripts with speaker diarization.
- **Smart extraction** - Extract summaries, decisions, action items, Q&A pairs, and key points.
- **Multi-language notes** - Generate notes in multiple output languages.
- **Local storage** - Store projects, meetings, notes, transcripts, and settings in a local SQLite database.

---

## Screenshots

| Page | Preview |
|------|---------|
| **Dashboard** | ![Dashboard](./public/01-home.png) |
| **Meetings List** | ![Meetings](./public/02-meetings.png) |
| **Upload Meeting** | ![New Meeting](./public/03-new-meeting.png) |
| **Settings** | ![Settings](./public/04-settings.png) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop runtime | Tauri 2.x |
| Backend | Rust |
| Frontend | Next.js 16, React 19, Tailwind CSS v4, shadcn/ui |
| AI | Google Gemini |
| Database | SQLite |

---

## Developer Quick Start

### Prerequisites

Install these before running the app:

- Node.js `20.9.0` or later. Next.js 16 will not run on Node 18.
- npm, included with Node.js.
- Rust `1.75` or later, including `cargo`.
- Tauri 2 system prerequisites for your OS.
  - Windows: Microsoft C++ Build Tools and WebView2 Runtime.
  - macOS/Linux: follow the official Tauri prerequisites for your platform.
- Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Run the App

```bash
git clone https://github.com/kongjiyu/remembry.git
cd remembry
npm install
npm run tauri:dev
```

`npm run tauri:dev` starts the Next.js dev server through Tauri and opens the desktop app.

After the app opens:

1. Go to **Settings**.
2. Paste your Gemini API key.
3. Click **Save**.
4. Create a project, then upload or record a meeting.

The Gemini key is stored in the operating system credential store through the Rust backend. A `.env.local` file is not required for normal development.

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run tauri:dev` | Start the Tauri desktop app in development mode. |
| `npm run tauri:build` | Build the production desktop bundle. |
| `npm run build:tauri` | Build the exported Next.js frontend only. |
| `npm run lint` | Run ESLint. |
| `npm run test:run` | Run unit tests once. |
| `npm run test` | Run Vitest in watch mode. |

### Notes for Developers

- `npm run tauri:dev` loads the app from `http://localhost:3010` (the Next.js dev server) for live frontend changes with HMR.
- `npm run build` (or `npm run build:tauri`) is only needed to regenerate the static `out/` directory for production Tauri builds.
- If the frontend looks stale in the Tauri window, restart `npm run tauri:dev` — do not rebuild.
- Do not use `npm run dev` as the main app entry point. It only starts the Next.js frontend in a browser, where Tauri commands are unavailable.
- If upload or note generation fails with a missing API key error, reopen **Settings** and save the key again.
- If Windows build tooling is missing, Tauri/Rust compilation may fail before the app window opens.

---

## User Guide

### Step 1: Save Your API Key

1. Open **Settings** from the sidebar.
2. Enter your Gemini API key.
3. Click **Save**.

![Settings](./public/04-settings.png)

### Step 2: Create a Project

1. Click **New Project** on the Dashboard.
2. Enter a project name, such as "Team Meeting" or "Client Call".
3. Choose a color.
4. Click **Create**.

### Step 3: Upload a Recording

1. Click **Upload** on the sidebar or Dashboard.
2. Select a project.
3. Enter a meeting title.
4. Select an audio or video file.
5. Click **Upload Recording**.

![Upload](./public/03-new-meeting.png)

### Step 4: View Meeting Notes

1. Go to **Meetings** from the sidebar.
2. Click a meeting card.
3. Switch between **Meeting Notes** and **Transcript**.
4. Use the language selector to view generated notes in another language.

![Meeting Detail](./public/06-meeting-detail.png)

The Meeting Notes tab includes:

- Summary
- Action items
- Decisions
- Q&A
- Key points

---

## How It Works

```text
Record or upload -> Transcribe with Gemini -> Extract structured notes with Gemini -> Store locally in SQLite
```

---

## Project Structure

```text
remembry/
├── src/                      # Next.js frontend
│   ├── app/                  # App Router pages
│   ├── components/           # UI components
│   ├── hooks/                # Custom React hooks
│   └── lib/                  # Client utilities
├── src-tauri/                # Tauri/Rust backend
│   ├── src/
│   │   ├── commands/         # Tauri commands
│   │   ├── db/               # SQLite database operations
│   │   ├── gemini/           # Gemini AI integration
│   │   ├── secrets/          # OS credential store integration
│   │   └── lib.rs            # Command registration
│   └── Cargo.toml
├── public/                   # Static assets and screenshots
├── package.json
└── next.config.ts
```

---

## FAQ

**Do I need a Gemini API key?**

Yes. Remembry uses Gemini for transcription and note generation. Get a key from [Google AI Studio](https://aistudio.google.com/app/apikey).

**Where is my data stored?**

Projects, meetings, generated notes, transcripts, and app metadata are stored in a local SQLite database managed by the Tauri app. The Gemini API key is stored in the operating system credential store.

**Does meeting content leave my machine?**

Meeting files and transcript content are sent to Gemini when you ask Remembry to transcribe or generate notes. Stored app data remains local.

**Why not run `npm run dev` directly?**

The frontend can render in a browser, but most app operations depend on Tauri commands. Use `npm run tauri:dev` for real development.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
