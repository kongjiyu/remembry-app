"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function RedirectContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const mode = searchParams.get("mode");
        const redirectUrl = mode ? `/events/new?mode=${encodeURIComponent(mode)}` : "/events/new";
        router.replace(redirectUrl);
    }, [searchParams, router]);

    return (
        <div className="flex items-center justify-center h-screen">
            <p className="text-muted-foreground">Redirecting...</p>
        </div>
    );
}

export default function NewMeetingPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><p className="text-muted-foreground">Loading...</p></div>}>
            <RedirectContent />
        </Suspense>
    );
}