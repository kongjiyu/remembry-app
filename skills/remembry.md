# Remembry — Meeting Knowledge Base

You have access to **Remembry**, an AI-powered meeting knowledge base that stores transcriptions, extracted knowledge (action items, decisions, questions, insights), and project information from recorded meetings, interviews, and standups.

## When to use Remembry

Use the Remembry tools when the user asks about:
- Past meetings, discussions, or decisions
- Action items or tasks from meetings
- What was said or decided in a specific event
- Searching across meeting transcripts
- Project-related meeting history
- Open questions from meetings
- Tasks assigned to specific people

## Available Tools

### `remembry_list_projects`
List all projects. No parameters needed. Use this first to discover available projects.

### `remembry_get_project`
Get project details by ID or name.
- `project`: Project ID (e.g. `project_xxx`) or display name

### `remembry_list_events`
List events with optional filters.
- `project`: Filter by project ID or name
- `type`: Filter by event type (`meeting`, `interview`, `standup`)
- `tag`: Filter by tag
- `since`: ISO date filter (e.g. `2026-01-01`)
- `limit`: Max results (default 50)

### `remembry_get_event`
Get full event details including transcription.
- `event_id`: The event ID

### `remembry_get_event_knowledge`
Get AI-extracted knowledge for an event (summary, action items, decisions, questions, insights).
- `event_id`: The event ID
- `lang`: Language code (default `en`)

### `remembry_search_knowledge`
Aggregate knowledge items across events. Most useful for finding tasks, decisions, and open questions.
- `type`: `actions` | `decisions` | `questions`
- `project`: Filter by project
- `assignee`: Filter action items by assignee
- `status`: Filter questions by status (`open`, `answered`, `partially_answered`)
- `since`: ISO date filter
- `lang`: Language code (default `en`)

### `remembry_search`
Full-text search across titles, transcripts, and knowledge content.
- `query`: Search query
- `project`: Filter by project
- `type`: Filter by event type
- `since`: ISO date filter
- `limit`: Max results (default 10)

### `remembry_get_jobs`
Check processing job status.
- `status`: Filter by status (`completed`, `failed`, `processing`)
- `limit`: Max results (default 20)

### `remembry_config_status`
Check database health and stats. No parameters.

## Common Patterns

### "What tasks are pending from recent meetings?"
```
remembry_search_knowledge(type="actions", since="2026-05-01")
```

### "What did we decide about X?"
```
remembry_search(query="X decisions")
remembry_search_knowledge(type="decisions", project="ProjectName")
```

### "Summarize yesterday's standup"
```
remembry_list_events(project="ProjectName", type="standup", since="2026-06-01")
→ get event_id from results
remembry_get_event_knowledge(event_id="<id>")
```

### "What's assigned to Alice?"
```
remembry_search_knowledge(type="actions", assignee="Alice")
```

### "Find mentions of budget in meetings"
```
remembry_search(query="budget")
```

## Output Format

All tools return JSON. Key fields to look for:
- `actionItems`: Tasks with `content`, `assignee`, `dueDate`
- `decisions`: Decisions with `content` and `evidence`
- `questions`: Questions with `content` and `status` (open/answered)
- `summary`: Event summary text
- `keyPoints`: Important points from the event
