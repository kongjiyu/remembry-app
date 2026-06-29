#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import Database from "better-sqlite3";
import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";

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

  // Tauri 2.x uses the app identifier as the directory name
  const APP_ID = "com.remembry.desktop";

  if (platform === "win32") {
    appDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_ID);
  } else if (platform === "darwin") {
    appDataDir = path.join(os.homedir(), "Library", "Application Support", APP_ID);
  } else {
    appDataDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), APP_ID);
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
    db = new Database(dbPath);
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

      // Support both EventKnowledge (snake_case) and MeetingNotes (camelCase) formats
      const actions: any[] = k.action_items || k.actionItems || [];
      const decisions: any[] = k.decisions || [];
      const questions: any[] = k.questions || k.questions_and_answers || [];

      if (type === "actions") {
        for (const item of actions) {
          // Normalize: EventKnowledge TaskItem has .content + .assignee
          // Old MeetingNotes ActionItem has .task + .assignee
          // Plain string array
          const content = typeof item === "string" ? item : (item.content || item.task || "");
          const itemAssignee = typeof item === "string" ? null : (item.assignee || null);
          if (assignee && (!itemAssignee || !itemAssignee.toLowerCase().includes(assignee.toLowerCase()))) continue;
          aggregated.push({
            content,
            assignee: itemAssignee,
            due_date: typeof item === "string" ? null : (item.due_date || null),
            source_event: row.title,
            event_id: row.id,
            event_date: row.created_at,
          });
        }
      } else if (type === "decisions") {
        for (const item of decisions) {
          // EventKnowledge: KnowledgeItem with .content
          // Old MeetingNotes: plain string
          const content = typeof item === "string" ? item : (item.content || "");
          aggregated.push({
            content,
            source_event: row.title,
            event_id: row.id,
            event_date: row.created_at,
          });
        }
      } else if (type === "questions") {
        for (const item of questions) {
          // EventKnowledge: QuestionItem with .content, .status
          // Old MeetingNotes: { question, answer }
          // Plain string array
          const content = typeof item === "string" ? item : (item.content || item.question || "");
          const itemStatus = typeof item === "string" ? "open" : (item.status || "open");
          if (status && itemStatus.toLowerCase() !== status.toLowerCase()) continue;
          aggregated.push({
            content,
            status: itemStatus,
            answer: typeof item === "string" ? null : (item.answer || null),
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
        const fields = [k.summary, ...(k.key_points || k.keyPoints || []).map((p: any) => p.content),
                        ...(k.decisions || []).map((d: any) => typeof d === "string" ? d : d.content),
                        ...(k.action_items || k.actionItems || []).map((a: any) => a.content || a.task)];
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

// ── Tool: upload_audio ───────────────────────────────────────────────────
//
// Streams a local audio file to the running Remembry desktop app's HTTP API
// (port 17890). The app drives the existing upload pipeline (Gemini/Groq
// transcription → LLM extraction → SQLite persist) — this tool is just a
// chunked-upload transport.
//
// Matches the WebView's protocol exactly: 5 MB chunks, base64-encoded.

const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB — must match frontend

server.tool(
  "remembry_upload_audio",
  "Upload an audio (or video/text) file to Remembry for transcription and knowledge extraction. Requires the Remembry desktop app to be running. Polls until processing completes and returns the new meeting ID. Use remembry_list_projects to find a project_id.",
  {
    audio_path: z.string().describe("Absolute path to the audio file (e.g. /c/Users/.../lecture.mp3)"),
    project_id: z.string().describe("Project ID (e.g. 'project_xxx') to attach the meeting to"),
    title: z.string().describe("Meeting/event title"),
    context: z.string().optional().default("").describe("Optional context/description for the meeting"),
    file_type: z.enum(["audio", "video", "text"]).optional().default("audio").describe("File type (default: audio)"),
    mime_type: z.string().optional().describe("MIME type override (default: inferred from file extension)"),
    event_type: z.enum(["meeting", "interview", "standup", "lecture"]).optional().default("meeting").describe("Event type (default: meeting)"),
    event_tags: z.array(z.string()).optional().default([]).describe("Tags for the event"),
    poll_interval_ms: z.number().optional().default(2000).describe("Job status poll interval in milliseconds (default: 2000)"),
    max_wait_ms: z.number().optional().default(600000).describe("Maximum wait time in ms before giving up (default: 10 minutes)"),
  },
  async ({ audio_path, project_id, title, context, file_type, mime_type, event_type, event_tags, poll_interval_ms, max_wait_ms }) => {
    // ── Validate file ────────────────────────────────────────────────────
    if (!fs.existsSync(audio_path)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `File not found: ${audio_path}` }, null, 2) }],
        isError: true,
      };
    }
    const stat = fs.statSync(audio_path);
    const fileSize = stat.size;

    const fileName = path.basename(audio_path);
    const inferredMime = mime_type || inferMimeFromExtension(fileName);

    // ── Pre-flight: app reachable? ───────────────────────────────────────
    try {
      await apiFetch("/api/health");
    } catch (e: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          error: "Remembry desktop app is not running on http://127.0.0.1:17890",
          hint: "Open the Remembry app first, then retry.",
          detail: e.message,
        }, null, 2) }],
        isError: true,
      };
    }

    // ── Phase 1: start_upload ────────────────────────────────────────────
    const totalChunks = Math.ceil(fileSize / UPLOAD_CHUNK_SIZE);
    const startResp = await apiFetch("/api/upload/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_name: fileName, total_chunks: totalChunks }),
    });
    if (startResp.status !== "ok") {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "start_upload failed", detail: startResp }, null, 2) }],
        isError: true,
      };
    }
    const uploadId = startResp.upload_id;

    // ── Phase 2: append chunks (sequential, base64) ──────────────────────
    const fileBuffer = fs.readFileSync(audio_path);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * UPLOAD_CHUNK_SIZE;
      const end = Math.min(start + UPLOAD_CHUNK_SIZE, fileSize);
      const chunkBytes = fileBuffer.subarray(start, end);
      const chunkB64 = chunkBytes.toString("base64");

      const chunkResp = await apiFetch("/api/upload/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upload_id: uploadId,
          chunk_index: i,
          chunk_data: chunkB64,
        }),
      });
      if (chunkResp.status !== "ok") {
        return {
          content: [{ type: "text", text: JSON.stringify({
            error: `Chunk ${i + 1}/${totalChunks} failed`,
            detail: chunkResp,
          }, null, 2) }],
          isError: true,
        };
      }
    }

    // ── Phase 3: enqueue processing ──────────────────────────────────────
    const procResp = await apiFetch("/api/upload/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upload_id: uploadId,
        project_id,
        title,
        context: context || "",
        file_type,
        mime_type: inferredMime,
        event_type,
        event_tags,
        notes_languages: ["en"],
      }),
    });
    if (procResp.status !== "ok") {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "process failed", detail: procResp }, null, 2) }],
        isError: true,
      };
    }
    const jobId = procResp.job_id;

    // ── Phase 4: poll job status until terminal ──────────────────────────
    const deadline = Date.now() + max_wait_ms;
    let lastStatus: any = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, poll_interval_ms));
      const statusResp = await apiFetch(`/api/upload/job?job_id=${encodeURIComponent(jobId)}`);
      if (statusResp.status === "ok" && statusResp.job) {
        lastStatus = statusResp.job;
        if (["completed", "failed", "cancelled", "cleanup_pending"].includes(lastStatus.status)) {
          break;
        }
      }
    }

    const isTerminal = lastStatus && ["completed", "failed", "cancelled", "cleanup_pending"].includes(lastStatus.status);
    return {
      content: [{ type: "text", text: JSON.stringify({
        job_id: jobId,
        meeting_id: lastStatus?.meeting_id || null,
        upload_id: uploadId,
        final_status: lastStatus?.status || (isTerminal ? "unknown" : "timeout"),
        progress: lastStatus?.progress,
        message: lastStatus?.message,
        error: lastStatus?.error,
        file_size: fileSize,
        total_chunks: totalChunks,
        title,
        timed_out: !isTerminal,
      }, null, 2) }],
      isError: lastStatus?.status === "failed",
    };
  }
);

