# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Remembry** is an AI-powered desktop application that transforms audio recordings into structured, searchable notes. Built with Tauri (Rust backend) and Next.js 16 (React frontend), it uses a pluggable multi-provider AI backend (Groq Whisper, OpenAI-compatible LLMs, Gemini fallback) for transcription and extraction, and SQLite for local storage.

## Tech Stack

- **Desktop Runtime**: Tauri 2.x (Rust backend + WebView frontend)
- **Frontend**: Next.js 16, React 19, Tailwind CSS v4, shadcn/ui (Radix UI)
- **AI**: Pluggable providers — Groq Whisper (transcription), Groq Llama 3.3 70B / custom OpenAI-compatible / Gemini fallback (extraction)
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
| `get_groq_key_status` | Check if Groq API key is configured |
| `save_groq_key` | Save Groq API key |
| `delete_groq_key` | Delete Groq API key |
| `get_provider_config` | Read active provider configuration (transcription + extraction backends, model choices) |
| `save_provider_config` | Persist provider config; embeds API keys for the keyring write |

### API Fetch Layer (`src/lib/apiFetch.ts`)

All frontend code uses `apiFetch('/api/...')` which maps to Tauri commands:

- Routes like `/api/meetings/:id` map to corresponding Tauri commands
- Non-Tauri environment: throws clear error `This build requires the Tauri desktop runtime.`
- Keeps existing UI code unchanged — no need to refactor page components

### AI Processing Pipeline (Rust)

The AI processing is split across provider modules:

- **`src-tauri/src/providers/`** — `ProviderConfig` and provider enums. Persisted as JSON in `data_local_dir()/remembry/providers.json`.
- **`src-tauri/src/transcription/`** — `Provider` enum with a `Groq(GroqWhisper)` variant. POSTs multipart audio to Groq's `/audio/transcriptions` endpoint.
- **`src-tauri/src/llm/`** — Generic `LlmClient` for any OpenAI-compatible chat-completion API (Groq, OpenCode Go, DeepSeek, OpenRouter, custom). Includes `extract_json()` convenience method.
- **`src-tauri/src/gemini/`** — Existing Gemini REST client (Files API upload + generateContent). Remains as fallback.
- **`src-tauri/src/commands/upload_providers.rs`** — `transcribe_with_provider`, `extract_meeting_notes_with_provider`, `extract_event_knowledge_with_provider`. The dispatchers the upload pipeline calls through.
- **`src-tauri/src/commands/fallback.rs`** — Wraps the dispatchers with `transcribe_with_fallback` / `extract_*_with_fallback`. On primary-provider failure, retries once with Gemini if a Gemini key is configured.
- **`src-tauri/src/prompts/`** — Shared extraction prompts (Gemini and any LLM provider call the same prompt builders).

The upload pipeline in `src-tauri/src/commands/uploads.rs` calls `commands::fallback::*_with_fallback(...)` instead of `gemini::*` directly. Swapping providers means changing `providers.json`, no Rust changes needed.

### Adding a new provider

To add a new transcription or extraction backend:

1. **Transcription**: implement a new variant in `src-tauri/src/transcription::Provider`. The `transcribe` method is the only required entry point.
2. **Extraction**: any OpenAI-compatible endpoint already works via the `OpenaiCompatible` config path. For a non-OpenAI shape, add a new variant to `src-tauri/src/llm::client.rs` or extend `LlmClient`.
3. **Frontend**: extend the `Select` options in `src/app/settings/page.tsx` (the backend already accepts any provider enum value).
4. **Tests**: add a test in `src-tauri/src/transcription/` or `src-tauri/src/llm/client.rs` that exercises the new code path with a mock or fixture.

### Fallback chain behavior

When the primary provider fails (429, network error, auth failure), `commands::fallback::*` retries once with Gemini if a Gemini key is configured. Error messages mention both attempts:

```
Both providers failed. Primary: <reason>. Gemini: <reason>
```

If only the primary provider is configured (no Gemini key), the error mentions that:

```
Primary failed (<reason>) and no Gemini key configured for fallback
```

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
- `/settings` — Gemini + Groq + custom provider configuration

## Local Development

### First Run

```bash
# Install dependencies
npm install

# Start Tauri development app
npm run tauri:dev
```

The app will open in a desktop window. On first run, go to **Settings** to enter your Gemini and/or Groq API key. Groq's free tier (Whisper Large v3 + Llama 3.3 70B) is enough for personal use.

### Provider Configuration

`/settings` exposes three cards:

1. **Gemini API Key** — fallback provider (Gemini 3 Flash for both transcription + extraction). Free key at [Google AI Studio](https://aistudio.google.com/app/apikey).
2. **Groq API Key** — free at [console.groq.com](https://console.groq.com/keys). Powers Whisper Large v3 transcription and Llama 3.3 70B extraction.
3. **Custom Provider** — any OpenAI-compatible endpoint (OpenCode Go, DeepSeek, OpenRouter, custom). Enter base URL + API key + model name.

API keys are stored in the OS credential store via `keyring` (separate slots: `local_user` for Gemini, `groq_local_user` for Groq). Provider settings (which backend to use, which model, custom provider URL) are persisted as JSON in `data_local_dir()/remembry/providers.json`.

### Build for Production

```bash
# Build Next.js static frontend (regenerates out/ for production Tauri bundles)
npm run build:tauri

# Build Tauri desktop bundle
npm run tauri:build
```

> **Dev mode:** `npm run tauri:dev` loads the app from `http://localhost:3010` (Next.js dev server) so frontend changes appear immediately with HMR. If the UI looks stale, restart `npm run tauri:dev` — rebuilding is not needed.

Desktop bundles (MSI/NSIS on Windows) will be in `src-tauri/target/release/bundle/`.