# @cstan0824/remembry-mcp

[![npm version](https://img.shields.io/npm/v/@cstan0824/remembry-mcp)](https://www.npmjs.com/package/@cstan0824/remembry-mcp)
[![license](https://img.shields.io/npm/l/@cstan0824/remembry-mcp)](https://opensource.org/licenses/MIT)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that connects AI assistants to [Remembry](https://github.com/kongjiyu/remembry-app), an AI-powered meeting knowledge base. Query meetings, manage projects, search action items, and organize your recordings — all through natural conversation with your AI assistant.

## Features

- **24 MCP tools** — full CRUD for projects, events, knowledge, documents, transcriptions, app launcher, and recording control
- **Recording requires app** — audio recording triggers the Remembry desktop app (auto-opens if not running)
- **Full-text search** — search across meeting titles, transcriptions, and AI-extracted knowledge
- **Knowledge aggregation** — pull action items, decisions, and questions across all events
- **Zero configuration** — auto-detects the Remembry database on your platform
- **Cross-platform** — works on Windows, macOS, and Linux
- **Stdio transport** — compatible with any MCP client (Claude, Cursor, Windsurf, etc.)

## Architecture

```
┌─────────────────────┐       ┌──────────────────────┐
│   AI Assistant      │       │   remembry-mcp       │
│   (Claude, Cursor,  │◄─────►│   (Node.js server)   │
│    Hermes, etc.)    │  MCP  │                      │
└─────────────────────┘       └──────┬──────────┬────┘
                                     │          │
                                reads/writes   HTTP API
                                     │          │
                          ┌──────────▼───┐  ┌───▼──────────────┐
                          │  remembry    │  │  Remembry Desktop │
                          │  .sqlite3    │  │  App (Tauri)      │
                          │  (database)  │  │  • Records audio  │
                          └──────────▲───┘  │  • Transcribes    │
                                     │      │  • Manages data   │
                                     └──────┴──────────────────┘
```

**Data access:** The MCP server reads/writes the SQLite database directly — no app required for queries.

**Recording:** The MCP server calls the desktop app's local HTTP API (port 17890) to trigger recording. The app handles audio capture (MediaRecorder) and transcription (Gemini). The HTTP server starts on-demand and shuts down after 5 minutes of inactivity.

## Installation

### Prerequisites

- **Node.js** 18 or later
- **[Remembry](https://github.com/kongjiyu/remembry-app)** desktop app installed and opened at least once

### Quick Start

```bash
npx -y @cstan0824/remembry-mcp
```

This downloads and runs the latest version. No `npm install` required.

## Configuration

### Claude Code

```bash
claude mcp add remembry -- npx -y @cstan0824/remembry-mcp
```

### Claude Desktop

Add to your Claude Desktop config file:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "remembry": {
      "command": "npx",
      "args": ["-y", "@cstan0824/remembry-mcp"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "remembry": {
      "command": "npx",
      "args": ["-y", "@cstan0824/remembry-mcp"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "remembry": {
      "command": "npx",
      "args": ["-y", "@cstan0824/remembry-mcp"]
    }
  }
}
```

### VS Code (via Continue.dev or MCP extension)

Add to your VS Code MCP configuration:

```json
{
  "servers": {
    "remembry": {
      "command": "npx",
      "args": ["-y", "@cstan0824/remembry-mcp"]
    }
  }
}
```

### Custom Database Path

If your Remembry database is in a non-default location:

```json
{
  "mcpServers": {
    "remembry": {
      "command": "npx",
      "args": ["-y", "@cstan0824/remembry-mcp"],
      "env": {
        "REMEMBRY_DB_PATH": "/path/to/remembry.sqlite3"
      }
    }
  }
}
```

Or pass it as a CLI argument:

```json
{
  "args": ["-y", "@cstan0824/remembry-mcp", "--db-path", "/path/to/remembry.sqlite3"]
}
```

## How It Works

### Database Location

The server auto-detects the Remembry database based on your platform:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\com.remembry.desktop\remembry.sqlite3` |
| macOS | `~/Library/Application Support/com.remembry.desktop/remembry.sqlite3` |
| Linux | `~/.local/share/com.remembry.desktop/remembry.sqlite3` |

Override with the `REMEMBRY_DB_PATH` environment variable or `--db-path` argument.

### Data Flow

1. **Desktop App** — Records audio, uploads to Gemini for transcription, extracts knowledge (summaries, action items, decisions, questions), stores everything in SQLite
2. **MCP Server** — Reads and writes the same SQLite database, exposes 20 tools via the MCP protocol
3. **AI Assistant** — Calls MCP tools to query, search, create, update, or delete meeting data

### Knowledge Format

Meeting knowledge is stored per-language in the `knowledge_by_language` JSON column. The canonical format is **EventKnowledge** (schema v1):

```json
{
  "schema_version": 1,
  "event_type": "meeting",
  "title": "Sprint Planning",
  "summary": "Discussed Q3 roadmap priorities...",
  "action_items": [
    {
      "id": "a1",
      "type": "task",
      "content": "Finalize API design",
      "assignee": "Alice",
      "due_date": "2026-06-20"
    }
  ],
  "decisions": [
    {
      "id": "d1",
      "type": "decision",
      "content": "Use REST over GraphQL for v2"
    }
  ],
  "questions": [
    {
      "id": "q1",
      "type": "question",
      "content": "Should we migrate the database?",
      "status": "open"
    }
  ],
  "key_points": [...],
  "insights": [...],
  "concepts": [...],
  "sentiment": { "overall": "positive", "important_emotions": [] }
}
```

## Tools

### Read Tools

#### `remembry_config_status`

Check database health, path, and basic statistics.

**Inputs:** _(none)_

**Returns:** `db_path`, `db_exists`, `db_readable`, `projects` (count), `events` (count), `jobs` (count)

---

#### `remembry_list_projects`

List all projects in the knowledge base.

**Inputs:** _(none)_

**Returns:** Array of projects with `id`, `display_name`, `color`, `description`, `goals`, `created_at`

---

#### `remembry_get_project`

Get details of a specific project by ID or display name (fuzzy match).

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | yes | Project ID or display name |

**Returns:** Project details + `event_count`

---

#### `remembry_list_events`

List events (meetings, interviews, standups) with optional filters.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project` | string | no | Filter by project ID or name |
| `type` | string | no | Filter by event type (e.g. `meeting`, `interview`) |
| `tag` | string | no | Filter by event tag |
| `since` | string | no | Filter events after ISO date (e.g. `2026-01-01`) |
| `limit` | number | no | Max results (default: 50) |

**Returns:** Array of event metadata (without full transcription)

---

#### `remembry_get_event`

Get full details of a specific event including transcription text.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | yes | The event/meeting ID |

**Returns:** Full event object with `transcription`, `event_tags`, `available_languages`, `knowledge_languages`

---

#### `remembry_get_event_knowledge`

Get AI-extracted knowledge for an event: summary, action items, decisions, questions, insights, concepts.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | yes | The event/meeting ID |
| `lang` | string | no | Language code (default: `en`) |

**Returns:** Full EventKnowledge object for the specified language

---

#### `remembry_search_knowledge`

Aggregate action items, decisions, or questions across all events.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | yes | `actions`, `decisions`, or `questions` |
| `project` | string | no | Filter by project ID or name |
| `assignee` | string | no | Filter actions by assignee name |
| `status` | string | no | Filter questions: `open`, `answered`, `partially_answered` |
| `since` | string | no | Filter events after ISO date |
| `lang` | string | no | Language code (default: `en`) |
| `limit` | number | no | Max events to scan (default: 100) |

**Returns:** Aggregated items with `source_event`, `event_id`, `event_date`

---

#### `remembry_search`

Full-text search across event titles, contexts, transcriptions, and knowledge content.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Search query |
| `project` | string | no | Filter by project ID or name |
| `type` | string | no | Filter by event type |
| `since` | string | no | Filter events after ISO date |
| `limit` | number | no | Max results (default: 10) |

**Returns:** Matching events ranked by `relevance_score` with `snippet`

---

#### `remembry_get_jobs`

List upload/processing jobs and their status.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | no | Filter by status: `completed`, `failed`, `processing` |
| `limit` | number | no | Max results (default: 20) |

**Returns:** Array of upload job records

---

#### `remembry_list_documents`

List documents attached to a project.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | string | yes | Project ID |
| `limit` | number | no | Max results (default: 50) |

**Returns:** Array of document metadata

---

#### `remembry_open_app`

Open the Remembry desktop app. Use this to start recording a meeting — the app handles audio capture and transcription via Gemini.

**Inputs:** _(none)_

**Returns:** `app_path`, `message`

---

#### `remembry_start_recording`

Start recording audio in the Remembry desktop app. **Requires the Remembry app to be running** — auto-opens the app if not. The terminal is free while recording.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | no | Meeting title (for reference) |

**Returns:** `status`, `message`

---

#### `remembry_stop_recording`

Stop the active recording in the Remembry desktop app. The app will transcribe via Gemini automatically.

**Inputs:** _(none)_

**Returns:** `status`, `message`

---

#### `remembry_recording_status`

Check if the Remembry app is running and recording status.

**Inputs:** _(none)_

**Returns:** `status`, `message`

### Write Tools

#### `remembry_create_project`

Create a new project.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Project display name |
| `description` | string | no | Project description |
| `color` | string | no | Tailwind color class (default: `bg-blue-500`) |
| `goals` | string | no | Project goals |

**Returns:** Created project object

---

#### `remembry_update_project`

Update an existing project.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | string | yes | Project ID to update |
| `name` | string | yes | New display name |
| `description` | string | no | New description |
| `color` | string | no | New color class |
| `goals` | string | no | New goals |

**Returns:** Updated project object

---

#### `remembry_delete_project`

Delete a project and all its associated meetings (cascade delete).

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | string | yes | Project ID to delete |

**Returns:** Success message with count of deleted meetings

---

#### `remembry_create_event`

Create a new meeting/event record with optional transcription.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | string | yes | Project ID to attach to |
| `title` | string | yes | Event title |
| `context` | string | no | Event description |
| `file_type` | string | no | `audio`, `text`, `video` (default: `text`) |
| `event_type` | string | no | `meeting`, `interview`, `standup`, `lecture` (default: `meeting`) |
| `event_tags` | string[] | no | Tags for the event |
| `transcription_text` | string | no | Transcription text content |
| `transcription_language` | string | no | Language code (default: `en`) |
| `default_language` | string | no | Default language (default: `en`) |

**Returns:** Created event object

---

#### `remembry_update_event`

Update an existing event's metadata.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | yes | Event ID to update |
| `title` | string | no | New title |
| `context` | string | no | New context |
| `event_type` | string | no | New event type |
| `event_tags` | string[] | no | New tags (replaces existing) |
| `default_language` | string | no | New default language |

**Returns:** Updated event object

---

#### `remembry_delete_event`

Delete a specific event by ID.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | yes | Event ID to delete |

**Returns:** Success message

---

#### `remembry_update_event_knowledge`

Write or update AI-extracted knowledge for an event in a specific language.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | yes | Event ID |
| `lang` | string | no | Language code (default: `en`) |
| `knowledge` | object | yes | Full EventKnowledge JSON object |

**Returns:** Success confirmation

---

#### `remembry_update_meeting_transcription`

Write or update the transcription text for a meeting.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | yes | Event ID |
| `text` | string | yes | Transcription text |
| `language` | string | no | Language code (default: `en`) |

**Returns:** Success confirmation

---

#### `remembry_create_document`

Create a text document attached to a project.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | string | yes | Project ID |
| `display_name` | string | yes | Document name |
| `content` | string | yes | Document text content |
| `mime_type` | string | no | MIME type (default: `text/plain`) |
| `metadata` | object | no | Optional metadata JSON |

**Returns:** Created document ID and name

---

#### `remembry_delete_document`

Delete a document by ID.

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `document_id` | string | yes | Document ID to delete |

**Returns:** Success message

### Tool Annotations

| Tool | Read-only | Idempotent | Destructive |
|------|-----------|------------|-------------|
| `remembry_config_status` | ✅ | ✅ | ❌ |
| `remembry_list_projects` | ✅ | ✅ | ❌ |
| `remembry_get_project` | ✅ | ✅ | ❌ |
| `remembry_list_events` | ✅ | ✅ | ❌ |
| `remembry_get_event` | ✅ | ✅ | ❌ |
| `remembry_get_event_knowledge` | ✅ | ✅ | ❌ |
| `remembry_search_knowledge` | ✅ | ✅ | ❌ |
| `remembry_search` | ✅ | ✅ | ❌ |
| `remembry_get_jobs` | ✅ | ✅ | ❌ |
| `remembry_list_documents` | ✅ | ✅ | ❌ |
| `remembry_open_app` | ❌ | ✅ | ❌ |
| `remembry_start_recording` | ❌ | ❌ | ❌ |
| `remembry_stop_recording` | ❌ | ❌ | ❌ |
| `remembry_recording_status` | ✅ | ✅ | ❌ |
| `remembry_create_project` | ❌ | ❌ | ❌ |
| `remembry_update_project` | ❌ | ✅ | ❌ |
| `remembry_delete_project` | ❌ | ✅ | ✅ |
| `remembry_create_event` | ❌ | ❌ | ❌ |
| `remembry_update_event` | ❌ | ✅ | ❌ |
| `remembry_delete_event` | ❌ | ✅ | ✅ |
| `remembry_update_event_knowledge` | ❌ | ✅ | ❌ |
| `remembry_update_meeting_transcription` | ❌ | ✅ | ❌ |
| `remembry_create_document` | ❌ | ❌ | ❌ |
| `remembry_delete_document` | ❌ | ✅ | ✅ |

## Usage Examples

Once connected, ask your AI assistant naturally:

**Searching & querying:**
- "What meetings do I have?"
- "Search for meetings about the API redesign"
- "What are my pending action items?"
- "What decisions were made in the SPM project?"
- "Are there any open questions from last week's standup?"

**Managing data:**
- "Create a new project called Engineering Standups"
- "Add a meeting to the SPM project about requirements review"
- "Update the title of that meeting to 'Sprint 3 Planning'"

**Analysis:**
- "Summarize the last meeting"
- "What action items are assigned to John?"
- "What topics keep coming up across meetings?"

**Recording (via desktop app):**
- "Record a meeting called Sprint Planning" → opens app, starts recording
- "Stop recording" → stops and transcribes
- "What new meetings do I have?" → lists recent meetings

## Development

```bash
# Clone the repository
git clone https://github.com/kongjiyu/remembry-app.git
cd remembry-app/mcp

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

### Releasing

```bash
# Bump version
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0

# Publish
npm publish --access public
```

Or push a git tag to trigger CI auto-publish:

```bash
git tag v0.2.0
git push --tags
```

## Troubleshooting

### "Database not found" error

- Make sure the Remembry desktop app is installed and has been opened at least once
- Verify the database path matches your platform (see [Database Location](#database-location))
- Use the `remembry_config_status` tool to check DB accessibility

### Tools not appearing after config

- Restart your MCP client after adding the configuration
- Verify Node.js is installed: `node --version`
- Test the server directly: `npx -y @cstan0824/remembry-mcp`

### Permission errors on database

- The MCP server opens the database in **WAL mode** (concurrent read/write safe)
- Ensure no other process has an exclusive lock on the file
- Try closing the Remembry desktop app before querying

## Links

- [Remembry Desktop App](https://github.com/kongjiyu/remembry-app)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [npm Package](https://www.npmjs.com/package/@cstan0824/remembry-mcp)

## License

[MIT](https://opensource.org/licenses/MIT)