// Minimal MIME inference — covers what we actually care about for upload.
function inferMimeFromExtension(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
    mp4: "audio/mp4",
    mpeg: "audio/mpeg",
    aac: "audio/aac",
    txt: "text/plain",
    md: "text/plain",
    mp4v: "video/mp4",
  };
  return map[ext] || "audio/mpeg";
}

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

// ── Tool: create_project ─────────────────────────────────────────────────

server.tool(
  "remembry_create_project",
  "Create a new project in Remembry. Returns the created project.",
  {
    name: z.string().describe("Project display name (required, non-empty)"),
    description: z.string().optional().default("").describe("Project description"),
    color: z.string().optional().default("bg-blue-500").describe("Tailwind color class (e.g. 'bg-blue-500')"),
    goals: z.string().optional().default("").describe("Project goals"),
  },
  async ({ name, description, color, goals }) => {
    if (!name.trim()) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Project name cannot be empty" }) }],
        isError: true,
      };
    }

    const d = getDb();
    const id = `project_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    d.prepare(
      "INSERT INTO projects (id, display_name, color, description, goals, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, name.trim(), color || "bg-blue-500", description || "", goals || "", now);

    const project = d.prepare("SELECT * FROM projects WHERE id = ?").get(id);

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, project }, null, 2) }],
    };
  }
);

// ── Tool: update_project ─────────────────────────────────────────────────

server.tool(
  "remembry_update_project",
  "Update an existing project's name, description, color, or goals.",
  {
    project_id: z.string().describe("Project ID to update"),
    name: z.string().describe("New display name (required, non-empty)"),
    description: z.string().optional().describe("New description"),
    color: z.string().optional().describe("New Tailwind color class"),
    goals: z.string().optional().describe("New goals"),
  },
  async ({ project_id, name, description, color, goals }) => {
    if (!name.trim()) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Project name cannot be empty" }) }],
        isError: true,
      };
    }

    const d = getDb();
    const existing: any = d.prepare("SELECT * FROM projects WHERE id = ?").get(project_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Project not found: ${project_id}` }) }],
        isError: true,
      };
    }

    d.prepare(
      "UPDATE projects SET display_name = ?, description = ?, color = ?, goals = ? WHERE id = ?"
    ).run(
      name.trim(),
      description !== undefined ? description : existing.description,
      color !== undefined ? color : existing.color,
      goals !== undefined ? goals : existing.goals,
      project_id
    );

    const project = d.prepare("SELECT * FROM projects WHERE id = ?").get(project_id);

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, project }, null, 2) }],
    };
  }
);

