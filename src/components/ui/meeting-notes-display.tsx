"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotesLanguageSwitcher } from "@/components/ui/notes-language-switcher";
import { apiFetch } from "@/lib/apiFetch";
import { 
    FileText, 
    Hash, 
    ListTodo, 
    Gavel, 
    Lightbulb, 
    HelpCircle,
    Loader2
} from "lucide-react";
import { toast } from "sonner";

interface MeetingNotes {
    summary: string;
    keyTopics: string[];
    actionItems: string[];
    decisions: string[];
    assumptions: string[];
    qa: Array<{ question: string; answer: string }>;
}

interface RawActionItem {
    task?: string;
}

interface RawQuestionAndAnswer {
    question: string;
    answer: string;
}

interface RawMeetingNotes {
    summary?: string;
    keyTopics?: string[];
    key_points?: string[];
    actionItems?: string[];
    action_items?: Array<string | RawActionItem>;
    decisions?: string[];
    assumptions?: string[];
    qa?: RawQuestionAndAnswer[];
    questions_and_answers?: RawQuestionAndAnswer[];
}

interface MeetingNotesDisplayProps {
    meetingId: string;
    initialNotes: RawMeetingNotes | null;
    initialLanguage?: string;
}

function normalizeNotes(raw: RawMeetingNotes | null | undefined): MeetingNotes | null {
    if (!raw) {
        return null;
    }

    const actionItems = raw.actionItems
        ?? raw.action_items?.map((item) => typeof item === "string" ? item : item.task ?? "").filter(Boolean)
        ?? [];

    return {
        summary: raw.summary ?? "",
        keyTopics: raw.keyTopics ?? raw.key_points ?? [],
        actionItems,
        decisions: raw.decisions ?? [],
        assumptions: raw.assumptions ?? [],
        qa: raw.qa ?? raw.questions_and_answers ?? [],
    };
}

export function MeetingNotesDisplay({ 
    meetingId, 
    initialNotes,
    initialLanguage = 'en'
}: MeetingNotesDisplayProps) {
    const [notes, setNotes] = useState<MeetingNotes | null>(() => normalizeNotes(initialNotes));
    const [availableLanguages, setAvailableLanguages] = useState<string[]>([initialLanguage]);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        // Fetch available languages for this meeting
        const fetchMetadata = async () => {
            try {
                const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/metadata`);
                if (response.ok) {
                    const data = await response.json();
                    setAvailableLanguages(data.availableLanguages || [initialLanguage]);
                }
            } catch (error) {
                console.error('Error fetching metadata:', error);
            }
        };
        fetchMetadata();
    }, [meetingId, initialLanguage]);

    const handleNotesChange = (newNotes: MeetingNotes) => {
        setNotes(normalizeNotes(newNotes));
    };

    const handleGenerateNotes = async () => {
        setIsGenerating(true);
        try {
            const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/extract`, {
                method: "POST",
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(
                    typeof data === "object" && data && "error" in data
                        ? String(data.error)
                        : "Failed to generate notes"
                );
            }

            const data = await response.json() as { notes?: RawMeetingNotes };
            setNotes(normalizeNotes(data.notes));
            toast.success("Notes generated successfully.");
        } catch (error) {
            console.error("Failed to generate notes:", error);
            toast.error(error instanceof Error ? error.message : "Failed to generate notes. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Language Switcher */}
            <div className="flex justify-end">
                <NotesLanguageSwitcher 
                    meetingId={meetingId}
                    availableLanguages={availableLanguages}
                    currentLanguage={initialLanguage}
                    onNotesChange={handleNotesChange}
                />
            </div>
            {notes ? (
                <>
                    {/* Summary */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="size-5 text-blue-500" />
                                Executive Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="prose prose-sm max-w-none dark:prose-invert">
                                <p className="whitespace-pre-wrap leading-relaxed">{notes.summary}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-6 md:grid-cols-2">
                        {/* Key Topics */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Hash className="size-5 text-indigo-500" />
                                    Key Topics
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {notes.keyTopics && notes.keyTopics.length > 0 ? (
                                    <ul className="space-y-2">
                                        {notes.keyTopics.map((item, i) => (
                                            <li key={i} className="flex gap-3 text-sm">
                                                <div className="mt-1 size-1.5 rounded-full bg-indigo-500 shrink-0" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No key topics detected.</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Action Items */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ListTodo className="size-5 text-green-500" />
                                    Action Items
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {notes.actionItems && notes.actionItems.length > 0 ? (
                                    <ul className="space-y-2">
                                        {notes.actionItems.map((item, i) => (
                                            <li key={i} className="flex gap-3 text-sm">
                                                <div className="mt-1 size-1.5 rounded-full bg-green-500 shrink-0" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No action items detected.</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Decisions */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Gavel className="size-5 text-orange-500" />
                                    Key Decisions
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {notes.decisions && notes.decisions.length > 0 ? (
                                    <ul className="space-y-2">
                                        {notes.decisions.map((item, i) => (
                                            <li key={i} className="flex gap-3 text-sm">
                                                <div className="mt-1 size-1.5 rounded-full bg-orange-500 shrink-0" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No decisions detected.</p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Assumptions */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Lightbulb className="size-5 text-yellow-500" />
                                    Assumptions
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {notes.assumptions && notes.assumptions.length > 0 ? (
                                    <ul className="space-y-2">
                                        {notes.assumptions.map((item, i) => (
                                            <li key={i} className="flex gap-3 text-sm">
                                                <div className="mt-1 size-1.5 rounded-full bg-yellow-500 shrink-0" />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-sm text-muted-foreground italic">No assumptions detected.</p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Q&A */}
                    {notes.qa && notes.qa.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <HelpCircle className="size-5 text-purple-500" />
                                    Q&A
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {notes.qa.map((qa, i) => (
                                        <div key={i} className="space-y-1">
                                            <p className="font-medium text-sm text-primary">Q: {qa.question}</p>
                                            <p className="text-sm text-muted-foreground">A: {qa.answer}</p>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </>
            ) : (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center p-12 text-center space-y-4">
                        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
                            <FileText className="size-8 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-lg font-medium">No Notes Generated Yet</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto">
                                The notes for this meeting haven&apos;t been generated or are currently processing.
                            </p>
                        </div>
                        <Button onClick={handleGenerateNotes} disabled={isGenerating}>
                            {isGenerating ? (
                                <>
                                    <Loader2 className="size-4 mr-2 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                "Generate Notes"
                            )}
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
