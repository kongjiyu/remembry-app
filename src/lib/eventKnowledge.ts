// Shared event knowledge types and utilities
// Used by EventKnowledgeDisplay and ProjectOverview

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Evidence {
    snippet: string;
    speaker?: string;
    timestamp?: string;
}

export interface KnowledgeItem {
    id: string;
    item_type: string;
    subtype?: string;
    content: string;
    confidence?: number;
    sentiment?: string;
    evidence: Evidence[];
    tags: string[];
}

export interface QuestionItem extends KnowledgeItem {
    status: "open" | "answered" | "partially_answered";
    answer?: string;
}

export interface TaskItem extends KnowledgeItem {
    assignee?: string;
    due_date?: string;
}

export interface ConceptItem extends KnowledgeItem {
    canonical_name: string;
    title: string;
    aliases: string[];
    description: string;
}

export interface EventSentiment {
    overall: string;
    important_emotions: string[];
}

export interface EventKnowledge {
    schema_version: number;
    event_type: string;
    title: string;
    summary: string;
    concepts: ConceptItem[];
    key_points: KnowledgeItem[];
    insights: KnowledgeItem[];
    questions: QuestionItem[];
    decisions: KnowledgeItem[];
    action_items: TaskItem[];
    observations: KnowledgeItem[];
    references: KnowledgeItem[];
    related_topics: string[];
    sentiment: EventSentiment;
}

// ---------------------------------------------------------------------------
// Normalizers (snake_case API → camelCase internal)
// ---------------------------------------------------------------------------

function normalizeEvidence(raw: unknown): Evidence {
    if (!raw || typeof raw !== "object") return { snippet: "" };
    const r = raw as Record<string, unknown>;
    return {
        snippet: String(r.snippet ?? ""),
        speaker: r.speaker as string | undefined,
        timestamp: r.timestamp as string | undefined,
    };
}

function normalizeKnowledgeItem(r: Record<string, unknown>): KnowledgeItem {
    return {
        id: String(r.id ?? ""),
        item_type: String(r.item_type ?? r.itemType ?? ""),
        subtype: r.subtype as string | undefined,
        content: String(r.content ?? ""),
        confidence: r.confidence as number | undefined,
        sentiment: r.sentiment as string | undefined,
        evidence: ((r.evidence ?? []) as Record<string, unknown>[]).map(normalizeEvidence),
        tags: (r.tags ?? []) as string[],
    };
}

function normalizeConceptItem(raw: unknown): ConceptItem {
    if (!raw || typeof raw !== "object") return { id: "", item_type: "", content: "", evidence: [], tags: [], canonical_name: "", title: "", aliases: [], description: "" };
    const r = raw as Record<string, unknown>;
    return {
        id: String(r.id ?? ""),
        item_type: String(r.item_type ?? r.itemType ?? ""),
        content: String(r.content ?? ""),
        evidence: ((r.evidence ?? []) as Record<string, unknown>[]).map(normalizeEvidence),
        tags: (r.tags ?? []) as string[],
        canonical_name: String(r.canonical_name ?? r.canonicalName ?? ""),
        title: String(r.title ?? ""),
        aliases: (r.aliases ?? []) as string[],
        description: String(r.description ?? ""),
    };
}

function normalizeSentiment(raw: unknown): EventSentiment {
    if (!raw || typeof raw !== "object") return { overall: "", important_emotions: [] };
    const s = raw as Record<string, unknown>;
    return {
        overall: (s.overall ?? s.overall_sentiment ?? "") as string,
        important_emotions: (s.important_emotions ?? s.importantEmotions ?? []) as string[],
    };
}

function normalizeKnowledgeItems(raw: unknown): KnowledgeItem[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => {
        if (!item || typeof item !== "object") return { id: "", item_type: "", content: "", evidence: [], tags: [] };
        return normalizeKnowledgeItem(item as Record<string, unknown>);
    });
}

