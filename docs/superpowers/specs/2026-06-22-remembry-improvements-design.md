# Remembry Improvements — Design Spec

**Date:** 2026-06-22
**Status:** Draft (pending user review)
**Author:** Brainstorming session with Cstan0824

## Context

Remembry is a Tauri + Next.js desktop app that records audio and extracts structured notes via Gemini. We have 3 open GitHub issues (`#5`, `#6`, `#7`), a need for project-level note authoring, and a broken download button for live recordings. The work is split into 6 atomic commits, each shippable and buildable.

## Goals

1. **Stop losing recordings** when Gemini returns 5xx errors (issue #5).
2. **Stop recording state from dying** when the user navigates between pages (issue #6).
3. **Make MCP recording tools actually work** — they exist but track placeholder state (issue #7).
4. **Let users author project notes** in-app — markdown editor + text-file import.
5. **Fix the download button** on live-recorded audio so it saves to the user's Downloads folder.
6. **Polish UI** — empty states, toasts, skeletons, a11y.

## Non-goals

- No cloud sync / multi-device — still local-only SQLite.
- No PDF/DOCX import for notes (text-only: `.txt`, `.md`).
- No team / sharing features.
- No note-level AI summarization in this pass (can be added later).

---

## Commit 1 — `fix(uploads): add audio download command for recorded files`

### Problem
The Download icon at `src/app/events/new/page.tsx:554` only works for fresh browser uploads (it downloads a Blob URL). When the audio came from a recording, there's no working path to save it to the user's filesystem.

### Design

**New Tauri command** in `src-tauri/src/commands/notes.rs` (or a new `download.rs`):
```rust
#[tauri::command]
pub async fn download_audio(
    source_path: String,
    suggested_filename: Option<String>,
) -> Result<String, String> {
    // 1. Validate source_path lives under our app data dir (security).
    // 2. Resolve Downloads dir via `dirs` crate (cross-platform).
    // 3. Copy file to ~/Downloads/Remembry/YYYY-MM-DD_<suggested_filename>.
    // 4. Return the saved path so UI can show a toast.
}
```

**Frontend wiring:** replace the `<a download>` for recording-sourced files with a Tauri invoke. Show a Sonner toast on success: `"Saved to ~/Downloads/Remembry/idea-discussion-2026-06-22.webm"`.

### Tests (TDD)
- `download_audio` copies file when source exists, returns saved path.
- Rejects paths outside `app_data_dir` (path traversal guard).
- Creates `~/Downloads/Remembry/` if missing.
- Filename collision: appends `-1`, `-2`, etc.

### Files touched
- `src-tauri/src/commands/download.rs` (new)
- `src-tauri/src/commands/mod.rs` (register)
- `src-tauri/src/lib.rs` (invoke handler)
- `src/lib/apiFetch.ts` (add `/api/audio/download` route mapping)
- `src/app/events/new/page.tsx` (wire Download icon)

---

## Commit 2 — `feat(uploads): write audio to local temp before Gemini upload, surface failed jobs` (Issue #5)

### Problem
Recording streams directly to Gemini with no local cache. A 503 response discards the audio permanently. Issue #5: "Idea Discussion" recording — total loss.

### Design

**Upload pipeline changes** in `src-tauri/src/commands/uploads.rs`:
1. As soon as `upload_audio` is called, write the incoming bytes to `app_data_dir/temp_uploads/<job_id>.webm` (or `.txt` for transcripts).
2. Persist `temp_path` on the `upload_jobs` row immediately.
3. After successful Gemini upload + transcription, keep the temp file (mark `keep_until` in metadata) for 7 days, then GC.
4. On Gemini 5xx/429/network failure: keep temp file, mark `status='failed'`, store error message. Auto-retry once with exponential backoff (2s, 8s) for retryable errors. After final failure, leave the file recoverable.

**UI changes** in `src/app/events/page.tsx`:
- New filter chip: **Failed** (count badge).
- Failed jobs show: title, timestamp, error message, **Retry** and **Download Audio** buttons.

**Retry Tauri command:**
```rust
#[tauri::command]
pub async fn retry_upload(job_id: String) -> Result<UploadJob, String>
```
Validates job is in `failed` state, has `temp_path`, file still exists on disk, then re-runs the existing pipeline from the temp file (no re-upload to Gemini if `gemini_file_name` is already cached).

### Tests (TDD)
- `upload_jobs::upsert_upload_job` persists `temp_path`.
- `uploads::process_upload` with mocked Gemini 503 → row gets `status='failed'`, `temp_path` preserved, file still on disk.
- `uploads::retry_upload` happy path (status='queued'), missing file error path.
- DB unit test: list failed jobs returns only `status='failed'` rows.

### Files touched
- `src-tauri/src/db/upload_jobs.rs` (add columns if missing; use existing `temp_path`)
- `src-tauri/src/commands/uploads.rs` (write-to-temp first; retry command)
- `src/app/events/page.tsx` (Failed filter + Retry/Download buttons)

---

## Commit 3 — `feat(recording): move recording state to Tauri main, add persistent top-center toast` (Issue #6)

### Problem
Recording state is React component-local. Navigate away → component unmounts → MediaRecorder may stop, no indicator shows the recording is active. Issue #6.

### Design

**Rust side** — `src-tauri/src/api/state.rs`:
```rust
pub struct ApiState {
    pub app: AppHandle,
    pub last_request: Mutex<Instant>,
    pub recording: Mutex<Option<RecordingSession>>,
}

pub struct RecordingSession {
    pub job_id: String,
    pub title: String,
    pub started_at: Instant,
    pub audio_path: PathBuf,
}
```

**New Tauri commands:**
```rust
#[tauri::command]
pub async fn start_recording(title: String) -> Result<RecordingSession, String>
#[tauri::command]
pub async fn stop_recording() -> Result<Option<String>, String>  // returns saved audio path
#[tauri::command]
pub async fn get_recording_state() -> Result<Option<RecordingSession>, String>
```

**Frontend** — `src/components/layout/recording-toast.tsx` (new):
- Uses `sonner` (already in `dashboard-layout.tsx:16`) with custom JSX.
- Polls `get_recording_state()` every 2s while mounted.
- Renders a **top-center toast** when state is `Some(session)`:
  - Card style matching reference image: dark bg, rounded, border, shadow.
  - 🔴 pulsing dot, title `"Recording: <session.title>"`, live duration timer (mm:ss, updates each second), Stop button.
- Dismisses cleanly when state returns `None`.
- Mounted once in `DashboardLayout` so it survives all navigation.

**Recording path tracking:** the existing `useAudioRecorder` hook saves to a Blob; refactor it to also call a Tauri command `save_audio_to_temp(blob_bytes, job_id)` so the file lives in `app_data_dir/temp_uploads/` while recording. This unblocks Commit 1 (download) and Commit 4 (upload recovery).

**Recorder location move:** Because the toast must survive navigation AND the MCP bridge needs to be live on every page, the `useAudioRecorder` hook itself moves from page-scoped to a root-level `RecordingProvider` (`src/components/layout/recording-provider.tsx`). The recording UI on `/events/new` reads from this provider. When no recording is active, no UI shows. This is what makes MCP-initiated recording from any page possible.

### Tests (TDD)
- `ApiState::start_recording` returns session; second call returns error.
- `ApiState::stop_recording` returns saved path; clears state.
- `RecordingToast` renders when state is recording, returns null when idle.
- Toast duration timer increments correctly (mock `Date.now` or use vi.useFakeTimers).

### Files touched
- `src-tauri/src/api/state.rs` (add recording Mutex)
- `src-tauri/src/commands/recording.rs` (new — start/stop/get_state commands)
- `src-tauri/src/lib.rs` (register commands)
- `src/components/layout/recording-provider.tsx` (new — root-scoped MediaRecorder)
- `src/components/layout/recording-toast.tsx` (new)
- `src/components/layout/dashboard-layout.tsx` (mount toast)
- `src/hooks/useAudioRecorder.ts` (refactor to be provider-owned; save to temp on stop)
- `src/app/events/new/page.tsx` (read recorder state from provider instead of owning it)

---

## Commit 4 — `fix(mcp): make recording tools track real state, fix HTTP error handling` (Issue #7)

### Problem
- `recording_status` always returns `"idle"` placeholder (`src-tauri/src/api/routes.rs:67-75`).
- MCP `apiFetch()` in `mcp/src/index.ts:1099` does `await res.json()` without checking `res.ok` — silent failures.
- `useRecordingBridge` only mounts on `/events/new` page (`src/app/events/new/page.tsx:301`) — MCP "start" event has no listener after navigation.

### Design

**Rust fix:** Replace placeholder `recording_status` in `src-tauri/src/api/routes.rs` with one that reads from `ApiState.recording`. On state change, emit a Tauri event `recording-state-changed` so MCP can subscribe (push instead of poll).

```rust
pub async fn recording_status(State(state): State<Arc<ApiState>>) -> Json<Value> {
    let guard = state.recording.lock().await;
    match guard.as_ref() {
        Some(s) => Json(json!({
            "status": "recording",
            "job_id": s.job_id,
            "title": s.title,
            "started_at": s.started_at.elapsed().as_secs(),
        })),
        None => Json(json!({ "status": "idle" })),
    }
}
```

**MCP fix** in `mcp/src/index.ts`:
```ts
async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}
```

**Frontend fix:** Move the `useRecordingBridge` listener to the **root layout** (`src/app/layout.tsx` or a dedicated `RecordingBridgeProvider`) so it registers once at app boot, not per-page.

### Tests (TDD)
- `routes::recording_status` returns `"recording"` after start, `"idle"` after stop (mocked state).
- MCP `apiFetch` throws on 4xx/5xx with status in message.
- `RecordingBridgeProvider` registers listeners on mount, unregisters on unmount.

### Files touched
- `src-tauri/src/api/routes.rs` (real status)
- `src-tauri/src/api/state.rs` (emit on state change)
- `src/components/layout/recording-bridge-provider.tsx` (new — root-level bridge)
- `src/app/layout.tsx` (wrap with provider)
- `src/hooks/useRecordingBridge.ts` (deprecate page-level usage)
- `mcp/src/index.ts` (apiFetch error handling)

---

## Commit 5 — `feat(notes): add Notes sidebar tab with markdown editor and text-file import`

### Problem
Users can't author project notes — only AI-extracted notes from recordings exist. Issue: write/import notes into projects.

### Design

**Sidebar entry** in `src/components/layout/app-sidebar.tsx`:
```ts
import { NotebookPen } from "lucide-react";
const navItems = [
  // ... existing
  { title: "Notes", url: "/notes", icon: NotebookPen },
];
```

**New page** `src/app/notes/page.tsx` — mirrors `src/app/events/page.tsx`:
- Card grid: each note shows project badge, title, snippet (first 200 chars), updated_at.
- Filter chips: All / project filter.
- "New Note" button → dialog with:
  - Project picker (combobox)
  - Title input
  - Markdown editor (`@uiw/react-md-editor` — install as dep)
  - Save / Cancel
- "Import" button → file picker accepting only `.txt`/`.md`. Read content, sniff first 512 bytes for null bytes (reject binaries), create Document row.

**Detail view** `src/app/notes/detail?id=...` — full markdown view + edit.

**Tauri commands** in `src-tauri/src/commands/documents.rs` (new — wire existing `db/documents.rs`):
```rust
#[tauri::command] pub async fn list_documents(project_id: Option<String>) -> Result<Vec<Document>, String>
#[tauri::command] pub async fn create_document(project_id: String, display_name: String, content: String, mime_type: String) -> Result<Document, String>
#[tauri::command] pub async fn update_document(id: String, display_name: Option<String>, content: Option<String>) -> Result<Document, String>
#[tauri::command] pub async fn delete_document(id: String) -> Result<(), String>
#[tauri::command] pub async fn import_text_file(path: String, project_id: String) -> Result<Document, String>
```

### Tests (TDD)
- `documents::create_document` round-trip: insert → list → get.
- `import_text_file` rejects binary (null byte in first 512 bytes).
- `import_text_file` rejects `.pdf`/`.docx` extensions.
- Page renders note list (mocked fetch).

### Files touched
- `src/components/layout/app-sidebar.tsx` (add Notes)
- `src/app/notes/page.tsx` (new)
- `src/app/notes/detail/page.tsx` (new)
- `src-tauri/src/commands/documents.rs` (new — wire DB)
- `src-tauri/src/db/documents.rs` (remove `#[allow(dead_code)]`)
- `src/lib/apiFetch.ts` (add /api/documents/* routes)
- `package.json` (add `@uiw/react-md-editor`)

---

## Commit 6 — `chore(ui): empty states, toasts, skeletons, a11y polish`

### Scope
- Empty states for: no projects, no events, no notes, no failed jobs, no search results. Each shows icon + helpful copy + primary CTA.
- Sonner toasts on: note save/delete, import success/failure, retry success/failure, download audio success.
- Loading skeletons for: events list, notes list, project detail.
- A11y pass: focus rings on all interactive elements, aria-labels on icon-only buttons, keyboard nav for recording start/stop (Ctrl+R), skip-to-content link.
- Consistent icon set: lucide only (no mixed icon libraries).

### Tests
- Snapshot test for empty-state components.
- A11y audit with axe-core on key pages.

### Files touched
- `src/components/ui/empty-state.tsx` (new)
- `src/components/ui/skeleton.tsx` (new if missing)
- Various page files (apply empty states + toasts)
- `src/app/globals.css` (focus ring tokens)

---

## Build gate between commits

For each commit:
1. `npm run lint` — pass
2. `npm run build:tauri` — pass (Next.js static export + TypeScript)
3. Backend Rust unit tests (`cargo test --lib` for relevant modules) — pass

We skip `npm run tauri:build` between commits (slow) — only run at the end before push.

## Dependency order rationale

1. **Download first** — smallest, unblocks the download button for the audio persistence test.
2. **Audio persistence** — depends on having a save-to-temp path; provides the data layer for retry.
3. **Recording state toast** — depends on Commit 2's temp-file flow.
4. **MCP fix** — depends on Commit 3's Tauri-side recording state.
5. **Notes feature** — independent, can come after recording is solid.
6. **UI polish** — last, benefits from all features being in place.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Path traversal in download command | Validate source_path starts with `app_data_dir`; reject otherwise |
| Audio blob URL leakage on reload | Convert to Tauri-managed temp file at recording stop (Commit 3) |
| Sonner toast position not matching image | Use `position="top-center"` + custom card JSX with dark theme |
| Markdown editor bundle size | Lazy-load `@uiw/react-md-editor` only on `/notes/*` pages |
| Breaking change to MCP response shape | Keep existing fields, add new ones (backward compatible) |

## Open questions

- Should notes support a "linked event" relationship (attach a note to a specific event)? *Out of scope for this pass; can add later.*
- Should the recording toast be dismissible? *No — should persist until recording actually stops; user can navigate to recording page for explicit stop.*
