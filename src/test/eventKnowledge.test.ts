import { describe, it, expect } from "vitest";
import {
    aggregateProjectKnowledge,
    filterProjectKnowledgeOverview,
    groupProjectKnowledgeTimeline,
    getAvailableMonths,
    filterProjectKnowledgeByMonth,
    getProjectKnowledgeMonthKey,
    subtypeLabel,
    groupObservationsWithContent,
    type ProjectKnowledgeOverview,
    type ProjectKnowledgeItem,
    type MeetingWithKnowledge,
    type KnowledgeItem,
} from "@/lib/eventKnowledge";

/** Snake_case API question item shape — used for raw test fixtures before normalization */
interface RawQuestionItem {
    id: string;
    item_type: string;
    content: string;
    evidence: unknown[];
    tags: string[];
    status: "open" | "answered" | "partially_answered";
    answer?: string;
}

function makeMeeting(
    id: string,
    title: string,
    created_at: string,
    decisions?: ProjectKnowledgeItem[],
    actionItems?: ProjectKnowledgeItem[],
    questions?: RawQuestionItem[]
): MeetingWithKnowledge {
    const knowledge = {
        schema_version: 1,
        event_type: "meeting",
        title,
        summary: "",
        concepts: [],
        key_points: [],
        insights: [],
        decisions: decisions ?? [],
        action_items: actionItems ?? [],
        questions: questions ?? [],
        observations: [],
        references: [],
        related_topics: [],
        sentiment: { overall: "", important_emotions: [] },
    };
    return {
        id,
        title,
        created_at,
        knowledge_by_language: { en: { knowledge } },
        default_language: "en",
    };
}

function ki(content: string, tags: string[] = []): ProjectKnowledgeItem {
    return {
        itemType: "decision",
        content,
        sourceEventId: "evt-1",
        sourceEventTitle: "Team Sync",
        sourceEventDate: "2025-01-15T10:00:00Z",
        tags,
    };
}

function task(content: string, assignee?: string, dueDate?: string): ProjectKnowledgeItem {
    return {
        itemType: "action_item",
        content,
        sourceEventId: "evt-1",
        sourceEventTitle: "Team Sync",
        sourceEventDate: "2025-01-15T10:00:00Z",
        tags: [],
        assignee,
        dueDate,
    };
}

function q(content: string, status: "open" | "answered" | "partially_answered" = "open", answer?: string): RawQuestionItem {
    return {
        id: `q-${Math.random().toString(36).slice(2)}`,
        item_type: "question",
        content,
        evidence: [],
        tags: [],
        status,
        answer,
    };
}

function buildOverview(meetings: MeetingWithKnowledge[]): ProjectKnowledgeOverview {
    return aggregateProjectKnowledge(meetings);
}

