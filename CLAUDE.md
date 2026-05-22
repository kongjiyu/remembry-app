# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Remembry** is an AI-powered desktop application that transforms audio recordings into structured, searchable notes. Built with Tauri (Rust backend) and Next.js 16 (React frontend), it uses Gemini AI for transcription and extraction, and SQLite for local storage.

## Tech Stack

- **Desktop Runtime**: Tauri 2.x (Rust backend + WebView frontend)
- **Frontend**: Next.js 16, React 19, Tailwind CSS v4, shadcn/ui (Radix UI)
- **AI**: Google Gemini 3 Flash (`gemini-3-flash-preview`) via `@google/genai` (Rust)
- **Database**: SQLite via `rusqlite` (local storage, no cloud)
- **Styling**: Tailwind CSS + CSS variables (no `tailwind.config.js` - configured via CSS)

## Commands

```bash
npm run tauri:dev    # Start Tauri development app
npm run tauri:build  # Build desktop bundle (MSI/NSIS)
npm run build:tauri   # Build Next.js static frontend (TAURI_STATIC_EXPORT=1)
npm run lint         # Run ESLint
npm run test:run     # Run unit tests
```

## Architecture

### Tauri Commands (Rust Backend)

All data operations go through Tauri commands registered in `src-tauri/src/`:

| Command | Description |
|---------|-------------|
| `list_projects` | List all projects |
| `create_project` | Create a new project |
| `delete_project` | Delete a project |
| `list_meetings` | List meetings (optional `project_id` filter) |
| `get_meeting` | Get meeting details |
| `get_meeting_metadata` | Get meeting metadata |
| `get_meeting_notes` | Get extracted notes for a language |
| `extract_meeting_notes` | Trigger note extraction |
| `regenerate_meeting_notes` | Regenerate notes with different language |
| `get_gemini_key_status` | Check if Gemini API key is configured |
| `save_gemini_key` | Save Gemini API key |
| `delete_gemini_key` | Delete Gemini API key |
| `upload_audio` | Upload audio file and start processing |

### API Fetch Layer (`src/lib/apiFetch.ts`)

All frontend code uses `apiFetch('/api/...')` which maps to Tauri commands:

- Routes like `/api/meetings/:id` map to corresponding Tauri commands
- Non-Tauri environment: throws clear error `This build requires the Tauri desktop runtime.`
- Keeps existing UI code unchanged — no need to refactor page components

### AI Processing Pipeline (Rust)

The Gemini AI processing lives in `src-tauri/src/gemini.rs`:
- **Transcription**: uploads audio to Gemini Files API, polls, then transcribes
- **Notes Extraction**: generates structured JSON with summary, action items, decisions, Q&A
- **Retry Logic**: exponential backoff for rate limits (429), network errors, 500s

### Data Storage (SQLite)

Local SQLite database stored in app data directory:
- `projects` table: id, display_name, color, created_at
- `meetings` table: id, project_id, title, context, file_name, transcription (JSON), notes_by_language (JSON), default_language
- `user_gemini_keys` table: user_id, gemini_api_key, usage stats

### Pages / Routing

UI routes are standard Next.js App Router pages. Dynamic entity pages use query parameters (`?id=...`) to support Next.js static export in Tauri:

- `/dashboard` — Main dashboard with project cards and quick actions
- `/meetings` — List all meetings, filter by project
- `/meetings/new` — Create new meeting (upload or record)
- `/meetings/detail?id=...` — Meeting detail with transcript/notes tabs
- `/meetings/extract?id=...` — Extract notes view
- `/projects` — Project management
- `/projects/detail?id=...` — Project detail
- `/settings` — Gemini API key configuration

## Local Development

### First Run

```bash
# Install dependencies
npm install

# Start Tauri development app
npm run tauri:dev
```

The app will open in a desktop window. On first run, go to **Settings** to enter your Gemini API key.

### Gemini API Key

Users save their personal Gemini API key via `/settings` page (stored in SQLite `user_gemini_keys` table). Get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).

### Build for Production

```bash
# Build Next.js static frontend (regenerates out/ for production Tauri bundles)
npm run build:tauri

# Build Tauri desktop bundle
npm run tauri:build
```

> **Dev mode:** `npm run tauri:dev` loads the app from `http://localhost:3010` (Next.js dev server) so frontend changes appear immediately with HMR. If the UI looks stale, restart `npm run tauri:dev` — rebuilding is not needed.

Desktop bundles (MSI/NSIS on Windows) will be in `src-tauri/target/release/bundle/`.