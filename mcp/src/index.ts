#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

// ── Database path resolution ──────────────────────────────────────────────

function resolveDbPath(): string {
  // Check --db-path argument
  const argIdx = process.argv.indexOf("--db-path");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }

  // Check REMEMBRY_DB_PATH env var
  if (process.env.REMEMBRY_DB_PATH) {
    return process.env.REMEMBRY_DB_PATH;
  }

  // Auto-detect from platform-specific app data directory
  const platform = process.platform;
  let appDataDir: string;

  if (platform === "win32") {
    appDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "remembry");
  } else if (platform === "darwin") {
    appDataDir = path.join(os.homedir(), "Library", "Application Support", "remembry");
  } else {
    appDataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "remembry");
  }

  return path.join(appDataDir, "remembry.sqlite3");
}

// ── Database connection ───────────────────────────────────────────────────

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    const dbPath = resolveDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database not found at: ${dbPath}\nSet REMEMBRY_DB_PATH env var or pass --db-path <path>`);
    }
    db = new Database(dbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
  }
  return db;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseKnowledgeByLanguage(
  raw: string | null | undefined,
  lang: string
): Record<string, unknown> | null {
  const map: Record<string, unknown> = parseJsonField(raw, {}) as Record<string, unknown>;
  return (map[lang] as Record<string, unknown>) || (map["default"] as Record<string, unknown>) || null;
}

// ── MCP Server ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "remembry",
  version: "0.1.0",
});

// ── Tool: list_projects ───────────────────────────────────────────────────

server.tool(
  "remembry_list_projects",
  "List all projects in the Remembry knowledge base. Returns project ID, name, description, goals, and creation date.",
  {},
  async () => {
    const rows = getDb().prepare(
      "SELECT id, display_name, color, description, goals, created_at FROM projects ORDER BY created_at DESC"
    ).all();

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ── Tool: get_project ─────────────────────────────────────────────────────

server.tool(
  "remembry_get_project",
  "Get details of a specific project by ID or name. Returns project info plus count of events.",
  { project: z.string().describe("Project ID (e.g. 'project_xxx') or display name") },
  async ({ project }) => {
    const d = getDb();

    // Try direct ID lookup first
    let row: any = d.prepare("SELECT * FROM projects WHERE id = ?").get(project);

    // Fuzzy match on display_name
    if (!row) {
      row = d.prepare("SELECT * FROM projects WHERE lower(display_name) = lower(?)").get(project);
    }

    if (!row) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Project not found: ${project}` }) }],
        isError: true,
      };
    }

    // Count events
    const countRow: any = d.prepare("SELECT COUNT(*) as count FROM meetings WHERE project_id = ?").get(row.id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ...row, event_count: countRow?.count || 0 }, null, 2),
      }],
    };
  }
);

// ── Tool: list_events ─────────────────────────────────────────────────────

server.tool(
  "remembry_list_events",
  "List events (meetings/interviews/standups). Optionally filter by project, event type, or tags. Returns event metadata without full transcription.",
  {
    project: z.string().optional().describe("Filter by project ID or name"),
    type: z.string().optional().describe("Filter by event type (e.g. 'meeting', 'interview', 'standup')"),
    tag: z.string().optional().describe("Filter by event tag"),
    since: z.string().optional().describe("Filter events created after this ISO date (e.g. '2026-01-01')"),
    limit: z.number().optional().default(50).describe("Max results (default 50)"),
  },
  async ({ project, type, tag, since, limit }) => {
    const d = getDb();

    let projectId: string | undefined;
    if (project) {
      const proj: any = d.prepare("SELECT id FROM projects WHERE id = ? OR lower(display_name) = lower(?)").get(project, project);
      if (proj) {
        projectId = proj.id;
      } else {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Project not found: ${project}` }) }],
          isError: true,
        };
      }
    }

    let sql = `SELECT id, project_id, title, context, file_type, event_type, event_tags,
                      created_at, default_language, available_languages
               FROM meetings WHERE 1=1`;
    const params: any[] = [];

    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (type) {
      sql += " AND event_type = ?";
      params.push(type);
    }
    if (since) {
      sql += " AND created_at >= ?";
      params.push(since);
    }

    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    let rows: any[] = d.prepare(sql).all(...params) as any[];

    // Filter by tag (JSON array column, must filter in JS)
    if (tag) {
      rows = rows.filter((r) => {
        const tags = parseJsonField<string[]>(r.event_tags, []);
        return tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()));
      });
    }

    // Parse JSON fields for cleaner output
    const results = rows.map((r) => ({
      ...r,
      event_tags: parseJsonField<string[]>(r.event_tags, []),
      available_languages: parseJsonField<string[]>(r.available_languages, []),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ── Tool: get_event ───────────────────────────────────────────────────────

server.tool(
  "remembry_get_event",
  "Get full details of a specific event including transcription text and available languages.",
  { event_id: z.string().describe("The event/meeting ID") },
  async ({ event_id }) => {
    const row: any = getDb().prepare("SELECT * FROM meetings WHERE id = ?").get(event_id);

    if (!row) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Event not found: ${event_id}` }) }],
        isError: true,
      };
    }

    // Parse JSON fields
    const result = {
      ...row,
      transcription: parseJsonField<{ text: string; language?: string } | null>(row.transcription, null),
      event_tags: parseJsonField<string[]>(row.event_tags, []),
      available_languages: parseJsonField<string[]>(row.available_languages, []),
      // Don't include full knowledge_by_language by default (too large)
      knowledge_languages: Object.keys(parseJsonField<Record<string, unknown>>(row.knowledge_by_language, {})),
    };
    delete result.knowledge_by_language;

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: get_event_knowledge ─────────────────────────────────────────────