describe("filterProjectKnowledgeOverview", () => {
    it("returns original counts/items when query is empty", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Go with Postgres")], [task("Write tests", "Alice", "2025-01-20")], [q("Which DB?", "answered", "Postgres")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "");

        expect(result.allCount).toBe(3);
        expect(result.decisionsCount).toBe(1);
        expect(result.actionItemsCount).toBe(1);
        expect(result.questionsCount).toBe(1);
        expect(result.missingEventsCount).toBe(0);
        expect(result.allItems).toEqual(overview.allItems);
    });

    it("returns original counts/items when query is whitespace only", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Go with Postgres")], [task("Write tests", "Alice", "2025-01-20")], [q("Which DB?", "answered", "Postgres")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "   ");

        expect(result.allCount).toBe(3);
        expect(result.decisions).toEqual(overview.decisions);
    });

    it("matches content in decisions", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Go with Postgres"), ki("Use Rust for backend")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "postgres");

        expect(result.decisionsCount).toBe(1);
        expect(result.decisions[0].content).toBe("Go with Postgres");
    });

    it("matches content in action items", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [], [task("Write tests"), task("Deploy to prod")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "tests");

        expect(result.actionItemsCount).toBe(1);
        expect(result.actionItems[0].content).toBe("Write tests");
    });

    it("matches content in questions", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [], [], [q("Which DB?"), q("When to ship?")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "ship");

        expect(result.questionsCount).toBe(1);
        expect(result.questions[0].content).toBe("When to ship?");
    });

    it("matches source event title across tabs", () => {
        const meetings = [
            makeMeeting("1", "Budget Review", "2025-01-15T10:00:00Z", [ki("Approve budget")], [task("Send report")], [q("Approved?")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "budget");

        expect(result.allCount).toBe(3);
        expect(result.decisionsCount).toBe(1);
        expect(result.actionItemsCount).toBe(1);
        expect(result.questionsCount).toBe(1);
    });

    it("matches assignee in action items", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [], [task("Write tests", "Alice"), task("Deploy", "Bob")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "alice");

        expect(result.actionItemsCount).toBe(1);
        expect(result.actionItems[0].assignee).toBe("Alice");
    });

    it("matches due date in action items", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [], [task("Write tests", "Alice", "2025-01-20")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "2025");

        expect(result.actionItemsCount).toBe(1);
        expect(result.actionItems[0].dueDate).toBe("2025-01-20");
    });

    it("matches tags across item types", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A", ["priority"])], [task("Task B")], [q("Question C", "open")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "priority");

        expect(result.allCount).toBe(1);
        expect(result.decisions[0].tags).toContain("priority");
    });

    it("matches question status via status field", () => {
        // rawQuestions uses snake_case per API convention; normalizeQuestionItems reads r.status
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [], [], [
                { id: "q1", item_type: "question", content: "Open question?", evidence: [], tags: [], status: "open" as const },
                { id: "q2", item_type: "question", content: "Answered question?", evidence: [], tags: [], status: "answered" as const, answer: "Yes" },
            ]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "answered");

        expect(result.questionsCount).toBe(1);
        const answeredQ = result.questions.find(q => q.questionStatus === "answered");
        expect(answeredQ).toBeDefined();
        expect(answeredQ!.content).toBe("Answered question?");
    });

    it("matches answer in questions", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [], [], [q("Which DB?", "answered", "Postgres")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "postgres");

        expect(result.questionsCount).toBe(1);
        expect(result.questions[0].answer).toBe("Postgres");
    });

    it("matches Needs Extraction by event title", () => {
        // Meeting with no knowledge_by_language → treated as missing event
        const meetings: MeetingWithKnowledge[] = [
            { id: "1", title: "Team Sync", created_at: "2025-01-15T10:00:00Z", knowledge_by_language: null, default_language: null },
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "team");

        expect(result.missingEventsCount).toBe(1);
        expect(result.missingEvents[0].title).toBe("Team Sync");
    });

    it("matches Needs Extraction by raw date", () => {
        const meetings: MeetingWithKnowledge[] = [
            { id: "1", title: "Q1 Planning", created_at: "2025-01-15T10:00:00Z", knowledge_by_language: null, default_language: null },
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "2025-01-15");

        expect(result.missingEventsCount).toBe(1);
    });

    it("matches Needs Extraction by formatted date", () => {
        const meetings: MeetingWithKnowledge[] = [
            { id: "1", title: "Q1 Planning", created_at: "2025-01-15T10:00:00Z", knowledge_by_language: null, default_language: null },
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "Jan 15, 2025");

        expect(result.missingEventsCount).toBe(1);
    });

    it("returns empty arrays for no-match query", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Go with Postgres")], [task("Write tests")], [q("Which DB?")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "xyz123");

        expect(result.allCount).toBe(0);
        expect(result.decisionsCount).toBe(0);
        expect(result.actionItemsCount).toBe(0);
        expect(result.questionsCount).toBe(0);
        expect(result.missingEventsCount).toBe(0);
        expect(result.allItems).toEqual([]);
    });

    it("is case insensitive", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Go with Postgres")]),
        ];
        const overview = buildOverview(meetings);

        expect(filterProjectKnowledgeOverview(overview, "POSTGRES").decisionsCount).toBe(1);
        expect(filterProjectKnowledgeOverview(overview, "postgres").decisionsCount).toBe(1);
        expect(filterProjectKnowledgeOverview(overview, "Go WitH poStgReS").decisionsCount).toBe(1);
    });

    it("trims query before searching", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Go with Postgres")]),
        ];
        const overview = buildOverview(meetings);

        expect(filterProjectKnowledgeOverview(overview, "  postgres  ").decisionsCount).toBe(1);
    });

    it("shows all matching results without slice when searching", () => {
        const manyDecisions = Array.from({ length: 10 }, (_, i) => ki(`Decision ${i}`));
        const meetings = [makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", manyDecisions)];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeOverview(overview, "decision");

        expect(result.decisions.length).toBe(10);
        expect(result.decisionsCount).toBe(10);
    });
});

