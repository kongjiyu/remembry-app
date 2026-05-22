"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { EventKnowledgeDisplay } from "@/components/ui/event-knowledge-display";

function ExtractContent() {
    const searchParams = useSearchParams();
    const id = searchParams.get("id") || "";

    if (!id) {
        return (
            <DashboardLayout
                breadcrumbs={[
                    { label: "Events", href: "/events" }
                ]}
                title="Knowledge Extraction"
            >
                <div className="max-w-5xl mx-auto flex items-center justify-center h-64">
                    <div className="text-destructive">Missing event id</div>
                </div>
            </DashboardLayout>
        );
    }

    const meetingId = decodeURIComponent(id);

    return (
        <DashboardLayout
            breadcrumbs={[
                { label: "Events", href: "/events" },
                { label: "Extract" }
            ]}
            title="Knowledge Extraction"
        >
            <div className="max-w-5xl mx-auto">
                <EventKnowledgeDisplay eventId={meetingId} initialLanguage="en" />
            </div>
        </DashboardLayout>
    );
}

export default function ExtractPage() {
    return (
        <Suspense fallback={<div className="max-w-5xl mx-auto flex items-center justify-center h-64"><div className="text-muted-foreground">Loading...</div></div>}>
            <ExtractContent />
        </Suspense>
    );
}