function normalizeQuestionItems(raw: unknown): QuestionItem[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => {
        if (!item || typeof item !== "object") return { id: "", item_type: "", content: "", evidence: [], tags: [], status: "open" as const };
        const r = item as Record<string, unknown>;
        return {
            ...normalizeKnowledgeItem(r),
            status: (r.status ?? "open") as "open" | "answered" | "partially_answered",
            answer: r.answer as string | undefined,
        };
    });
}

function normalizeTaskItems(raw: unknown): TaskItem[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => {
        if (!item || typeof item !== "object") return { id: "", item_type: "", content: "", evidence: [], tags: [], assignee: undefined, due_date: undefined };
        const r = item as Record<string, unknown>;
        return {
            ...normalizeKnowledgeItem(r),
            assignee: r.assignee as string | undefined,
            due_date: (r.due_date ?? r.dueDate) as string | undefined,
        };
    });
}

/**
 * Normalize a raw API response (snake_case or camelCase) into an EventKnowledge object.
 * Handles legacy MeetingNotes shapes where decisions/action_items/questions live at the top level.
 */
export function normalizeKnowledge(raw: Record<string, unknown>): EventKnowledge {
    return {
        schema_version: (raw.schema_version ?? raw.schemaVersion ?? 1) as number,
        event_type: (raw.event_type ?? raw.eventType ?? "") as string,
        title: (raw.title ?? "") as string,
        summary: (raw.summary ?? "") as string,
        concepts: ((raw.concepts ?? []) as Record<string, unknown>[]).map(normalizeConceptItem),
        key_points: normalizeKnowledgeItems(raw.key_points ?? raw.keyPoints ?? []),
        insights: normalizeKnowledgeItems(raw.insights ?? []),
        questions: normalizeQuestionItems(raw.questions ?? []),
        decisions: normalizeKnowledgeItems(raw.decisions ?? []),
        action_items: normalizeTaskItems(raw.action_items ?? raw.actionItems ?? []),
        observations: normalizeKnowledgeItems(raw.observations ?? []),
        references: normalizeKnowledgeItems(raw.references ?? []),
        related_topics: (raw.related_topics ?? raw.relatedTopics ?? []) as string[],
        sentiment: normalizeSentiment(raw.sentiment ?? raw.sentiment),
    };
}

/**
 * Resolve 'en' or 'default' from a knowledge_by_language map.
 * Only looks at 'en' and 'default' — no arbitrary fallback.
 * Returns null if neither is available.
 */