// ── Tool: delete_project ─────────────────────────────────────────────────

server.tool(
  "remembry_delete_project",
  "Delete a project and all its associated meetings (cascade delete).",
  {
    project_id: z.string().describe("Project ID to delete"),
  },
  async ({ project_id }) => {
    const d = getDb();
    const existing: any = d.prepare("SELECT display_name FROM projects WHERE id = ?").get(project_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Project not found: ${project_id}` }) }],
        isError: true,
      };
    }

    // Count meetings that will be deleted
    const meetingCount: any = d.prepare("SELECT COUNT(*) as count FROM meetings WHERE project_id = ?").get(project_id);

    d.prepare("DELETE FROM projects WHERE id = ?").run(project_id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          message: `Deleted project '${existing.display_name}' and ${meetingCount?.count || 0} associated meeting(s)`,
        }, null, 2),
      }],
    };
  }
);

// ── Tool: create_event ───────────────────────────────────────────────────

server.tool(
  "remembry_create_event",
  "Create a new meeting/event record in Remembry. Use this to add a meeting with its transcription text directly.",
  {
    project_id: z.string().describe("Project ID to attach this event to"),
    title: z.string().describe("Event title (required)"),
    context: z.string().optional().default("").describe("Event context/description"),
    file_type: z.string().optional().default("text").describe("File type: 'audio', 'text', 'video', etc."),
    event_type: z.string().optional().default("meeting").describe("Event type: 'meeting', 'interview', 'standup', 'lecture', etc."),
    event_tags: z.array(z.string()).optional().default([]).describe("Tags for the event"),
    transcription_text: z.string().optional().describe("Transcription text content"),
    transcription_language: z.string().optional().default("en").describe("Language of the transcription"),
    default_language: z.string().optional().default("en").describe("Default language code"),
  },
  async ({ project_id, title, context, file_type, event_type, event_tags, transcription_text, transcription_language, default_language }) => {
    const d = getDb();

    // Verify project exists
    const project: any = d.prepare("SELECT id FROM projects WHERE id = ?").get(project_id);
    if (!project) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Project not found: ${project_id}` }) }],
        isError: true,
      };
    }

    const id = `meeting_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const transcription = transcription_text
      ? JSON.stringify({ text: transcription_text, language: transcription_language || "en" })
      : null;

    const availableLanguages = transcription_text ? [transcription_language || "en"] : [];

    d.prepare(
      `INSERT INTO meetings (id, project_id, title, context, file_type, event_type, event_tags,
       transcription, knowledge_by_language, default_language, available_languages, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      project_id,
      title,
      context || "",
      file_type || "text",
      event_type || "meeting",
      JSON.stringify(event_tags || []),
      transcription,
      null,
      default_language || "en",
      JSON.stringify(availableLanguages),
      now
    );

    const meeting = d.prepare("SELECT * FROM meetings WHERE id = ?").get(id);

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, meeting }, null, 2) }],
    };
  }
);

