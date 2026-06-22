"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Save, FolderKanban, ArrowLeft, Loader2 } from "lucide-react";
import { AppLink } from "@/components/ui/app-link";
import { apiFetch } from "@/lib/apiFetch";
import { toast } from "sonner";

interface DocumentRow {
    id: string; project_id: string; display_name: string;
    content: string; created_at: string; mime_type?: string;
}

function NoteDetailContent() {
    const sp = useSearchParams();
    const router = useRouter();
    const id = sp.get("id") || "";
    const [doc, setDoc] = useState<DocumentRow | null>(null);
    const [projectName, setProjectName] = useState<string>("");
    const [content, setContent] = useState("");
    const [title, setTitle] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        if (!id) return;
        (async () => {
            try {
                const res = await apiFetch(`/api/documents/${encodeURIComponent(id)}`);
                if (!res.ok) throw new Error("Not found");
                const data: DocumentRow = await res.json();
                setDoc(data);
                setContent(data.content);
                setTitle(data.display_name);
                setDirty(false);
                const pRes = await apiFetch(`/api/projects/${encodeURIComponent(data.project_id)}`);
                if (pRes.ok) {
                    const p = await pRes.json();
                    setProjectName(p.display_name || p.name || "");
                }
            } catch (err) {
                console.error("Could not load note", err);
                toast.error("Could not load note");
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await apiFetch(`/api/documents/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: JSON.stringify({ displayName: title, content }),
            });
            if (res.ok) {
                toast.success("Saved");
                setDirty(false);
            } else {
                toast.error("Save failed");
            }
        } catch (err) {
            console.error("Save failed", err);
            toast.error("Save failed");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Delete this note?")) return;
        setDeleting(true);
        try {
            const res = await apiFetch(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Deleted");
                router.push("/notes");
            } else {
                toast.error("Delete failed");
            }
        } catch (err) {
            console.error("Delete failed", err);
            toast.error("Delete failed");
        } finally {
            setDeleting(false);
        }
    };

    if (loading) {
        return (
            <DashboardLayout breadcrumbs={[{ label: "Notes", href: "/notes" }, { label: "..." }]} title="Loading...">
                <div className="flex items-center justify-center py-12">
                    <p className="text-muted-foreground">Loading note...</p>
                </div>
            </DashboardLayout>
        );
    }

    if (!doc) {
        return (
            <DashboardLayout breadcrumbs={[{ label: "Notes", href: "/notes" }, { label: "Not Found" }]} title="Not Found">
                <div className="flex flex-col items-center justify-center py-12">
                    <p className="text-muted-foreground">Note not found</p>
                    <Button variant="outline" className="mt-4" asChild>
                        <AppLink href="/notes">Back to Notes</AppLink>
                    </Button>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout
            breadcrumbs={[{ label: "Notes", href: "/notes" }, { label: title }]}
            title={title}
        >
            <div className="space-y-4">
                <Button variant="outline" size="sm" asChild>
                    <AppLink href="/notes">
                        <ArrowLeft className="size-4 mr-2" />
                        Back to Notes
                    </AppLink>
                </Button>

                <Card>
                    <CardContent className="p-6 space-y-4">
                        <div className="flex items-center justify-between gap-4">
                            <input
                                value={title}
                                onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                                className="flex-1 bg-transparent text-2xl font-semibold focus:outline-none border-b border-transparent focus:border-border"
                                placeholder="Note title"
                            />
                            <Badge variant="secondary" className="gap-1 shrink-0">
                                <FolderKanban className="size-3" />
                                {projectName || "Unknown"}
                            </Badge>
                        </div>
                        <textarea
                            value={content}
                            onChange={(e) => { setContent(e.target.value); setDirty(true); }}
                            placeholder="Write in Markdown..."
                            className="w-full min-h-[500px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                                {dirty ? "Unsaved changes" : "All changes saved"}
                            </span>
                            <div className="flex gap-2">
                                <Button variant="destructive" onClick={handleDelete} disabled={deleting || saving}>
                                    {deleting ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Trash2 className="size-4 mr-1" />}
                                    Delete
                                </Button>
                                <Button onClick={handleSave} disabled={!dirty || saving}>
                                    {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
                                    Save
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}

export default function NoteDetailPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-12"><p className="text-muted-foreground">Loading...</p></div>}>
            <NoteDetailContent />
        </Suspense>
    );
}
