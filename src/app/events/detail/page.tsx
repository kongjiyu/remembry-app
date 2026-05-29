"use client";

import { Suspense, useEffect, useCallback, useReducer } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventKnowledgeDisplay } from "@/components/ui/event-knowledge-display";
import { UploadJobsBanner } from "@/components/ui/upload-jobs-banner";
import {
    Mic,
    Clock,
    FileText,
    CheckCircle2,
    MessageSquare,
    ArrowLeft,
    FolderKanban,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";

interface TranscriptionSegment {
    speaker: string;
    text: string;
    startTime?: number;
    endTime?: number;
}

interface RawTranscription {
    text?: string;
    segments?: TranscriptionSegment[];
    speakers?: string[];
    duration?: number;
    language?: string;
}

interface EventData {
    id: string;
    title: string;
    createdAt?: string;
    created_at?: string;
    project_id: string;
    event_type?: string;
    event_tags?: string[];
    transcription: RawTranscription;
    notes_by_language?: Record<string, unknown>;
    default_language: string;
    available_languages: string[];
}

interface NormalizedTranscription {
    text: string;
    segments: TranscriptionSegment[];
    speakers: string[];
    duration: number;
    language: string;
}

function normalizeTranscription(t: RawTranscription | null | undefined): NormalizedTranscription {
    if (!t) {
        return { text: "", segments: [], speakers: [], duration: 0, language: "en" };
    }
    return {
        text: t.text ?? "",
        segments: Array.isArray(t.segments) ? t.segments : [],
        speakers: Array.isArray(t.speakers) ? t.speakers : [],
        duration: typeof t.duration === "number" ? t.duration : 0,
        language: t.language ?? "en",
    };
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
        const hours = Math.floor(mins / 60);
        const remainingMins = mins % 60;
        return `${hours}h ${remainingMins}m`;
    }
    return `${mins}m ${secs}s`;
}

function formatTimestamp(seconds?: number): string {
    if (seconds === undefined) return "";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}


