"use client";

import { useEffect, useRef } from "react";
import { useUploadJobs } from "@/hooks/useUploadJobs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, X } from "lucide-react";
import Link from "next/link";

interface UploadJobsBannerProps {
    onJobCompleted?: (jobId: string) => void;
}

function normalizeUploadError(error: string | null, status: string) {
    const raw = error || status;
    const escapedMessage = raw.match(/\\?"message\\?"\s*:\s*\\?"([^"\\]+(?:\\.[^"\\]*)*)\\?"/);
    if (escapedMessage?.[1]) {
        return escapedMessage[1]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, " ")
            .replace(/\\\\/g, "\\");
    }

    const jsonStart = raw.indexOf("{");
    if (jsonStart === -1) return raw;

    try {
        const parsed = JSON.parse(raw.slice(jsonStart));
        const message = parsed?.error?.message;
        if (typeof message === "string" && message.trim()) {
            return raw.slice(0, jsonStart).trim()
                ? `${raw.slice(0, jsonStart).trim()} ${message}`
                : message;
        }
    } catch {
        return raw;
    }

    return raw;
}

export function UploadJobsBanner({ onJobCompleted }: UploadJobsBannerProps) {
    const { activeJobs, failedJobs, completedJobs, dismissJob } = useUploadJobs();
    const seenRef = useRef<Set<string>>(new Set());

    // Fire callback once per newly completed job
    useEffect(() => {
        if (!onJobCompleted) return;
        for (const job of completedJobs) {
            if (!seenRef.current.has(job.job_id)) {
                seenRef.current.add(job.job_id);
                onJobCompleted(job.job_id);
            }
        }
    }, [completedJobs, onJobCompleted]);

    if (activeJobs.length === 0 && failedJobs.length === 0) {
        return null;
    }

    return (
        <>
            {/* ACTIVE UPLOADS STRIP */}
            {activeJobs.length > 0 && (
                <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Loader2 className="size-4 animate-spin text-blue-500" />
                            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Active background tasks</span>
                        </div>
                        <div className="space-y-2">
                            {activeJobs.map((job) => (
                                <div key={job.job_id} className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">
                                            {job.job_type === "knowledge_extraction"
                                                ? `Extracting knowledge for ${job.title}`
                                                : job.title}
                                        </p>
                                        <p className="text-xs text-blue-600 dark:text-blue-400">{job.message}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className="w-24 h-2 rounded-full bg-blue-200 dark:bg-blue-800 overflow-hidden">
                                            <div
                                                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                                style={{ width: `${job.progress}%` }}
                                            />
                                        </div>
                                        <span className="text-xs text-blue-600 dark:text-blue-400 w-8">{job.progress}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* FAILED / CANCELLED JOBS */}
            {failedJobs.length > 0 && (
                <Card className="overflow-hidden border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
                    <CardContent className="min-w-0 overflow-hidden p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertCircle className="size-4 text-red-500" />
                            <span className="text-sm font-medium text-red-700 dark:text-red-300">Failed background tasks</span>
                        </div>
                        <div className="space-y-3">
                            {failedJobs.map((job) => (
                                <div key={job.job_id} className="min-w-0 max-w-full overflow-hidden">
                                    <div className="flex min-w-0 items-start gap-3">
                                        <div className="min-w-0 flex-1">
                                            {job.title && (
                                                <p className="min-w-0 truncate text-sm">
                                                    {job.job_type === "knowledge_extraction"
                                                        ? `Knowledge extraction for ${job.title}`
                                                        : job.title}
                                                </p>
                                            )}
                                            <p className="mt-1 max-w-full whitespace-normal text-xs leading-relaxed text-red-500 [overflow-wrap:anywhere]">
                                                {normalizeUploadError(job.error, job.status)}
                                            </p>
                                        </div>
                                        {job.meeting_id && (
                                            <Link
                                                href={`/events/detail?id=${encodeURIComponent(job.meeting_id)}`}
                                                className="shrink-0 text-xs text-primary hover:underline"
                                            >
                                                View
                                            </Link>
                                        )}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            className="-mt-1 shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                                            aria-label={`Dismiss failed upload ${job.title || job.job_id}`}
                                            onClick={() => void dismissJob(job.job_id)}
                                        >
                                            <X className="size-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </>
    );
}