// ── Tool: update_event ───────────────────────────────────────────────────

server.tool(
  "remembry_update_event",
  "Update an existing event's metadata (title, context, tags, type, etc). Does not modify transcription or knowledge.",
  {
    event_id: z.string().describe("Event/meeting ID to update"),
    title: z.string().optional().describe("New title"),
    context: z.string().optional().describe("New context/description"),
    event_type: z.string().optional().describe("New event type"),
    event_tags: z.array(z.string()).optional().describe("New tags array (replaces existing)"),
    default_language: z.string().optional().describe("New default language"),
  },
  async ({ event_id, title, context, event_type, event_tags, default_language }) => {
    const d = getDb();
    const existing: any = d.prepare("SELECT * FROM meetings WHERE id = ?").get(event_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Event not found: ${event_id}` }) }],
        isError: true,
      };
    }

    d.prepare(
      `UPDATE meetings SET
        title = COALESCE(?, title),
        context = COALESCE(?, context),
        event_type = COALESCE(?, event_type),
        event_tags = COALESCE(?, event_tags),
        default_language = COALESCE(?, default_language)
       WHERE id = ?`
    ).run(
      title || null,
      context !== undefined ? context : null,
      event_type || null,
      event_tags ? JSON.stringify(event_tags) : null,
      default_language || null,
      event_id
    );

    const meeting = d.prepare("SELECT * FROM meetings WHERE id = ?").get(event_id);

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, meeting }, null, 2) }],
    };
  }
);

// ── Tool: delete_event ───────────────────────────────────────────────────

server.tool(
  "remembry_delete_event",
  "Delete a specific event/meeting by ID.",
  {
    event_id: z.string().describe("Event/meeting ID to delete"),
  },
  async ({ event_id }) => {
    const d = getDb();
    const existing: any = d.prepare("SELECT title FROM meetings WHERE id = ?").get(event_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Event not found: ${event_id}` }) }],
        isError: true,
      };
    }

    d.prepare("DELETE FROM meetings WHERE id = ?").run(event_id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, message: `Deleted event '${existing.title}'` }, null, 2),
      }],
    };
  }
);

// ── Tool: update_event_knowledge ─────────────────────────────────────────