export function getKnowledgeForLanguage(
    knowledgeByLanguage: Record<string, unknown> | null | undefined
): EventKnowledge | null {
    if (!knowledgeByLanguage) return null;

    const en = knowledgeByLanguage["en"];
    const def = knowledgeByLanguage["default"];

    const raw: unknown = en ?? def ?? null;
    if (!raw || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;

    // Legacy MeetingNotes shape: decisions/action_items/questions at top level
    // Also handles decisions: string[], action_items: [{ task: string, ... }], etc.
    // and camelCase variants (actionItems, keyPoints, questionsAndAnswers)
    const hasTopLevelItems =
        rec.decisions || rec.action_items || rec.actionItems ||
        rec.questions || rec.key_points || rec.keyPoints ||
        rec.questions_and_answers || rec.questionsAndAnswers ||
        // Legacy string-array decisions
        (Array.isArray(rec.decisions) && rec.decisions.every((d: unknown) => typeof d === "string"));
    if (hasTopLevelItems) {
        return normalizeLegacyKnowledge(rec);
    }

    // Wrapped in a 'knowledge' key
    const inner = rec.knowledge;
    if (inner && typeof inner === "object") {
        return normalizeKnowledge(inner as Record<string, unknown>);
    }

    return normalizeKnowledge(rec);
}

/**
 * Normalize legacy MeetingNotes shapes:
 * - decisions: string[]         → KnowledgeItem[]
 * - action_items: [{ task: string, ... }]  → TaskItem[]
 * - questions_and_answers: [{ question: string, answer: string, ... }] → QuestionItem[]
 * - key_points: string[]        → KnowledgeItem[]
 * Also handles normal structured shapes (snake_case / camelCase).
 */
function normalizeLegacyKnowledge(rec: Record<string, unknown>): EventKnowledge {
    const decisions: KnowledgeItem[] = normalizeLegacyDecisions(rec.decisions);
    const actionItems: TaskItem[] = normalizeLegacyActionItems(rec.action_items ?? rec.actionItems);
    const questions: QuestionItem[] = normalizeLegacyQuestions(rec.questions, rec.questions_and_answers ?? rec.questionsAndAnswers);
    const keyPoints: KnowledgeItem[] = normalizeLegacyKeyPoints(rec.key_points ?? rec.keyPoints);

    return {
        schema_version: (rec.schema_version ?? rec.schemaVersion ?? 1) as number,
        event_type: (rec.event_type ?? rec.eventType ?? "") as string,
        title: (rec.title ?? "") as string,
        summary: (rec.summary ?? "") as string,
        concepts: ((rec.concepts ?? []) as Record<string, unknown>[]).map(normalizeConceptItem),
        key_points: keyPoints,
        insights: normalizeKnowledgeItems(rec.insights ?? []),
        questions,
        decisions,
        action_items: actionItems,
        observations: normalizeKnowledgeItems(rec.observations ?? []),
        references: normalizeKnowledgeItems(rec.references ?? []),
        related_topics: (rec.related_topics ?? rec.relatedTopics ?? []) as string[],
        sentiment: normalizeSentiment(rec.sentiment ?? rec.sentiment),
    };
}

function normalizeLegacyDecisions(raw: unknown): KnowledgeItem[] {
    if (!raw) return [];
    // Modern: KnowledgeItem[]
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
        return normalizeKnowledgeItems(raw);
    }
    // Legacy: string[]
    if (Array.isArray(raw)) {
        return raw.map((d: unknown, i: number) => ({
            id: `legacy-decision-${i}`,
            item_type: "decision",
            content: typeof d === "string" ? d : "",
            evidence: [],
            tags: [],
        })).filter(d => d.content);
    }
    return [];
}

function normalizeLegacyActionItems(raw: unknown): TaskItem[] {
    if (!raw) return [];
    if (!Array.isArray(raw)) return [];
    return raw.map((item: unknown, i: number) => {
        if (!item || typeof item !== "object") return { id: "", item_type: "", content: "", evidence: [], tags: [], assignee: undefined, due_date: undefined };
        const r = item as Record<string, unknown>;
        // Legacy: { task: string, assignee?, due_date? }
        const content = String(r.task ?? r.content ?? "");
        return {
            id: String(r.id ?? `legacy-action-${i}`),
            item_type: String(r.item_type ?? r.itemType ?? "action_item"),
            subtype: r.subtype as string | undefined,
            content,
            confidence: r.confidence as number | undefined,
            sentiment: r.sentiment as string | undefined,
            evidence: ((r.evidence ?? []) as Record<string, unknown>[]).map(normalizeEvidence),
            tags: (r.tags ?? []) as string[],
            assignee: r.assignee as string | undefined,
            due_date: (r.due_date ?? r.dueDate) as string | undefined,
        };
    }).filter(item => item.content);
}

function normalizeLegacyQuestions(raw: unknown, legacyQandA?: unknown): QuestionItem[] {
    // Modern: QuestionItem[]
    if (raw && Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
        return normalizeQuestionItems(raw);
    }
    // Legacy: questions_and_answers: [{ question: string, answer?: string }]
    if (legacyQandA && Array.isArray(legacyQandA)) {
        return legacyQandA.map((item: unknown, i: number) => {
            if (!item || typeof item !== "object") return { id: "", item_type: "", content: "", evidence: [], tags: [], status: "open" as const };
            const r = item as Record<string, unknown>;
            const question = String(r.question ?? "");
            const answer = r.answer as string | undefined;
            return {
                id: String(r.id ?? `legacy-question-${i}`),
                item_type: "question",
                content: question,
                evidence: [],
                tags: [],
                status: answer ? "answered" as const : "open" as const,
                answer,
            };
        }).filter(q => q.content);
    }
    return [];
}

