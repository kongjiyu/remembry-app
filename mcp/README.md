# Remembry MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents access to your Remembry meeting knowledge base.

## What it does

Exposes 9 tools for querying your Remembry data:

| Tool | Description |
|------|-------------|
| `remembry_list_projects` | List all projects |
| `remembry_get_project` | Get project by ID or name |
| `remembry_list_events` | List events with filters |
| `remembry_get_event` | Get event details + transcription |
| `remembry_get_event_knowledge` | Get AI-extracted knowledge |
| `remembry_search_knowledge` | Aggregate actions/decisions/questions |
| `remembry_search` | Full-text search |
| `remembry_get_jobs` | Check processing job status |
| `remembry_config_status` | Health check |

## Setup

### Prerequisites

- Node.js 18+
- Remembry desktop app installed (the MCP reads its SQLite database)

### Install

```bash
cd mcp
npm install
npm run build
```

### Run

```bash
# Auto-detects database location
npm start

# Or specify custom path
npm start -- --db-path /path/to/remembry.sqlite3

# Or use env var
REMEMBRY_DB_PATH=/path/to/remembry.sqlite3 npm start
```

## Connecting to Claude Code

Add to your Claude Code MCP settings (`.claude/settings.json` or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "remembry": {
      "command": "node",
      "args": ["<path-to>/mcp/dist/index.js"]
    }
  }
}
```

Or with a custom DB path:

```json
{
  "mcpServers": {
    "remembry": {
      "command": "node",
      "args": ["<path-to>/mcp/dist/index.js", "--db-path", "/custom/path/remembry.sqlite3"]
    }
  }
}
```

## Connecting to other MCP clients

This server uses **stdio** transport. Any MCP-compatible client can connect by running:

```bash
node dist/index.js
```

## Database Location

The server auto-detects the Remembry database at:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%/remembry/remembry.sqlite3` |
| macOS | `~/Library/Application Support/remembry/remembry.sqlite3` |
| Linux | `~/.local/share/remembry/remembry.sqlite3` |

Override with `--db-path` flag or `REMEMBRY_DB_PATH` environment variable.

## Skills

Copy the `skills/remembry.md` file to your agent's skills directory to give it context about how to use Remembry tools effectively.