server.tool(
  "remembry_update_event_knowledge",
  "Write or update AI-extracted knowledge for an event in a specific language. Accepts a full EventKnowledge JSON object.",
  {
    event_id: z.string().describe("Event/meeting ID"),
    lang: z.string().optional().default("en").describe("Language code (e.g. 'en', 'zh', 'ja')"),
    knowledge: z.record(z.string(), z.unknown()).describe("Full EventKnowledge JSON object with summary, action_items, decisions, questions, key_points, insights, etc."),
  },
  async ({ event_id, lang, knowledge }) => {
    const d = getDb();
    const existing: any = d.prepare("SELECT knowledge_by_language, available_languages FROM meetings WHERE id = ?").get(event_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Event not found: ${event_id}` }) }],
        isError: true,
      };
    }

    // Merge into existing knowledge map
    const knowledgeMap = parseJsonField<Record<string, unknown>>(existing.knowledge_by_language, {});
    knowledgeMap[lang] = knowledge;

    // Update available languages
    const langs = parseJsonField<string[]>(existing.available_languages, []);
    if (!langs.includes(lang)) {
      langs.push(lang);
    }

    d.prepare(
      "UPDATE meetings SET knowledge_by_language = ?, available_languages = ? WHERE id = ?"
    ).run(JSON.stringify(knowledgeMap), JSON.stringify(langs), event_id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, event_id, lang, message: "Knowledge updated" }, null, 2),
      }],
    };
  }
);

// ── Tool: update_meeting_transcription ───────────────────────────────────

server.tool(
  "remembry_update_meeting_transcription",
  "Write or update the transcription text for a meeting.",
  {
    event_id: z.string().describe("Event/meeting ID"),
    text: z.string().describe("Transcription text content"),
    language: z.string().optional().default("en").describe("Language of the transcription"),
  },
  async ({ event_id, text, language }) => {
    const d = getDb();
    const existing: any = d.prepare("SELECT id, available_languages FROM meetings WHERE id = ?").get(event_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Event not found: ${event_id}` }) }],
        isError: true,
      };
    }

    const transcription = JSON.stringify({ text, language: language || "en" });

    // Update available languages
    const langs = parseJsonField<string[]>(existing.available_languages, []);
    if (!langs.includes(language || "en")) {
      langs.push(language || "en");
    }

    d.prepare(
      "UPDATE meetings SET transcription = ?, available_languages = ? WHERE id = ?"
    ).run(transcription, JSON.stringify(langs), event_id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, event_id, message: "Transcription updated" }, null, 2),
      }],
    };
  }
);

// ── Tool: list_documents ─────────────────────────────────────────────────

server.tool(
  "remembry_list_documents",
  "List documents for a project.",
  {
    project_id: z.string().describe("Project ID"),
    limit: z.number().optional().default(50).describe("Max results (default 50)"),
  },
  async ({ project_id, limit }) => {
    const d = getDb();

    const rows = d.prepare(
      "SELECT id, project_id, display_name, mime_type, created_at FROM project_documents WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(project_id, limit);

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ── Tool: create_document ────────────────────────────────────────────────

server.tool(
  "remembry_create_document",
  "Create a text document attached to a project.",
  {
    project_id: z.string().describe("Project ID"),
    display_name: z.string().describe("Document name"),
    content: z.string().describe("Document text content"),
    mime_type: z.string().optional().default("text/plain").describe("MIME type"),
    metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata JSON"),
  },
  async ({ project_id, display_name, content, mime_type, metadata }) => {
    const d = getDb();

    const project: any = d.prepare("SELECT id FROM projects WHERE id = ?").get(project_id);
    if (!project) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Project not found: ${project_id}` }) }],
        isError: true,
      };
    }

    const id = `doc_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    d.prepare(
      "INSERT INTO project_documents (id, project_id, display_name, mime_type, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, project_id, display_name, mime_type || "text/plain", content, metadata ? JSON.stringify(metadata) : null, now);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, id, display_name }, null, 2),
      }],
    };
  }
);

// ── Tool: delete_document ────────────────────────────────────────────────

server.tool(
  "remembry_delete_document",
  "Delete a document by ID.",
  {
    document_id: z.string().describe("Document ID to delete"),
  },
  async ({ document_id }) => {
    const d = getDb();
    const existing: any = d.prepare("SELECT display_name FROM project_documents WHERE id = ?").get(document_id);

    if (!existing) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: `Document not found: ${document_id}` }) }],
        isError: true,
      };
    }

    d.prepare("DELETE FROM project_documents WHERE id = ?").run(document_id);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, message: `Deleted document '${existing.display_name}'` }, null, 2),
      }],
    };
  }
);

// ── Tool: open_remembry_app ──────────────────────────────────────────────

