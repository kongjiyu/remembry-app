"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function RedirectContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    useEffect(() => {
        const id = searchParams.get("id");
        const redirectUrl = id ? `/events/extract?id=${encodeURIComponent(id)}` : "/events/extract";
        router.replace(redirectUrl);
    }, [searchParams, router]);

    return (
        <div className="flex items-center justify-center h-screen">
            <p className="text-muted-foreground">Redirecting...</p>
        </div>
    );
}

export default function ExtractPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-screen"><p className="text-muted-foreground">Loading...</p></div>}>
            <RedirectContent />
        </Suspense>
    );
}