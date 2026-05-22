"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MeetingsPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/events");
    }, [router]);

    return (
        <div className="flex items-center justify-center h-screen">
            <p className="text-muted-foreground">Redirecting...</p>
        </div>
    );
}