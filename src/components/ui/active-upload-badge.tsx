"use client";

import { useUploadJobs } from "@/hooks/useUploadJobs";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface ActiveUploadBadgeProps {
    /** Optional className for the badge container. */
    className?: string;
}

/**
 * Compact badge that shows the number of in-flight upload/knowledge
 * extraction jobs in the sidebar. Animates while jobs are running,
 * disappears entirely when nothing is in flight.
 *
 * Usage:
 *   <ActiveUploadBadge className="ml-auto" />
 *   (Place inside a sidebar menu item next to the label.)
 */
export function ActiveUploadBadge({ className }: ActiveUploadBadgeProps) {
    const { activeJobs } = useUploadJobs();
    const count = activeJobs.length;

    if (count === 0) return null;

    return (
        <span
            role="status"
            aria-label={`${count} background job${count === 1 ? "" : "s"} running`}
            className={cn(
                "inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold leading-none",
                "group-data-[collapsible=icon]:hidden",
                className,
            )}
        >
            <Loader2 className="size-3 animate-spin" />
            <span>{count}</span>
        </span>
    );
}