function normalizeLegacyKeyPoints(raw: unknown): KnowledgeItem[] {
    if (!raw) return [];
    // Modern: KnowledgeItem[]
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
        return normalizeKnowledgeItems(raw);
    }
    // Legacy: string[]
    if (Array.isArray(raw)) {
        return raw.map((d: unknown, i: number) => ({
            id: `legacy-kp-${i}`,
            item_type: "key_point",
            content: typeof d === "string" ? d : "",
            evidence: [],
            tags: [],
        })).filter(d => d.content);
    }
    return [];
}

// ---------------------------------------------------------------------------
// Project Overview Types
// ---------------------------------------------------------------------------

export interface ProjectKnowledgeItem {
    itemType: 'decision' | 'action_item' | 'question';
    content: string;
    sourceEventId: string;
    sourceEventTitle: string;
    sourceEventDate: string;
    tags: string[];
    assignee?: string;
    dueDate?: string;
    questionStatus?: "open" | "answered" | "partially_answered";
    answer?: string;
}

export interface ProjectKnowledgeOverview {
    allItems: ProjectKnowledgeItem[];
    decisions: ProjectKnowledgeItem[];
    actionItems: ProjectKnowledgeItem[];
    questions: ProjectKnowledgeItem[];
    decisionsCount: number;
    actionItemsCount: number;
    questionsCount: number;
    missingEvents: Array<{
        id: string;
        title: string;
        date: string;
    }>;
}

/** Meeting from the API including knowledge_by_language and default_language */
export interface MeetingWithKnowledge {
    id: string;
    title: string;
    created_at: string;
    knowledge_by_language: Record<string, unknown> | null;
    default_language: string | null;
}

/**
 * Aggregate knowledge from all meetings in a project using 'en' or 'default'.
 * Falls back to 'default' when 'en' is absent.
 * Returns grouped decisions, action items, and questions with source event info.
 * Missing events (no en/default knowledge) are listed separately.
 * Does NOT use meeting.default_language — only en/default for project-level aggregation.
 */
export function aggregateProjectKnowledge(meetings: MeetingWithKnowledge[]): ProjectKnowledgeOverview {
    const decisions: ProjectKnowledgeItem[] = [];
    const actionItems: ProjectKnowledgeItem[] = [];
    const questions: ProjectKnowledgeItem[] = [];
    const missingEvents: ProjectKnowledgeOverview["missingEvents"] = [];

    // Sort by date descending
    const sorted = [...meetings].sort((a, b) => {
        const da = new Date(a.created_at).getTime();
        const db = new Date(b.created_at).getTime();
        return isNaN(db) ? -1 : isNaN(da) ? 1 : db - da;
    });

    for (const meeting of sorted) {
        const knowledge = getKnowledgeForLanguage(meeting.knowledge_by_language);

        if (!knowledge) {
            missingEvents.push({
                id: meeting.id,
                title: meeting.title,
                date: meeting.created_at,
            });
            continue;
        }

        const meta = {
            sourceEventId: meeting.id,
            sourceEventTitle: meeting.title,
            sourceEventDate: meeting.created_at,
        };

        for (const item of knowledge.decisions || []) {
            decisions.push({ ...meta, itemType: 'decision' as const, content: item.content, tags: item.tags || [] });
        }
        for (const item of knowledge.action_items || []) {
            actionItems.push({ ...meta, itemType: 'action_item' as const, content: item.content, tags: item.tags || [], assignee: item.assignee, dueDate: item.due_date });
        }
        for (const item of knowledge.questions || []) {
            questions.push({
                ...meta,
                itemType: 'question' as const,
                content: item.content,
                tags: item.tags || [],
                questionStatus: item.status,
                answer: item.answer,
            });
        }
    }

    const allItems: ProjectKnowledgeItem[] = [...decisions, ...actionItems, ...questions]
        .sort((a, b) => new Date(b.sourceEventDate).getTime() - new Date(a.sourceEventDate).getTime());

    return {
        allItems,
        decisions,
        actionItems,
        questions,
        decisionsCount: decisions.length,
        actionItemsCount: actionItems.length,
        questionsCount: questions.length,
        missingEvents,
    };
}