function EventDetailContent() {
    const searchParams = useSearchParams();
    type EventState = { event: EventData | null; loading: boolean };
    type EventAction = { type: "fetch"; event: EventData } | { type: "fetching" } | { type: "error" };

    const reducer = useCallback((state: EventState, action: EventAction): EventState => {
        switch (action.type) {
            case "fetching": return { ...state, loading: true };
            case "fetch": return { event: action.event, loading: false };
            case "error": return { ...state, loading: false };
        }
    }, []);

    const [state, dispatch] = useReducer(reducer, { event: null, loading: true });

    const event = state.event;
    const loading = state.loading;

    const id = searchParams.get("id") || "";
    const projectName = searchParams.get("projectName") || "";
    const displayName = searchParams.get("displayName") || "";

    const fetchEvent = useCallback(() => {
        if (!id) return;
        dispatch({ type: "fetching" });
        apiFetch(`/api/meetings/${encodeURIComponent(id)}`)
            .then((res) => {
                if (!res.ok) throw new Error("Failed to fetch event");
                return res.json();
            })
            .then((data) => {
                dispatch({ type: "fetch", event: data.meeting });
            })
            .catch(() => {
                dispatch({ type: "error" });
            });
    }, [id]);

    useEffect(() => {
        fetchEvent();
    }, [fetchEvent]);

    const handleJobCompleted = useCallback(() => {
        if (!id) return;
        apiFetch(`/api/meetings/${encodeURIComponent(id)}`)
            .then((res) => {
                if (!res.ok) throw new Error("Failed to refetch event");
                return res.json();
            })
            .then((data) => {
                dispatch({ type: "fetch", event: data.meeting });
            })
            .catch(() => { /* ignore */ });
    }, [id]);

    if (loading) {
        return (
            <DashboardLayout breadcrumbs={[{ label: "Events", href: "/events" }, { label: "..." }]} title="Loading...">
                <div className="flex items-center justify-center py-12">
                    <p className="text-muted-foreground">Loading event...</p>
                </div>
            </DashboardLayout>
        );
    }

    if (!event) {
        return (
            <DashboardLayout breadcrumbs={[{ label: "Events", href: "/events" }, { label: "Not Found" }]} title="Not Found">
                <div className="flex flex-col items-center justify-center py-12">
                    <p className="text-muted-foreground">Event not found</p>
                    <Button variant="outline" className="mt-4" asChild>
                        <Link href="/events">Back to Events</Link>
                    </Button>
                </div>
            </DashboardLayout>
        );
    }

    const transcription = normalizeTranscription(event.transcription);
    const createdDate = event.createdAt ?? event.created_at ?? "";

    const calculateDuration = () => {
        if (transcription.segments.length > 0) {
            const lastSegment = transcription.segments[transcription.segments.length - 1];
            if (lastSegment.endTime && lastSegment.endTime > 0) {
                return lastSegment.endTime;
            }
        }
        if (transcription.duration > 0) {
            return transcription.duration;
        }
        const estimatedWords = transcription.text.length / 5;
        const estimatedMinutes = estimatedWords / 150;
        return estimatedMinutes * 60;
    };

    const wordCount = transcription.text.trim().split(/\s+/).filter((w) => w.length > 0).length;
    const actualDuration = calculateDuration();

    return (
        <DashboardLayout
            breadcrumbs={[
                { label: "Events", href: "/events" },
                ...(projectName && displayName ? [{ label: displayName, href: `/projects/detail?id=${encodeURIComponent(projectName)}` }] : []),
                { label: event.title },
            ]}
            title={event.title}
        >
            <div className="space-y-6">
                <UploadJobsBanner onJobCompleted={handleJobCompleted} />

                <Button variant="outline" size="sm" asChild>
                    <Link href={projectName ? `/projects/detail?id=${encodeURIComponent(projectName)}` : "/events"}>
                        <ArrowLeft className="size-4 mr-2" />
                        {projectName ? "Back to Project" : "Back to Events"}
                    </Link>
                </Button>

                <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                            <Mic className="size-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold line-clamp-1">{event.title}</h1>
                            <div className="flex items-center gap-2 text-muted-foreground text-sm flex-wrap">
                                <span>
                                    {createdDate
                                        ? new Date(createdDate).toLocaleDateString("en-US", {
                                            weekday: "long",
                                            year: "numeric",
                                            month: "long",
                                            day: "numeric",
                                        })
                                        : "—"}{" "}
                                </span>
                                {displayName && (
                                    <>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            <FolderKanban className="size-3" />
                                            {displayName}
                                        </span>
                                    </>
                                )}
                                {event.event_type && (
                                    <>
                                        <span>•</span>
                                        <Badge variant="secondary" className="text-xs">{event.event_type}</Badge>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                    <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
                                <Clock className="size-5 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Duration</p>
                                <p className="text-lg font-semibold">{actualDuration > 0 ? formatDuration(actualDuration) : "—"}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-green-500/10">
                                <FileText className="size-5 text-green-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Words</p>
                                <p className="text-lg font-semibold">{wordCount.toLocaleString()}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-3 p-4">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-purple-500/10">
                                <MessageSquare className="size-5 text-purple-500" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Segments</p>
                                <p className="text-lg font-semibold">{transcription.segments.length > 0 ? transcription.segments.length : "1"}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Tabs defaultValue="knowledge" className="space-y-6">
                    <TabsList>
                        <TabsTrigger value="knowledge" className="gap-2">
                            <FileText className="size-4" />
                            Event Notes
                        </TabsTrigger>
                        <TabsTrigger value="transcript" className="gap-2">
                            <CheckCircle2 className="size-4" />
                            Transcript
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="knowledge" className="space-y-6">
                        <EventKnowledgeDisplay
                            eventId={event.id}
                            meetingId={event.id}
                            initialLanguage={transcription.language}
                        />
                    </TabsContent>

                    <TabsContent value="transcript" className="space-y-6">
                        {transcription.speakers.length > 0 && (
                            <Card>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-lg">Speakers Identified</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-2">
                                        {transcription.speakers.map((speaker, idx) => (
                                            <Badge key={idx} variant="secondary" className="text-sm py-1 px-3">
                                                {speaker}
                                            </Badge>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {transcription.segments.length > 0 ? (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <CheckCircle2 className="size-5 text-green-500" />
                                        Transcript
                                    </CardTitle>
                                    <CardDescription>Full transcription with speaker identification</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-4">
                                        {transcription.segments.map((segment, idx) => (
                                            <div key={idx} className="flex gap-4 group">
                                                {segment.startTime !== undefined && (
                                                    <span className="text-xs text-muted-foreground font-mono w-12 shrink-0 pt-1">
                                                        {formatTimestamp(segment.startTime)}
                                                    </span>
                                                )}
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-medium text-sm text-primary">{segment.speaker}</span>
                                                    </div>
                                                    <p className="text-sm text-foreground leading-relaxed">{segment.text}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <CheckCircle2 className="size-5 text-green-500" />
                                        Transcript
                                    </CardTitle>
                                    <CardDescription>Full transcription</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-foreground whitespace-pre-wrap">{transcription.text}</p>
                                </CardContent>
                            </Card>
                        )}

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Full Text</CardTitle>
                                <CardDescription>Plain text version without speaker labels</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{transcription.text}</p>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}

export default function EventDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-12"><p className="text-muted-foreground">Loading...</p></div>}>
            <EventDetailContent />
        </Suspense>
    );
}