server.tool(
  "remembry_get_event_knowledge",
  "Get AI-extracted knowledge for an event: summary, action items, decisions, questions, insights, concepts. Specify language (default 'en').",
  {
    event_id: z.string().describe("The event/meeting ID"),
    lang: z.string().optional().default("en").describe("Language code (e.g. 'en', 'zh', 'ja')"),
  },
  async ({ event_id, lang }) => {
    const row: any = getDb().prepare("SELECT knowledge_by_language, title FROM meetings WHERE id = ?").get(event_id);

    if (!row) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Event not found: ${event_id}` }) }],
        isError: true,
      };
    }

    const knowledge = parseKnowledgeByLanguage(row.knowledge_by_language, lang);

    if (!knowledge) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `No knowledge extracted for language '${lang}'`,
            available_languages: Object.keys(parseJsonField<Record<string, unknown>>(row.knowledge_by_language, {})),
          }),
        }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ title: row.title, lang, knowledge }, null, 2) }],
    };
  }
);

// ── Tool: search_knowledge ────────────────────────────────────────────────

server.tool(
  "remembry_search_knowledge",
  "Aggregate action items, decisions, or questions across all events. Use this to find tasks assigned to someone, open questions, or recent decisions.",
  {
    type: z.enum(["actions", "decisions", "questions"]).describe("Type of knowledge to aggregate"),
    project: z.string().optional().describe("Filter by project ID or name"),
    assignee: z.string().optional().describe("Filter action items by assignee name"),
    status: z.string().optional().describe("Filter questions by status: 'open', 'answered', 'partially_answered'"),
    since: z.string().optional().describe("Filter events created after this ISO date"),
    lang: z.string().optional().default("en").describe("Language code"),
    limit: z.number().optional().default(100).describe("Max events to scan (default 100)"),
  },
  async ({ type, project, assignee, status, since, lang, limit }) => {
    const d = getDb();

    let projectId: string | undefined;
    if (project) {
      const proj: any = d.prepare("SELECT id FROM projects WHERE id = ? OR lower(display_name) = lower(?)").get(project, project);
      if (proj) projectId = proj.id;
    }

    let sql = `SELECT id, title, project_id, created_at, knowledge_by_language FROM meetings WHERE 1=1`;
    const params: any[] = [];

    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (since) {
      sql += " AND created_at >= ?";
      params.push(since);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows: any[] = d.prepare(sql).all(...params) as any[];

    const aggregated: any[] = [];

    for (const row of rows) {
      const knowledge = parseKnowledgeByLanguage(row.knowledge_by_language, lang);
      if (!knowledge) continue;

      const k = knowledge as any;

      if (type === "actions" && k.actionItems) {
        for (const item of k.actionItems) {
          if (assignee && (!item.assignee || !item.assignee.toLowerCase().includes(assignee.toLowerCase()))) continue;
          aggregated.push({
            ...item,
            source_event: row.title,
            event_id: row.id,
            event_date: row.created_at,
          });
        }
      } else if (type === "decisions" && k.decisions) {
        for (const item of k.decisions) {
          aggregated.push({
            ...item,
            source_event: row.title,
            event_id: row.id,
            event_date: row.created_at,
          });
        }
      } else if (type === "questions" && k.questions) {
        for (const item of k.questions) {
          if (status && item.status && item.status.toLowerCase() !== status.toLowerCase()) continue;
          aggregated.push({
            ...item,
            source_event: row.title,
            event_id: row.id,
            event_date: row.created_at,
          });
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ type, count: aggregated.length, items: aggregated }, null, 2),
      }],
    };
  }
);

// ── Tool: search ──────────────────────────────────────────────────────────

server.tool(
  "remembry_search",
  "Full-text search across event titles, contexts, transcriptions, and knowledge content. Returns matching events ranked by relevance.",
  {
    query: z.string().describe("Search query"),
    project: z.string().optional().describe("Filter by project ID or name"),
    type: z.string().optional().describe("Filter by event type"),
    since: z.string().optional().describe("Filter events created after this ISO date"),
    limit: z.number().optional().default(10).describe("Max results (default 10)"),
  },
  async ({ query, project, type, since, limit }) => {
    const d = getDb();
    const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

    let projectId: string | undefined;
    if (project) {
      const proj: any = d.prepare("SELECT id FROM projects WHERE id = ? OR lower(display_name) = lower(?)").get(project, project);
      if (proj) projectId = proj.id;
    }

    let sql = `SELECT id, project_id, title, context, event_type, event_tags,
                      created_at, transcription, knowledge_by_language
               FROM meetings WHERE 1=1`;
    const params: any[] = [];

    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (type) {
      sql += " AND event_type = ?";
      params.push(type);
    }
    if (since) {
      sql += " AND created_at >= ?";
      params.push(since);
    }

    sql += " ORDER BY created_at DESC";

    const rows: any[] = d.prepare(sql).all(...params) as any[];

    // Score each meeting
    const scored = rows.map((row) => {
      let score = 0;
      const titleLower = (row.title || "").toLowerCase();
      const contextLower = (row.context || "").toLowerCase();
      const transcription = parseJsonField<{ text?: string }>(row.transcription, {});
      const transcriptLower = (transcription.text || "").toLowerCase();

      for (const token of queryTokens) {
        if (titleLower.includes(token)) score += 3;
        if (contextLower.includes(token)) score += 2;
        if (transcriptLower.includes(token)) score += 1;
      }

      // Also search in knowledge content
      const knowledgeMap = parseJsonField<Record<string, unknown>>(row.knowledge_by_language, {});
      for (const langKey of Object.keys(knowledgeMap)) {
        const k = knowledgeMap[langKey] as any;
        if (!k) continue;
        const fields = [k.summary, ...(k.keyPoints || []).map((p: any) => p.content),
                        ...(k.decisions || []).map((d: any) => d.content),
                        ...(k.actionItems || []).map((a: any) => a.content)];
        for (const field of fields) {
          if (typeof field === "string") {
            for (const token of queryTokens) {
              if (field.toLowerCase().includes(token)) score += 1;
            }
          }
        }
      }

      return { row, score };
    });

    const results = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score }) => ({
        id: row.id,
        title: row.title,
        project_id: row.project_id,
        event_type: row.event_type,
        created_at: row.created_at,
        relevance_score: score,
        snippet: (parseJsonField<{ text?: string }>(row.transcription, {}).text || "").slice(0, 300),
      }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ query, count: results.length, results }, null, 2),
      }],
    };
  }
);

// ── Tool: get_jobs ────────────────────────────────────────────────────────

server.tool(
  "remembry_get_jobs",
  "List upload/processing jobs and their status. Useful for checking if knowledge extraction is still running.",
  {
    status: z.string().optional().describe("Filter by job status (e.g. 'completed', 'failed', 'processing')"),
    limit: z.number().optional().default(20).describe("Max results (default 20)"),
  },
  async ({ status, limit }) => {
    const d = getDb();

    let sql = "SELECT * FROM upload_jobs WHERE 1=1";
    const params: any[] = [];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    const rows = d.prepare(sql).all(...params);

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ── Tool: config_status ───────────────────────────────────────────────────

server.tool(
  "remembry_config_status",
  "Check Remembry configuration: database path, accessibility, and basic stats.",
  {},
  async () => {
    const dbPath = resolveDbPath();
    const exists = fs.existsSync(dbPath);

    if (!exists) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            db_path: dbPath,
            db_exists: false,
            error: "Database file not found. Is the Remembry desktop app installed?",
          }),
        }],
      };
    }

    const d = getDb();
    const projectCount: any = d.prepare("SELECT COUNT(*) as count FROM projects").get();
    const eventCount: any = d.prepare("SELECT COUNT(*) as count FROM meetings").get();
    const jobCount: any = d.prepare("SELECT COUNT(*) as count FROM upload_jobs").get();

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          db_path: dbPath,
          db_exists: true,
          db_readable: true,
          projects: projectCount?.count || 0,
          events: eventCount?.count || 0,
          jobs: jobCount?.count || 0,
        }, null, 2),
      }],
    };
  }
);

// ── Start server ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Remembry MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
