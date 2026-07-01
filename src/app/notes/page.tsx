"use client";

import * as React from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, FileText, Search, Upload, FolderKanban, NotebookPen } from "lucide-react";
import { AppLink } from "@/components/ui/app-link";
import { apiFetch } from "@/lib/apiFetch";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";

interface Project { id: string; display_name: string; }
interface DocumentRow {
    id: string; project_id: string; display_name: string;
    content: string; created_at: string; mime_type?: string;
}

export default function NotesPage() {
    const [notes, setNotes] = React.useState<DocumentRow[]>([]);
    const [projects, setProjects] = React.useState<Project[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [search, setSearch] = React.useState("");
    const [showNew, setShowNew] = React.useState(false);

    // Match the Events page date format ("Jun 23, 2026 · 01:01 AM") so the
    // Notes grid feels consistent with the rest of the app and avoids the
    // locale-dependent "23/06/2026, 01.01.12" output that `toLocaleString()`
    // produces on non-en-US systems.
    const formatDate = (dateString?: string) => {
        if (!dateString) return "Unknown";
        return new Date(dateString).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    };
    const formatTime = (dateString?: string) => {
        if (!dateString) return "";
        return new Date(dateString).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const fetchAll = React.useCallback(async () => {
        try {
            setLoading(true);
            const [n, p] = await Promise.all([apiFetch("/api/documents"), apiFetch("/api/projects")]);
            if (n.ok) setNotes(((await n.json()) as DocumentRow[]));
            if (p.ok) setProjects(((await p.json()) as { projects: Project[] }).projects || []);
        } catch (err) {
            console.error("Failed to load notes:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { fetchAll(); }, [fetchAll]);

    const projectMap = React.useMemo(() => Object.fromEntries(projects.map(p => [p.id, p.display_name])), [projects]);

    // Notes page shows only user-created / imported notes.
    // Meeting transcripts are also stored in `project_documents` by the
    // upload pipeline (uploads.rs writes them with id `meeting-transcript/<uuid>`),
    // so filter them out here — they belong on the meeting detail page.
    const filtered = notes
        .filter(n => !n.id.startsWith("meeting-transcript/"))
        .filter(n =>
            n.display_name.toLowerCase().includes(search.toLowerCase()) ||
            n.content.toLowerCase().includes(search.toLowerCase())
        );

    return (
        <DashboardLayout title="Notes" breadcrumbs={[{ label: "Notes" }]}>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes..." className="pl-10" />
                    </div>
                    <Button onClick={() => setShowNew(true)} className="gap-2">
                        <Plus className="size-4" />
                        New Note
                    </Button>
                </div>

                {loading ? (
                    <div className="text-sm text-muted-foreground">Loading...</div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={NotebookPen}
                        title={notes.length === 0 ? "No notes yet" : "No matches"}
                        description={notes.length === 0 ? "Create your first note to capture project context." : "Try a different search or filter."}
                        action={notes.length === 0 ? { label: "Create note", onClick: () => setShowNew(true) } : undefined}
                    />
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filtered.map(n => (
                            <AppLink key={n.id} href={`/notes/detail?id=${n.id}`} className="block">
                                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                                    <CardContent className="p-4 flex flex-col h-full gap-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="font-semibold truncate">{n.display_name}</p>
                                            <FileText className="size-4 text-muted-foreground shrink-0" />
                                        </div>
                                        <div className="mt-auto flex items-center justify-between">
                                            <Badge variant="secondary" className="gap-1">
                                                <FolderKanban className="size-3" />
                                                {projectMap[n.project_id] || "Unknown"}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDate(n.created_at)} · {formatTime(n.created_at)}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>
                            </AppLink>
                        ))}
                    </div>
                )}
            </div>

            <NewNoteDialog
                open={showNew}
                onOpenChange={setShowNew}
                projects={projects}
                onCreated={() => { setShowNew(false); fetchAll(); toast.success("Note created"); }}
            />
        </DashboardLayout>
    );
}

function NewNoteDialog({ open, onOpenChange, projects, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; projects: Project[]; onCreated: () => void; }) {
    const [title, setTitle] = React.useState("");
    const [content, setContent] = React.useState("");
    const [projectId, setProjectId] = React.useState<string>("");
    const [importing, setImporting] = React.useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Reset form when dialog opens — wrapped to avoid setState in effect.
    const handleOpenChange = React.useCallback((next: boolean) => {
        if (next) {
            setTitle("");
            setContent("");
            setProjectId("");
        }
        onOpenChange(next);
    }, [onOpenChange]);

    const handleCreate = async () => {
        if (!title.trim() || !projectId) { toast.error("Title and project are required"); return; }
        try {
            const res = await apiFetch("/api/documents", {
                method: "POST",
                body: JSON.stringify({ projectId, displayName: title, content, mimeType: "text/markdown" }),
            });
            if (res.ok) onCreated();
            else toast.error("Failed to create note");
        } catch (err) {
            console.error("Failed to create note", err);
            toast.error("Failed to create note");
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!projectId) { toast.error("Pick a project first"); return; }
        setImporting(true);
        try {
            const text = await file.text();
            if (text.includes("\0")) { toast.error("File appears to be binary"); return; }
            const res = await apiFetch("/api/documents", {
                method: "POST",
                body: JSON.stringify({
                    projectId,
                    displayName: file.name,
                    content: text,
                    mimeType: file.name.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain",
                }),
            });
            if (res.ok) { toast.success(`Imported ${file.name}`); onCreated(); }
            else toast.error("Import failed");
        } catch (err) {
            console.error(err);
            toast.error("Import failed");
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>New Note</DialogTitle></DialogHeader>
                <div className="space-y-3">
                    <Input placeholder="Note title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">Select project...</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                    </select>
                    <textarea
                        placeholder="Write your note in Markdown..."
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        className="w-full min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                    />
                    <div>
                        <input ref={fileInputRef} type="file" accept=".txt,.md" onChange={handleImport} className="hidden" />
                        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                            <Upload className="size-4 mr-1" />{importing ? "Importing..." : "Import .txt/.md file"}
                        </Button>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleCreate}>Create</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
