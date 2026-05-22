"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/apiFetch";
import {
    FileText,
    Hash,
    ListTodo,
    Gavel,
    Lightbulb,
    HelpCircle,
    Loader2,
    ChevronDown,
    ChevronRight,
    BookOpen,
    MessageSquare,
    Link as LinkIcon,
    Sparkles,
    Eye,
    Check,
} from "lucide-react";
import { toast } from "sonner";
import {
    EventKnowledge,
    KnowledgeItem,
    ConceptItem,
    normalizeKnowledge,
} from "@/lib/eventKnowledge";

interface LanguageDropdownProps {
    currentLanguage: string;
    availableLanguages: string[];
    onSelect: (langCode: string) => void;
    disabled?: boolean;
}

function LanguageDropdown({ currentLanguage, availableLanguages: _availableLanguages, onSelect, disabled }: LanguageDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className="flex items-center gap-1.5 text-sm border rounded-md px-2 py-1 bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="text-muted-foreground">Language:</span>
                <span className="font-medium">{currentLang?.name ?? currentLanguage}</span>
                <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] border rounded-md bg-popover shadow-md overflow-hidden">
                    {SUPPORTED_LANGUAGES.map((lang) => {
                        const isSelected = lang.code === currentLanguage;
                        return (
                            <button
                                key={lang.code}
                                type="button"
                                onClick={() => {
                                    onSelect(lang.code);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 hover:bg-muted transition-colors ${
                                    isSelected ? 'bg-muted font-medium' : ''
                                }`}
                            >
                                <span>{lang.name}</span>
                                {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

interface GetEventKnowledgeResponse {
    knowledge: EventKnowledge | null;
    language: string;
    needsRegeneration: boolean;
}

const SUPPORTED_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文 (Chinese)' },
    { code: 'ms', name: 'Bahasa Melayu' },
    { code: 'ja', name: '日本語 (Japanese)' },
    { code: 'ko', name: '한국어 (Korean)' },
    { code: 'es', name: 'Español (Spanish)' },
    { code: 'fr', name: 'Français (French)' },
    { code: 'de', name: 'Deutsch (German)' },
    { code: 'pt', name: 'Português (Portuguese)' },
    { code: 'it', name: 'Italiano (Italian)' },
    { code: 'th', name: 'ไทย (Thai)' },
    { code: 'vi', name: 'Tiếng Việt (Vietnamese)' },
    { code: 'id', name: 'Bahasa Indonesia' },
];

// Section priority by event type
const EVENT_TYPE_SECTIONS: Record<string, string[]> = {
    meeting: ["decisions", "action_items", "questions"],
    planning: ["decisions", "action_items", "questions"],
    standup: ["action_items"],
    client_discussion: ["decisions", "action_items", "questions"],
    design_review: ["insights", "decisions", "action_items"],
    retrospective: ["insights", "decisions", "action_items"],
    lecture: ["concepts", "insights"],
    workshop: ["concepts", "insights"],
    qa_session: ["questions", "concepts", "insights"],
    research: ["insights", "questions", "references"],
    brainstorm: ["insights", "questions", "concepts"],
    playtest: ["observations", "insights", "decisions"],
    interview: ["questions", "insights"],
    personal_reflection: ["insights", "observations"],
    demo_presentation: ["insights", "references"],
    podcast_video: ["insights", "references"],
};

const DEFAULT_SECTIONS = ["decisions", "action_items", "questions", "insights"];

// Find related items based on tags
function findRelatedItems<T extends { tags: string[]; id: string }>(
    item: T,
    allItems: T[],
    excludeSelf = true
): T[] {
    if (!item.tags || item.tags.length === 0) return [];
    return allItems.filter(other => {
        if (excludeSelf && other.id === item.id) return false;
        return other.tags && other.tags.some(tag => (item.tags as string[]).includes(tag));
    });
}

interface InlineContextProps {
    item: KnowledgeItem;
    knowledge: EventKnowledge;
}

function InlineContext({ item, knowledge }: InlineContextProps) {
    const [isOpen, setIsOpen] = useState(false);

    const relatedConcepts = (findRelatedItems(item, knowledge.concepts) as ConceptItem[]).filter(Boolean);
    const relatedInsights = findRelatedItems(item, knowledge.insights);
    const relatedReferences = findRelatedItems(item, knowledge.references);
    const relatedObservations = findRelatedItems(item, knowledge.observations);

    // Related topics: match via tags or content substring
    const relatedTopics = knowledge.related_topics?.filter(topic => {
        if (item.tags?.includes(topic)) return true;
        const lowerContent = item.content.toLowerCase();
        const lowerTopic = topic.toLowerCase();
        return lowerContent.includes(lowerTopic) || lowerTopic.includes(lowerContent.split(" ")[0] || "");
    }) || [];

    const hasEvidence = item.evidence && item.evidence.length > 0;
    const hasRelated = relatedConcepts.length > 0 || relatedInsights.length > 0 ||
        relatedReferences.length > 0 || relatedObservations.length > 0 || relatedTopics.length > 0;

    if (!hasEvidence && !hasRelated) return null;

    return (
        <div className="mt-2">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <Eye className="size-3" />
                {isOpen ? "Hide" : "Show"} context
                {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>

            {isOpen && (
                <div className="mt-2 space-y-2 border-l-2 border-muted pl-3">
                    {hasEvidence && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Sources</p>
                            {item.evidence!.slice(0, 2).map((e, i) => (
                                <p key={i} className="text-xs text-muted-foreground italic">&ldquo;{e.snippet}&rdquo;</p>
                            ))}
                        </div>
                    )}
                    {relatedTopics.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Related Topics</p>
                            <div className="flex flex-wrap gap-1">
                                {relatedTopics.map((topic) => (
                                    <Badge key={topic} variant="secondary" className="text-xs">{topic}</Badge>
                                ))}
                            </div>
                        </div>
                    )}
                    {relatedReferences.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Related References</p>
                            {relatedReferences.map((r, i) => (
                                <p key={i} className="text-xs">{r.content}</p>
                            ))}
                        </div>
                    )}
                    {relatedConcepts.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Related Concepts</p>
                            {relatedConcepts.map((c, i) => (
                                <p key={i} className="text-xs">{c.title}</p>
                            ))}
                        </div>
                    )}
                    {relatedInsights.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Related Insights</p>
                            {relatedInsights.map((ins, i) => (
                                <p key={i} className="text-xs">{ins.content}</p>
                            ))}
                        </div>
                    )}
                    {relatedObservations.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Nearby Observations</p>
                            {relatedObservations.map((obs, i) => (
                                <p key={i} className="text-xs">{obs.content}</p>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

interface DigestGridProps {
    knowledge: EventKnowledge;
}

function DigestGrid({ knowledge }: DigestGridProps) {
    const highlights = (knowledge.key_points || []).slice(0, 5);
    const decisions = knowledge.decisions || [];
    const actionItems = knowledge.action_items || [];
    const questions = knowledge.questions || [];

    return (
        <div className="grid gap-4 md:grid-cols-2 md:auto-rows-fr">
            {/* Highlights */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Hash className="size-5 text-indigo-500" />
                        Highlights
                        <Badge variant="secondary" className="ml-auto text-xs">{highlights.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {highlights.length > 0 ? (
                        <ul className="space-y-2">
                            {highlights.map((item, i) => (
                                <li key={item.id || i} className="flex gap-3 text-sm">
                                    <div className="mt-1.5 size-1.5 rounded-full bg-indigo-500 shrink-0" />
                                    <span>{item.content}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </CardContent>
            </Card>

            {/* Decisions */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Gavel className="size-5 text-orange-500" />
                        Decisions
                        <Badge variant="secondary" className="ml-auto text-xs">{decisions.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {decisions.length > 0 ? (
                        <div className="space-y-3">
                            {decisions.map((item, i) => (
                                <div key={item.id || i} className="flex gap-3 text-sm">
                                    <div className="mt-1 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <span>{item.content}</span>
                                        <InlineContext item={item} knowledge={knowledge} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {/* Action Items */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <ListTodo className="size-5 text-green-500" />
                        Action Items
                        <Badge variant="secondary" className="ml-auto text-xs">{actionItems.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {actionItems.length > 0 ? (
                        <div className="space-y-3">
                            {actionItems.map((item, i) => (
                                <div key={item.id || i} className="flex gap-3 text-sm">
                                    <div className="mt-1 shrink-0 text-green-500"><ListTodo className="size-4" /></div>
                                    <div className="flex-1 min-w-0">
                                        <span>{item.content}</span>
                                        <div className="flex gap-2 mt-1 flex-wrap">
                                            {item.assignee && <Badge variant="outline" className="text-xs">👤 {item.assignee}</Badge>}
                                            {item.due_date && <Badge variant="outline" className="text-xs">📅 {item.due_date}</Badge>}
                                        </div>
                                        <InlineContext item={item} knowledge={knowledge} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {/* Questions */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                        <HelpCircle className="size-5 text-purple-500" />
                        Questions
                        <Badge variant="secondary" className="ml-auto text-xs">{questions.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {questions.length > 0 ? (
                        <div className="space-y-4">
                            {questions.map((q, i) => (
                                <div key={q.id || i} className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-primary">Q: {q.content}</span>
                                        <Badge
                                            variant={q.status === "answered" ? "default" : q.status === "partially_answered" ? "outline" : "secondary"}
                                            className="text-xs"
                                        >
                                            {q.status.replace("_", " ")}
                                        </Badge>
                                    </div>
                                    <InlineContext item={q} knowledge={knowledge} />
                                </div>
                            ))}
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        </div>
    );
}

function _PrimaryItem({ item, knowledge }: { item: KnowledgeItem; knowledge: EventKnowledge }) {
    return (
        <div className="flex gap-3 text-sm">
            <div className="mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
                <span>{item.content}</span>
                <InlineContext item={item} knowledge={knowledge} />
            </div>
        </div>
    );
}

interface EventKnowledgeDisplayProps {
    eventId: string;
    initialLanguage?: string;
    meetingId?: string; // optional meeting id for metadata fetch
}

export function EventKnowledgeDisplay({ eventId, initialLanguage = "en", meetingId }: EventKnowledgeDisplayProps) {
    const [knowledge, setKnowledge] = useState<EventKnowledge | null>(null);
    const [language, setLanguage] = useState(initialLanguage);
    const [isLoading, setIsLoading] = useState(true);
    const [isExtracting, setIsExtracting] = useState(false);
    const [availableLanguages, setAvailableLanguages] = useState<string[]>([initialLanguage]);
    const [cachedKnowledge, setCachedKnowledge] = useState<Record<string, EventKnowledge | null>>({});

    const fetchKnowledge = useCallback(async (lang: string, forceRefresh = false) => {
        // If already cached and not forcing refresh, use cache
        if (!forceRefresh && cachedKnowledge[lang] !== undefined) {
            setKnowledge(cachedKnowledge[lang]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            const res = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/knowledge?language=${lang}`);
            if (!res.ok) throw new Error("Failed to fetch knowledge");
            const data = await res.json() as GetEventKnowledgeResponse;
            const normalized = data.knowledge ? normalizeKnowledge(data.knowledge as unknown as Record<string, unknown>) : null;
            setKnowledge(normalized);
            setCachedKnowledge(prev => ({ ...prev, [lang]: normalized }));
            if (data.language && !availableLanguages.includes(data.language)) {
                setAvailableLanguages(prev => [...prev, data.language]);
            }
        } catch (error) {
            console.error("Error fetching knowledge:", error);
            toast.error("Failed to load knowledge");
        } finally {
            setIsLoading(false);
        }
    }, [eventId, cachedKnowledge, availableLanguages]);

    useEffect(() => {
        fetchKnowledge(language);
    }, [language, fetchKnowledge]);

    // On mount, fetch meeting metadata to get available_languages
    useEffect(() => {
        if (!meetingId) return;
        apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/metadata`)
            .then((res) => {
                if (!res.ok) return null;
                return res.json();
            })
            .then((data: { available_languages?: string[]; default_language?: string } | null) => {
                if (data?.available_languages?.length) {
                    setAvailableLanguages(data.available_languages);
                }
            })
            .catch(() => { /* ignore metadata fetch errors */ });
    }, [meetingId]);

    const handleExtract = async () => {
        setIsExtracting(true);
        try {
            const res = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/knowledge`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ language }),
            });
            if (!res.ok) throw new Error("Failed to extract knowledge");
            const data = await res.json() as { knowledge: EventKnowledge };
            setKnowledge(normalizeKnowledge(data.knowledge as unknown as Record<string, unknown>));
            toast.success("Knowledge extracted successfully!");
        } catch (error) {
            console.error("Error extracting knowledge:", error);
            toast.error("Failed to extract knowledge. Please try again.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleRegenerate = async () => {
        setIsExtracting(true);
        try {
            const res = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/regenerate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ language }),
            });
            if (!res.ok) throw new Error("Failed to regenerate knowledge");
            const data = await res.json() as { knowledge: EventKnowledge };
            setKnowledge(normalizeKnowledge(data.knowledge as unknown as Record<string, unknown>));
            toast.success("Knowledge regenerated successfully!");
        } catch (error) {
            console.error("Error regenerating knowledge:", error);
            toast.error("Failed to regenerate knowledge. Please try again.");
        } finally {
            setIsExtracting(false);
        }
    };

    const loadOrGenerateLanguage = async (langCode: string) => {
        if (cachedKnowledge[langCode] !== undefined) {
            setLanguage(langCode);
            setKnowledge(cachedKnowledge[langCode]);
            return;
        }
        setIsExtracting(true);
        try {
            toast.info(`Generating knowledge in ${SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name}...`);
            const res = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/knowledge?language=${langCode}`);
            if (!res.ok) throw new Error("Failed to fetch knowledge");
            const data = await res.json() as GetEventKnowledgeResponse;
            if (data.knowledge) {
                const normalized = normalizeKnowledge(data.knowledge as unknown as Record<string, unknown>);
                setKnowledge(normalized);
                setCachedKnowledge(prev => ({ ...prev, [langCode]: normalized }));
                setLanguage(langCode);
                if (!availableLanguages.includes(langCode)) {
                    setAvailableLanguages(prev => [...prev, langCode]);
                }
                toast.success(`Knowledge loaded in ${SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name}!`);
            } else {
                await handleGenerateLanguage(langCode);
            }
        } catch (error) {
            console.error("Error loading language:", error);
            toast.error("Failed to load knowledge. Please try again.");
        } finally {
            setIsExtracting(false);
        }
    };

    const handleGenerateLanguage = async (langCode: string) => {
        setIsExtracting(true);
        try {
            toast.info(`Generating knowledge in ${SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.name}...`);
            const res = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/regenerate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ language: langCode }),
            });
            if (!res.ok) throw new Error("Failed to generate knowledge");
            const data = await res.json() as { knowledge: EventKnowledge; language: string };
            const normalized = normalizeKnowledge(data.knowledge as unknown as Record<string, unknown>);
            setKnowledge(normalized);
            setCachedKnowledge(prev => ({ ...prev, [data.language]: normalized }));
            setLanguage(data.language);
            if (!availableLanguages.includes(data.language)) {
                setAvailableLanguages(prev => [...prev, data.language]);
            }
            toast.success(`Knowledge generated in ${SUPPORTED_LANGUAGES.find(l => l.code === data.language)?.name}!`);
        } catch (error) {
            console.error("Error generating language:", error);
            toast.error("Failed to generate knowledge. Please try again.");
        } finally {
            setIsExtracting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading knowledge...</span>
            </div>
        );
    }

    if (!knowledge) {
        return (
            <div className="space-y-6">
                {/* Language Switcher */}
                <div className="flex justify-end">
                    <LanguageDropdown
                        currentLanguage={language}
                        availableLanguages={availableLanguages}
                        onSelect={(langCode) => {
                            setLanguage(langCode);
                            if (cachedKnowledge[langCode] === undefined) {
                                loadOrGenerateLanguage(langCode);
                            }
                        }}
                        disabled={isExtracting}
                    />
                </div>
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center p-12 text-center space-y-4">
                        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
                            <Sparkles className="size-8 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-lg font-medium">No Knowledge Extracted Yet</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto">
                                Extract knowledge from this event to see AI-generated insights, concepts, and more.
                            </p>
                        </div>
                        <Button onClick={handleExtract} disabled={isExtracting}>
                            {isExtracting ? (
                                <><Loader2 className="size-4 mr-2 animate-spin" />Extracting...</>
                            ) : (
                                "Extract Knowledge"
                            )}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Get section order for this event type
    const _primarySections = EVENT_TYPE_SECTIONS[knowledge.event_type] || DEFAULT_SECTIONS;

    // Group observations by subtype for explore section
    const observationsBySubtype = knowledge.observations?.reduce((acc, obs) => {
        const key = obs.subtype || "general";
        if (!acc[key]) acc[key] = [];
        acc[key].push(obs);
        return acc;
    }, {} as Record<string, KnowledgeItem[]>) || {};

    return (
        <div className="space-y-6">
            {/* Language Switcher & Actions */}
            <div className="flex justify-between items-center gap-4 flex-wrap">
                <LanguageDropdown
                    currentLanguage={language}
                    availableLanguages={availableLanguages}
                    onSelect={(langCode) => {
                        if (langCode === language) return;
                        loadOrGenerateLanguage(langCode);
                    }}
                    disabled={isExtracting}
                />
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={isExtracting}>
                        {isExtracting ? <Loader2 className="size-4 animate-spin" /> : "Regenerate"}
                    </Button>
                </div>
            </div>

            {/* Summary - always first */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="size-5 text-blue-500" />
                        {knowledge.title || "Event Summary"}
                    </CardTitle>
                    <div className="flex gap-2 flex-wrap">
                        {knowledge.event_type && (
                            <Badge variant="secondary">{knowledge.event_type}</Badge>
                        )}
                        {knowledge.sentiment?.overall && (
                            <Badge variant="outline">Mood: {knowledge.sentiment.overall}</Badge>
                        )}
                        {knowledge.sentiment?.important_emotions?.map((e) => (
                            <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                        <p className="whitespace-pre-wrap leading-relaxed">{knowledge.summary}</p>
                    </div>
                    {knowledge.related_topics?.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            <span className="text-sm text-muted-foreground">Related:</span>
                            {knowledge.related_topics.map((topic) => (
                                <Badge key={topic} variant="secondary" className="text-xs">{topic}</Badge>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>


            {/* Digest Grid: Highlights, Decisions, Action Items, Questions */}
            <DigestGrid knowledge={knowledge} />
            <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground list-none">
                    <Sparkles className="size-4" />
                    Explore Further
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
                </summary>

                <div className="mt-4 space-y-4">
                    {/* Understanding: Concepts, Insights */}
                    {(knowledge.concepts?.length > 0 || knowledge.insights?.length > 0) && (
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground mb-2">Understanding</h4>
                            <div className="grid gap-4 md:grid-cols-2">
                                {knowledge.concepts?.length > 0 && (
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm flex items-center gap-2">
                                                <BookOpen className="size-4 text-indigo-500" />
                                                Concepts
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-0">
                                            <ul className="space-y-1">
                                                {knowledge.concepts.slice(0, 5).map((c, i) => (
                                                    <li key={i} className="text-sm">{c.title}</li>
                                                ))}
                                            </ul>
                                        </CardContent>
                                    </Card>
                                )}
                                {knowledge.insights?.length > 0 && (
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm flex items-center gap-2">
                                                <Lightbulb className="size-4 text-yellow-500" />
                                                Insights
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-0">
                                            <ul className="space-y-1">
                                                {knowledge.insights.slice(0, 5).map((ins, i) => (
                                                    <li key={i} className="text-sm">{ins.content}</li>
                                                ))}
                                            </ul>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Context: Observations, Related Topics */}
                    {(knowledge.observations?.length > 0 || knowledge.related_topics?.length > 0) && (
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground mb-2">Context</h4>
                            <div className="grid gap-4 md:grid-cols-2">
                                {knowledge.observations?.length > 0 && (
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm flex items-center gap-2">
                                                <MessageSquare className="size-4 text-purple-500" />
                                                Observations
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-0">
                                            <ul className="space-y-1">
                                                {Object.entries(observationsBySubtype).slice(0, 3).map(([subtype, items]) => (
                                                    <li key={subtype} className="text-sm text-muted-foreground capitalize">{subtype}: {items.length}</li>
                                                ))}
                                            </ul>
                                        </CardContent>
                                    </Card>
                                )}
                                {knowledge.related_topics?.length > 0 && (
                                    <Card>
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm flex items-center gap-2">
                                                <Hash className="size-4 text-muted-foreground" />
                                                Related Topics
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="pt-0">
                                            <div className="flex flex-wrap gap-1">
                                                {knowledge.related_topics.map((topic) => (
                                                    <Badge key={topic} variant="secondary" className="text-xs">{topic}</Badge>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}

                    {/* References */}
                    {knowledge.references && knowledge.references.length > 0 && (
                        <div>
                            <h4 className="text-sm font-medium text-muted-foreground mb-2">References</h4>
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <LinkIcon className="size-4 text-cyan-500" />
                                        References
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-0">
                                    <ul className="space-y-2">
                                        {knowledge.references.slice(0, 5).map((ref, i) => (
                                            <li key={i} className="flex gap-3 text-sm">
                                                <div className="mt-1 size-1.5 rounded-full bg-cyan-500 shrink-0" />
                                                <span>{ref.content}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            </details>
        </div>
    );
}