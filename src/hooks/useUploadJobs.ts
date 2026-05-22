"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isRunningInTauri } from "@/lib/tauriApi";

export interface UploadJob {
    job_id: string;
    status: string;
    progress: number;
    message: string;
    error: string | null;
    meeting_id: string | null;
    project_id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export function useUploadJobs(pollIntervalMs = 3000) {
    const [jobs, setJobs] = useState<UploadJob[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchJobs = useCallback(async () => {
        if (!isRunningInTauri()) return;
        try {
            const result = await invoke<UploadJob[]>("list_upload_jobs");
            setJobs(result);
        } catch {
            // Non-Tauri environment or command not available — ignore
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isRunningInTauri()) {
            setLoading(false);
            return;
        }

        fetchJobs();

        let unlisten: (() => void) | null = null;
        listen<UploadJob>("meeting-upload-progress", (event) => {
            setJobs((prev) => {
                const idx = prev.findIndex((j) => j.job_id === event.payload.job_id);
                if (idx >= 0) {
                    const updated = [...prev];
                    updated[idx] = event.payload;
                    return updated;
                }
                return [event.payload, ...prev];
            });
        }).then((fn) => { unlisten = fn; });

        const interval = setInterval(fetchJobs, pollIntervalMs);

        return () => {
            unlisten?.();
            clearInterval(interval);
        };
    }, [fetchJobs, pollIntervalMs]);

    const activeJobs = jobs.filter((j) =>
        ["queued", "uploading", "processing", "transcribing", "saving", "cleanup_pending"].includes(j.status)
    );
    const completedJobs = jobs.filter((j) => j.status === "completed");
    const failedJobs = jobs.filter((j) => j.status === "failed" || j.status === "cancelled");

    const getJob = useCallback(
        (jobId: string): UploadJob | undefined => jobs.find((j) => j.job_id === jobId),
        [jobs]
    );

    const dismissJob = useCallback(async (jobId: string): Promise<boolean> => {
        if (!isRunningInTauri()) return false;
        const dismissed = await invoke<boolean>("dismiss_upload_job", { jobId });
        if (dismissed) {
            setJobs((prev) => prev.filter((job) => job.job_id !== jobId));
        }
        return dismissed;
    }, []);

    return {
        jobs,
        activeJobs,
        completedJobs,
        failedJobs,
        loading,
        getJob,
        dismissJob,
        refetch: fetchJobs,
    };
}

export async function getUploadJob(jobId: string): Promise<UploadJob | null> {
    if (!isRunningInTauri()) return null;
    try {
        return await invoke<UploadJob | null>("get_upload_job", { jobId });
    } catch {
        return null;
    }
}
