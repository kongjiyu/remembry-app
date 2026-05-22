"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Send, Loader2, MessageCircle, ExternalLink, Calendar } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";

interface AskSource {
    id: string;
    meetingId: string;
    title: string;
    createdAt: string;
    snippet: string;
}

interface AskResponse {
    success: boolean;
    answer: string;
    sources: AskSource[];
    followUpQuestions?: string[];
}

function formatDate(dateString?: string) {
    if (!dateString) return "";
    return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function AskContent() {
    const searchParams = useSearchParams();

    const scope = searchParams.get("scope") || "project";
    const projectName = searchParams.get("projectName") || "";
    const displayName = searchParams.get("displayName") || "";
    const eventName = searchParams.get("name") || "";
    const eventId = searchParams.get("id") || "";

    const [question, setQuestion] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [response, setResponse] = useState<AskResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const pageTitle = scope === "meeting" && eventName
        ? `Ask: ${eventName}`
        : `Ask: ${displayName}`;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!question.trim() || isLoading) return;

        setIsLoading(true);
        setError(null);
        setResponse(null);

        try {
            const res = await apiFetch("/api/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    scope,
                    projectId: projectName,
                    meetingId: scope === "meeting" ? eventId : null,
                    question: question.trim(),
                    language: "en",
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to get answer");
            }

            const data = await res.json();
            setResponse(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to get answer");
        } finally {
            setIsLoading(false);
        }
    };

    const handleFollowUp = (followQuestion: string) => {
        setQuestion(followQuestion);
        // Scroll to input
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <DashboardLayout
            breadcrumbs={[
                { label: "Projects", href: "/projects" },
                ...(scope === "meeting" && projectName ? [{ label: displayName, href: `/projects/detail?id=${encodeURIComponent(projectName)}` }] : []),
                ...(scope === "meeting" && eventName ? [{ label: eventName, href: `/events/detail?id=${encodeURIComponent(eventId)}&projectName=${encodeURIComponent(projectName)}&displayName=${encodeURIComponent(displayName)}` }] : []),
                { label: pageTitle },
            ]}
            title={pageTitle}
        >
            <div className="space-y-6 max-w-3xl">
                {/* Back button */}
                <Button variant="outline" size="sm" asChild>
                    <Link href={scope === "meeting" && projectName
                        ? `/events/detail?id=${encodeURIComponent(eventId)}&projectName=${encodeURIComponent(projectName)}&displayName=${encodeURIComponent(displayName)}`
                        : `/projects/detail?id=${encodeURIComponent(projectName)}`
                    }>
                        <ArrowLeft className="size-4 mr-2" />
                        Back
                    </Link>
                </Button>

                {/* Question form */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <MessageCircle className="size-5" />
                            Ask a Question
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Textarea
                                placeholder={
                                    scope === "meeting"
                                        ? `Ask a question about "${eventName}"...`
                                        : `Ask a question about "${displayName}" events...`
                                }
                                value={question}
                                onChange={(e) => setQuestion(e.target.value)}
                                rows={4}
                                className="resize-none"
                            />
                            <Button
                                type="submit"
                                disabled={!question.trim() || isLoading}
                                className="gap-2"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="size-4 animate-spin" />
                                        Searching...
                                    </>
                                ) : (
                                    <>
                                        <Send className="size-4" />
                                        Ask Question
                                    </>
                                )}
                            </Button>
                        </form>

                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                    </CardContent>
                </Card>

                {/* Answer */}
                {response && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Answer</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{response.answer}</p>

                            {/* Sources */}
                            {response.sources && response.sources.length > 0 && (
                                <div className="space-y-3 pt-4 border-t">
                                    <h4 className="text-sm font-medium text-muted-foreground">
                                        Sources ({response.sources.length})
                                    </h4>
                                    <div className="space-y-2">
                                        {response.sources.map((source) => {
                                            const sourceUrl = `/events/detail?id=${encodeURIComponent(source.meetingId)}&projectName=${encodeURIComponent(projectName)}&displayName=${encodeURIComponent(displayName)}`;
                                            return (
                                                <Link
                                                    key={source.id}
                                                    href={sourceUrl}
                                                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                                                >
                                                    <ExternalLink className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-sm font-medium">{source.title}</span>
                                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                                <Calendar className="size-3" />
                                                                {formatDate(source.createdAt)}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                            {source.snippet}
                                                        </p>
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Follow-up questions */}
                            {response.followUpQuestions && response.followUpQuestions.length > 0 && (
                                <div className="space-y-2 pt-4 border-t">
                                    <h4 className="text-sm font-medium text-muted-foreground">
                                        Follow-up Questions
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {response.followUpQuestions.map((q, i) => (
                                            <button
                                                key={i}
                                                onClick={() => handleFollowUp(q)}
                                                className="text-left text-sm px-3 py-2 rounded-lg border hover:bg-muted/50 transition-colors"
                                            >
                                                {q}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Empty state */}
                {!response && !error && !isLoading && (
                    <Card className="py-8">
                        <CardContent className="text-center text-muted-foreground">
                            <MessageCircle className="size-10 mx-auto mb-3 opacity-50" />
                            <p className="text-sm">
                                Ask a question to search through event transcripts and knowledge.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </DashboardLayout>
    );
}

export default function AskPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>}>
            <AskContent />
        </Suspense>
    );
}