describe("getAvailableMonths", () => {
    it("returns All time first", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")]),
        ];
        const overview = buildOverview(meetings);
        const options = getAvailableMonths(overview);

        expect(options[0]).toEqual({ label: "All time", value: "all" });
    });

    it("generates months newest first", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")]),
            makeMeeting("2", "Budget Review", "2024-11-20T10:00:00Z", [ki("Decision B")]),
        ];
        const overview = buildOverview(meetings);
        const options = getAvailableMonths(overview);

        expect(options.length).toBe(3); // "All time" + 2 months
        expect(options[1].value).toBe("2025-01");
        expect(options[2].value).toBe("2024-11");
    });

    it("excludes invalid dates from month options", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")]),
            // missing event has empty date
            { id: "2", title: "Bad Event", created_at: "", knowledge_by_language: null, default_language: null },
        ] as MeetingWithKnowledge[];
        const overview = buildOverview(meetings);
        const options = getAvailableMonths(overview);

        expect(options.length).toBe(2); // "All time" + 1 valid month
        expect(options.find(o => o.value === "all")).toBeDefined();
    });
});

describe("filterProjectKnowledgeByMonth", () => {
    it("All time returns the original overview", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")], [task("Action A")], [q("Question A")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeByMonth(overview, "all");

        expect(result.allItems.length).toBe(3);
        expect(result.decisionsCount).toBe(1);
        expect(result.actionItemsCount).toBe(1);
        expect(result.questionsCount).toBe(1);
    });

    it("filters allItems to matching month", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")]),
            makeMeeting("2", "Budget Review", "2024-11-20T10:00:00Z", [ki("Decision B")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeByMonth(overview, "2025-01");

        expect(result.allItems.length).toBe(1);
        expect(result.allItems[0].content).toBe("Decision A");
    });

    it("updates decisions/actionItems/questions counts after month filter", () => {
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")], [task("Action A")], [q("Question A")]),
            makeMeeting("2", "Budget Review", "2024-11-20T10:00:00Z", [ki("Decision B")], [task("Action B")], [q("Question B")]),
        ];
        const overview = buildOverview(meetings);
        const result = filterProjectKnowledgeByMonth(overview, "2025-01");

        expect(result.decisionsCount).toBe(1);
        expect(result.decisions[0].content).toBe("Decision A");
        expect(result.actionItemsCount).toBe(1);
        expect(result.questionsCount).toBe(1);
    });

    it("excludes items with missing/invalid dates from month filter", () => {
        const items: ProjectKnowledgeItem[] = [
            { itemType: "decision", content: "Valid date", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-15T10:00:00Z", tags: [] },
            { itemType: "decision", content: "Missing date", sourceEventId: "2", sourceEventTitle: "Event B", sourceEventDate: "", tags: [] },
            { itemType: "decision", content: "Invalid date", sourceEventId: "3", sourceEventTitle: "Event C", sourceEventDate: "not-a-date", tags: [] },
        ];
        const overview: ProjectKnowledgeOverview = {
            allItems: items,
            decisions: items,
            actionItems: [],
            questions: [],
            decisionsCount: 3,
            actionItemsCount: 0,
            questionsCount: 0,
            missingEvents: [],
        };
        const result = filterProjectKnowledgeByMonth(overview, "2025-01");

        expect(result.allItems.length).toBe(1);
        expect(result.allItems[0].content).toBe("Valid date");
    });

    it("includes unknown-date items in All time only", () => {
        const overview: ProjectKnowledgeOverview = {
            allItems: [
                { itemType: "decision", content: "Valid", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-15T10:00:00Z", tags: [] },
                { itemType: "decision", content: "Unknown", sourceEventId: "2", sourceEventTitle: "Event B", sourceEventDate: "", tags: [] },
            ],
            decisions: [],
            actionItems: [],
            questions: [],
            decisionsCount: 2,
            actionItemsCount: 0,
            questionsCount: 0,
            missingEvents: [],
        };
        const allResult = filterProjectKnowledgeByMonth(overview, "all");
        expect(allResult.allItems.length).toBe(2);

        const monthResult = filterProjectKnowledgeByMonth(overview, "2025-01");
        expect(monthResult.allItems.length).toBe(1);
        expect(monthResult.allItems[0].content).toBe("Valid");
    });
});

describe("groupProjectKnowledgeTimeline", () => {
    it("groups items by event date", () => {
        const items: ProjectKnowledgeItem[] = [
            { itemType: "decision", content: "Decision 1", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-15T10:00:00Z", tags: [] },
            { itemType: "action_item", content: "Action 1", sourceEventId: "2", sourceEventTitle: "Event B", sourceEventDate: "2025-01-20T10:00:00Z", tags: [] },
        ];
        const groups = groupProjectKnowledgeTimeline(items);

        expect(groups.length).toBe(2);
    });

    it("sorts groups newest first", () => {
        const items: ProjectKnowledgeItem[] = [
            { itemType: "decision", content: "Older", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-10T10:00:00Z", tags: [] },
            { itemType: "decision", content: "Newer", sourceEventId: "2", sourceEventTitle: "Event B", sourceEventDate: "2025-01-20T10:00:00Z", tags: [] },
        ];
        const groups = groupProjectKnowledgeTimeline(items);

        expect(groups[0].dateLabel).toMatch(/Jan 20/);
        expect(groups[1].dateLabel).toMatch(/Jan 10/);
    });

    it("preserves multiple knowledge items from the same event/date", () => {
        const items: ProjectKnowledgeItem[] = [
            { itemType: "decision", content: "Decision 1", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-15T10:00:00Z", tags: [] },
            { itemType: "decision", content: "Decision 2", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-15T10:00:00Z", tags: [] },
            { itemType: "action_item", content: "Action 1", sourceEventId: "2", sourceEventTitle: "Event B", sourceEventDate: "2025-01-20T10:00:00Z", tags: [] },
        ];
        const groups = groupProjectKnowledgeTimeline(items);

        expect(groups.length).toBe(2);
        const jan20Group = groups.find(g => g.dateLabel.includes("Jan 20"));
        expect(jan20Group?.items.length).toBe(1);
        const jan15Group = groups.find(g => g.dateLabel.includes("Jan 15"));
        expect(jan15Group?.items.length).toBe(2);
    });

    it("handles invalid or missing dates by placing them under Unknown date", () => {
        const items: ProjectKnowledgeItem[] = [
            { itemType: "decision", content: "Valid date", sourceEventId: "1", sourceEventTitle: "Event A", sourceEventDate: "2025-01-15T10:00:00Z", tags: [] },
            { itemType: "decision", content: "Missing date", sourceEventId: "2", sourceEventTitle: "Event B", sourceEventDate: "", tags: [] },
            { itemType: "decision", content: "Invalid date", sourceEventId: "3", sourceEventTitle: "Event C", sourceEventDate: "not-a-date", tags: [] },
        ];
        const groups = groupProjectKnowledgeTimeline(items);

        const unknownGroup = groups.find(g => g.dateLabel === "Unknown date");
        expect(unknownGroup).toBeDefined();
        expect(unknownGroup!.items.length).toBe(2);
    });
});

describe("getProjectKnowledgeMonthKey", () => {
    it("returns null for empty string", () => {
        expect(getProjectKnowledgeMonthKey("")).toBeNull();
    });

    it("returns null for invalid date", () => {
        expect(getProjectKnowledgeMonthKey("not-a-date")).toBeNull();
    });

    it("returns YYYY-MM for valid ISO timestamp", () => {
        expect(getProjectKnowledgeMonthKey("2025-01-15T10:00:00Z")).toBe("2025-01");
    });

    it("returns YYYY-MM padded for single-digit months", () => {
        expect(getProjectKnowledgeMonthKey("2025-03-01T10:00:00Z")).toBe("2025-03");
    });
});

describe("getAvailableMonths", () => {
    it("handles non-ISO date strings through the shared helper", () => {
        // Local date string (not strict ISO) — the helper should parse it safely
        const meetings = [
            makeMeeting("1", "Team Sync", "2025/01/15", [ki("Decision A")]),
        ];
        const overview = buildOverview(meetings);
        const options = getAvailableMonths(overview);

        expect(options.length).toBe(2); // "All time" + 1 month
        expect(options[1].value).toBe("2025-01");
    });

    it("filters UTC timestamp near month boundary to the correct local month", () => {
        // UTC midnight Jan 31 = local late Jan in UTC+ zones (e.g., UTC+8 → Feb 1 morning)
        // or local Jan in UTC- zones. We test that the month key matches local display.
        // The meeting date "2025-01-31T23:59:59Z" is Jan 31 in UTC but may be Feb 1 in UTC+12.
        // Our helper uses local getFullYear/getMonth so it matches the displayed month.
        const meetings = [
            makeMeeting("1", "Late Jan Event", "2025-01-31T23:59:59Z", [ki("Decision A")]),
        ];
        const overview = buildOverview(meetings);
        const options = getAvailableMonths(overview);

        // The month key should be derived from local date, matching what the UI displays
        const localDate = new Date("2025-01-31T23:59:59Z");
        const expectedMonth = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}`;
        expect(options[1].value).toBe(expectedMonth);
    });
});

describe("filterProjectKnowledgeByMonth", () => {
    it("uses local month key for all item types", () => {
        // Mixed item types all from the same meeting
        const meetings = [
            makeMeeting("1", "Team Sync", "2025-01-15T10:00:00Z", [ki("Decision A")], [task("Action A")], [q("Question A")]),
        ];
        const overview = buildOverview(meetings);

        // Filter to January — all three item types should match
        const result = filterProjectKnowledgeByMonth(overview, "2025-01");

        expect(result.allItems.length).toBe(3);
        expect(result.decisions.length).toBe(1);
        expect(result.actionItems.length).toBe(1);
        expect(result.questions.length).toBe(1);
    });

    it("uses local month key for missing events", () => {
        const meetings: MeetingWithKnowledge[] = [
            { id: "1", title: "Late Jan Event", created_at: "2025-01-31T23:59:59Z", knowledge_by_language: null, default_language: null },
        ];
        const overview = buildOverview(meetings);

        // Derive the expected month from local date parts (matches UI display)
        const localDate = new Date("2025-01-31T23:59:59Z");
        const localMonth = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}`;

        // The missing event should be found by the correct local month
        const result = filterProjectKnowledgeByMonth(overview, localMonth);

        expect(result.missingEvents.length).toBe(1);
    });

    it("UTC month boundary: late UTC month becomes correct local month", () => {
        // An event created at 23:59:59 UTC Jan 31 is Feb 1 in UTC+12, Jan 31 in UTC-12.
        // Regardless of timezone, the filter should match the month the UI would display.
        const meetings: MeetingWithKnowledge[] = [
            { id: "1", title: "Late Jan Event", created_at: "2025-01-31T23:59:59Z", knowledge_by_language: null, default_language: null },
        ];
        const overview = buildOverview(meetings);

        // Derive the expected local month
        const localDate = new Date("2025-01-31T23:59:59Z");
        const localMonth = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}`;

        const result = filterProjectKnowledgeByMonth(overview, localMonth);

        expect(result.missingEvents.length).toBe(1);
    });
});

describe("subtypeLabel", () => {
    it("converts student_difficulty to Student Difficulty", () => {
        expect(subtypeLabel("student_difficulty")).toBe("Student Difficulty");
    });

    it("converts balancing_issue to Balancing Issue", () => {
        expect(subtypeLabel("balancing_issue")).toBe("Balancing Issue");
    });

    it("returns General for undefined", () => {
        expect(subtypeLabel(undefined)).toBe("General");
    });

    it("returns General for empty string", () => {
        expect(subtypeLabel("")).toBe("General");
    });

    it("converts multi-word snake_case", () => {
        expect(subtypeLabel("some_multi_word_type")).toBe("Some Multi Word Type");
    });
});

describe("groupObservationsWithContent", () => {
    const makeObs = (id: string, subtype: string | undefined, content: string): KnowledgeItem =>
        ({ id, item_type: "observation", subtype, content, evidence: [], tags: [] });

    it("filters out observations with empty content", () => {
        const obs = [
            makeObs("1", "student_difficulty", "Students struggled"),
            makeObs("2", "student_difficulty", ""),
        ];
        const result = groupObservationsWithContent(obs);
        expect(result[0].items.length).toBe(1);
        expect(result[0].items[0].id).toBe("1");
    });

    it("groups multiple observations under the same subtype", () => {
        const obs = [
            makeObs("1", "student_difficulty", "Students struggled with algebra"),
            makeObs("2", "student_difficulty", "Confusion on fractions"),
        ];
        const result = groupObservationsWithContent(obs);
        expect(result.length).toBe(1);
        expect(result[0].label).toBe("Student Difficulty");
        expect(result[0].items.length).toBe(2);
    });

    it("sorts general to last", () => {
        const obs = [
            makeObs("1", "general", "General note"),
            makeObs("2", "student_difficulty", "Student note"),
        ];
        const result = groupObservationsWithContent(obs);
        expect(result[0].label).toBe("Student Difficulty");
        expect(result[1].label).toBe("General");
    });

    it("returns empty array when all observations have empty content", () => {
        const obs = [
            makeObs("1", "student_difficulty", ""),
        ];
        const result = groupObservationsWithContent(obs);
        expect(result.length).toBe(0);
    });

    it("treats missing subtype as general", () => {
        const obs = [
            makeObs("1", undefined, "No subtype"),
        ];
        const result = groupObservationsWithContent(obs);
        expect(result.length).toBe(1);
        expect(result[0].label).toBe("General");
    });
});