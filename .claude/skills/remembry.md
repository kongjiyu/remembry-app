---
name: remembry
description: Manage your Remembry meeting knowledge base — search meetings, create projects, add events, update knowledge, and organize your recordings.
---

# Remembry Skill

You have access to the **Remembry** meeting knowledge base via MCP tools. Remembry stores meetings, interviews, standups, and lectures with AI-extracted knowledge (summaries, action items, decisions, questions).

## Data Model

- **Projects** — top-level containers (e.g. "SPM", "Engineering"). Each has a name, description, color, and goals.
- **Events/Meetings** — belong to a project. Have a title, context, transcription, event_type, tags, and knowledge_by_language (JSON blob with AI-extracted insights per language).
- **Documents** — text files attached to a project.
- **Upload Jobs** — background processing jobs for audio transcription.

## Available Tools

### Read Tools

| Tool | Use When |
|------|----------|
| `remembry_config_status` | Check DB health and stats |
| `remembry_list_projects` | See all projects |
| `remembry_get_project` | Get project details by ID or name |
| `remembry_list_events` | List meetings with filters (project, type, tag, since) |
| `remembry_get_event` | Get full event details including transcription |
| `remembry_get_event_knowledge` | Get AI-extracted knowledge (summary, actions, decisions, questions, insights) |
| `remembry_search_knowledge` | Aggregate action items, decisions, or questions across events |
| `remembry_search` | Full-text search across titles, transcriptions, and knowledge |
| `remembry_get_jobs` | Check upload/processing job status |
| `remembry_list_documents` | List documents for a project |

### Write Tools

| Tool | Use When |
|------|----------|
| `remembry_create_project` | Create a new project |
| `remembry_update_project` | Update project name, description, color, goals |
| `remembry_delete_project` | Delete a project (cascades to all meetings) |
| `remembry_create_event` | Create a new meeting/event with optional transcription |
| `remembry_update_event` | Update event metadata (title, context, tags, type) |
| `remembry_delete_event` | Delete a specific event |
| `remembry_update_event_knowledge` | Write/update AI-extracted knowledge JSON for an event |
| `remembry_update_meeting_transcription` | Write/update transcription text for a meeting |
| `remembry_create_document` | Create a text document attached to a project |
| `remembry_delete_document` | Delete a document |

## Common Workflows

### "What meetings do I have?"
```
remembry_list_events → show list with titles, dates, types
```

### "Search for meetings about X"
```
remembry_search(query="X") → show matching events with relevance scores
```

### "What are my pending action items?"
```
remembry_search_knowledge(type="actions", status="open") → list all open action items
```

### "What decisions were made in project Y?"
```
remembry_search_knowledge(type="decisions", project="Y") → list decisions
```

### "Summarize meeting Z"
```
remembry_get_event_knowledge(event_id="Z", lang="en") → show summary, key points, insights
```

### "Create a new project and add a meeting"
```
1. remembry_create_project(name="...", description="...")
2. remembry_create_event(project_id=<new_id>, title="...", transcription_text="...")
```

### "Update the knowledge for a meeting"
```
remembry_update_event_knowledge(event_id="...", lang="en", knowledge={...full EventKnowledge JSON...})
```

### "What open questions are there?"
```
remembry_search_knowledge(type="questions", status="open") → list unanswered questions
```

## Tips

- Always use `remembry_search` first when the user asks about something specific — it ranks by relevance across title, context, transcription, and knowledge.
- Use `remembry_search_knowledge` with `assignee` filter to find tasks assigned to a specific person.
- When creating events, set `event_type` to something meaningful: `meeting`, `interview`, `standup`, `lecture`, `call`.
- The `knowledge_by_language` field stores structured data per language — use `remembry_get_event_knowledge` to read it cleanly.
- `remembry_list_events` supports `since` filter (ISO date) for time-based queries.
- Project lookup is fuzzy — you can pass either the project ID or the display name.
