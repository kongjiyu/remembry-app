"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function RedirectContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const id = searchParams.get("id");
        const projectName = searchParams.get("projectName");
        const displayName = searchParams.get("displayName");

        const params = new URLSearchParams();
        if (id) params.set("id", id);
        if (projectName) params.set("projectName", projectName);
        if (displayName) params.set("displayName", displayName);

        const redirectUrl = `/events/detail${params.toString() ? `?${params.toString()}` : ''}`;
        router.replace(redirectUrl);
    }, [searchParams, router]);

    return (
        <div className="flex items-center justify-center h-screen">
            <p className="text-muted-foreground">Redirecting...</p>
        </div>
    );
}

export default function MeetingDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><p className="text-muted-foreground">Loading...</p></div>}>
            <RedirectContent />
        </Suspense>
    );
}