server.tool(
  "remembry_open_app",
  "Open the Remembry desktop app. Use this to start recording a meeting — the app handles audio capture and transcription via Gemini.",
  {},
  async () => {
    const platform = process.platform;
    let appPath: string | null = null;

    // Search common installation paths
    const searchPaths = platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA || "", "Remembry", "remembry.exe"),
          path.join(process.env.LOCALAPPDATA || "", "Programs", "remembry", "remembry.exe"),
          path.join(process.env.PROGRAMFILES || "", "Remembry", "remembry.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] || "", "Remembry", "remembry.exe"),
        ]
      : platform === "darwin"
      ? [
          "/Applications/Remembry.app",
          path.join(os.homedir(), "Applications", "Remembry.app"),
        ]
      : [
          "/usr/bin/remembry",
          "/usr/local/bin/remembry",
          path.join(os.homedir(), ".local", "bin", "remembry"),
        ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        appPath = p;
        break;
      }
    }

    if (!appPath) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "Remembry app not found",
            searched: searchPaths,
            hint: "Install from https://github.com/kongjiyu/remembry-app/releases",
          }, null, 2),
        }],
        isError: true,
      };
    }

    // Launch the app (non-blocking)
    try {
      const { exec } = await import("node:child_process");
      if (platform === "win32") {
        exec(`start "" "${appPath}"`);
      } else if (platform === "darwin") {
        exec(`open "${appPath}"`);
      } else {
        exec(`"${appPath}" &`);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "Remembry app opened. Record your meeting in the app, then ask me to check for new meetings.",
            app_path: appPath,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Failed to open app: ${err.message}`,
            app_path: appPath,
            hint: "You can open it manually from your Start Menu or Applications folder",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ── HTTP API base URL ────────────────────────────────────────────────────

const API_BASE = "http://127.0.0.1:17890";

async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Remembry API ${path} failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Tool: start_recording ────────────────────────────────────────────────

server.tool(
  "remembry_start_recording",
  "Start recording audio in the Remembry desktop app. The app must be running. Opens the app automatically if not running.",
  {
    title: z.string().optional().describe("Meeting title (optional, for reference)"),
  },
  async ({ title }) => {
    // Check if app is running
    try {
      await apiFetch("/api/health");
    } catch {
      // App not running — try to open it
      try {
        const { exec } = await import("node:child_process");
        const platform = process.platform;
        const searchPaths = platform === "win32"
          ? [
              `${process.env.LOCALAPPDATA}/Remembry/remembry.exe`,
              `${process.env.LOCALAPPDATA}/Programs/remembry/remembry.exe`,
            ]
          : platform === "darwin"
          ? ["/Applications/Remembry.app"]
          : ["/usr/bin/remembry"];

        let found = false;
        for (const p of searchPaths) {
          const fs = await import("node:fs");
          if (fs.existsSync(p)) {
            if (platform === "win32") exec(`start "" "${p}"`);
            else if (platform === "darwin") exec(`open "${p}"`);
            else exec(`"${p}" &`);
            found = true;
            break;
          }
        }

        if (!found) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "Remembry app not found and not running",
                hint: "Install from https://github.com/kongjiyu/remembry-app/releases",
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Wait for app to start
        await new Promise((r) => setTimeout(r, 3000));
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: `Failed to open app: ${err.message}` }, null, 2),
          }],
          isError: true,
        };
      }
    }

    // Start recording
    try {
      const result = await apiFetch("/api/record/start", { method: "POST" });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...result,
            title: title || "(not specified)",
            message: "Recording started in Remembry app. The terminal is free. Use remembry_stop_recording when done.",
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: `Failed to start recording: ${err.message}` }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: stop_recording ─────────────────────────────────────────────────

server.tool(
  "remembry_stop_recording",
  "Stop the active recording in the Remembry desktop app. The app will transcribe via Gemini automatically.",
  {},
  async () => {
    try {
      const result = await apiFetch("/api/record/stop");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...result,
            message: "Recording stop triggered. The app will transcribe and save. Check the app for results.",
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Failed to stop recording: ${err.message}`,
            hint: "Is the Remembry app running?",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool: recording_status ───────────────────────────────────────────────

server.tool(
  "remembry_recording_status",
  "Check if the Remembry app is running and recording status.",
  {},
  async () => {
    try {
      const result = await apiFetch("/api/record/status");
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "app_not_running",
            message: "Remembry app is not running. Use remembry_open_app to start it.",
          }, null, 2),
        }],
      };
    }
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
