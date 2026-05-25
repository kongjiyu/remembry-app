"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AudioRecorder } from "@/components/ui/audio-recorder";
import { Upload, Mic, FileAudio, FileText, X, Loader2, FolderKanban, Plus, Download, Tag, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeMeeting, countMeetingsByProject } from "@/lib/meetingViews";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/apiFetch";
import { invoke } from "@tauri-apps/api/core";
import Link from "next/link";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface Project {
    id: string;
    display_name: string;
    name?: string;
    displayName?: string;
    color: string;
    description: string;
    goals: string;
    created_at: string;
    meeting_count: number;
}

function normalizeProjectWithCount(
    raw: Record<string, unknown>,
    computedCounts: Map<string, number>
): Project {
    const id = String(raw.id || raw.name || '');
    const displayName = String(raw.display_name || raw.displayName || raw.name || '');
    return {
        id,
        display_name: displayName,
        name: String(raw.name || ''),
        displayName: String(raw.displayName || ''),
        color: String(raw.color || '#000000'),
        description: String(raw.description || ''),
        goals: String(raw.goals || ''),
        created_at: String(raw.created_at || raw.uploadTime || new Date().toISOString()),
        meeting_count: computedCounts.get(id) || (raw.meeting_count as number) || (raw.meetingCount as number) || 0,
    };
}

type InputMode = "upload" | "record";
type FileType = "audio" | "text";

interface UploadedFile {
    file: File | Blob;
    name: string;
    size: number;
    duration?: number;
    url?: string;
    fileType: FileType;
    mimeType?: string;
}

const EVENT_TYPE_PRESETS = [
    "meeting",
    "brainstorm",
    "lecture",
    "interview",
    "research",
    "design_review",
    "standup",
    "planning",
    "retrospective",
    "workshop",
    "demo_presentation",
    "personal_reflection",
    "podcast_video",
    "client_discussion",
    "playtest",
    "qa_session",
] as const;

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.substring(result.indexOf(',') + 1));
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || isNaN(seconds)) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function ModeParamHandler({ onModeChange, onQuickRecordEntry }: { onModeChange: (mode: InputMode) => void; onQuickRecordEntry: () => void }) {
    const searchParams = useSearchParams();

    useEffect(() => {
        const mode = searchParams.get("mode");
        if (mode === "record") {
            onModeChange("record");
            onQuickRecordEntry();
        }
    }, [searchParams, onModeChange, onQuickRecordEntry]);

    return null;
}

export default function NewEventPage() {
    const router = useRouter();
    const [inputMode, setInputMode] = useState<InputMode>("upload");
    const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<string>("");

    // Form state
    const [title, setTitle] = useState("");
    const [notes, setNotes] = useState("");
    const [selectedEventType, setSelectedEventType] = useState<string>("meeting");
    const [tagInput, setTagInput] = useState("");
    const [eventTags, setEventTags] = useState<string[]>([]);

    // Project selection
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [isQuickRecordEntry, setIsQuickRecordEntry] = useState(false);
    const [showDiscardDialog, setShowDiscardDialog] = useState(false);
    const [pendingMode, setPendingMode] = useState<InputMode | null>(null);
    const [hasUnsavedRecording, setHasUnsavedRecording] = useState(false);

    // Create project dialog
    const [showCreateProjectDialog, setShowCreateProjectDialog] = useState(false);
    const [newProjectName, setNewProjectName] = useState("");
    const [newProjectDescription, setNewProjectDescription] = useState("");
    const [newProjectGoals, setNewProjectGoals] = useState("");
    const [isCreatingProject, setIsCreatingProject] = useState(false);

    const handleModeChange = useCallback((mode: InputMode) => {
        setInputMode(mode);
    }, []);
    const handleQuickRecordEntry = useCallback(() => {
        setIsQuickRecordEntry(true);
    }, []);

    const requestModeChange = useCallback((newMode: InputMode) => {
        if (newMode === "upload" && inputMode === "record" && hasUnsavedRecording) {
            setPendingMode("upload");
            setShowDiscardDialog(true);
            return;
        }
        if (newMode === "record") {
            setIsQuickRecordEntry(false);
        }
        setInputMode(newMode);
    }, [inputMode, hasUnsavedRecording]);

    useEffect(() => {
        const fetchData = async () => {
            setLoadingProjects(true);
            try {
                const [projectsRes, meetingsRes] = await Promise.all([
                    apiFetch('/api/projects'),
                    apiFetch('/api/meetings'),
                ]);

                const projectsJson = projectsRes.ok ? await projectsRes.json() : {};
                const meetingsJson = meetingsRes.ok ? await meetingsRes.json() : {};
                const projectsData = projectsJson.projects || [];
                const rawMeetings: Record<string, unknown>[] = meetingsJson.meetings || [];

                const projectMap = new Map<string, string>();
                for (const p of projectsData) {
                    const pid = String(p.id || p.name || '');
                    projectMap.set(pid, String(p.display_name || p.displayName || p.name || pid));
                }

                const normalizedMeetings = rawMeetings.map((m: Record<string, unknown>) => normalizeMeeting(m, projectMap));
                const computedCounts = countMeetingsByProject(normalizedMeetings);

                const normalized = projectsData.map((p: Record<string, unknown>) => normalizeProjectWithCount(p, computedCounts));
                setProjects(normalized);
                if (normalized.length > 0) {
                    setSelectedProject(normalized[0]);
                }
            } catch (error) {
                console.error('Error fetching data:', error);
            } finally {
                setLoadingProjects(false);
            }
        };

        fetchData();
    }, []);

    const acceptedAudioFormats = ["audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/m4a", "audio/x-m4a", "audio/webm", "audio/ogg", "video/webm", "audio/mp4", "video/mp4"];

    const handleFileSelect = async (file: File) => {
        if (file.type === "text/plain" || file.name.match(/\.txt$/i)) {
            setUploadedFile({
                file,
                name: file.name,
                size: file.size,
                fileType: "text",
                mimeType: file.type || undefined,
            });
            return;
        }

        if (!acceptedAudioFormats.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a|webm|ogg|mp4)$/i)) {
            toast.error("Please upload an audio file (MP3, WAV, M4A, WebM, MP4) or text transcript (TXT)");
            return;
        }

        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        audio.addEventListener("loadedmetadata", () => {
            const duration = Number.isFinite(audio.duration) ? Math.floor(audio.duration) : undefined;
            setUploadedFile({
                file,
                name: file.name,
                size: file.size,
                duration: duration,
                url,
                fileType: "audio",
                mimeType: file.type || undefined,
            });
        });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleRecordingComplete = (blob: Blob, duration: number) => {
        const url = URL.createObjectURL(blob);
        const now = new Date();
        const fileName = `Recording_${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 19).replace(/:/g, "-")}.webm`;

        setUploadedFile({
            file: blob,
            name: fileName,
            size: blob.size,
            duration,
            url,
            fileType: "audio",
            mimeType: blob.type || "audio/webm",
        });
    };

    const handleRemoveFile = () => {
        if (uploadedFile?.url) {
            URL.revokeObjectURL(uploadedFile.url);
        }
        setUploadedFile(null);
    };

    const handleAddTag = () => {
        const trimmed = tagInput.trim();
        if (trimmed && !eventTags.includes(trimmed)) {
            setEventTags(prev => [...prev, trimmed]);
        }
        setTagInput("");
    };

    const handleTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            handleAddTag();
        }
    };

    const handleRemoveTag = (tag: string) => {
        setEventTags(prev => prev.filter(t => t !== tag));
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        setIsCreatingProject(true);
        try {
            const response = await apiFetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newProjectName.trim(),
                    description: newProjectDescription.trim(),
                    goals: newProjectGoals.trim(),
                }),
            });
            if (!response.ok) throw new Error('Failed to create project');
            const data = await response.json();

            const newProject: Project = {
                id: data.project?.id || data.id || data.name || '',
                display_name: data.project?.display_name || data.display_name || data.displayName || newProjectName.trim(),
                name: data.project?.name || data.name || '',
                displayName: data.project?.displayName || data.displayName || '',
                color: data.project?.color || data.color || '#000000',
                description: data.project?.description || data.description || '',
                goals: data.project?.goals || data.goals || '',
                created_at: data.project?.created_at || data.created_at || new Date().toISOString(),
                meeting_count: 0,
            };

            setProjects(prev => [...prev, newProject]);
            setSelectedProject(newProject);
            setShowCreateProjectDialog(false);
            setNewProjectName("");
            setNewProjectDescription("");
            setNewProjectGoals("");
            toast.success("Project created");
        } catch (error) {
            console.error('Error creating project:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to create project');
        } finally {
            setIsCreatingProject(false);
        }
    };

    const handleSubmit = useCallback(async () => {
        if (!uploadedFile || !selectedProject) {
            toast.error('Please select a project');
            return;
        }

        setIsProcessing(true);
        setProcessingStatus("Preparing file...");

        let uploadId: string | null = null;
        let enqueued = false;

        try {
            const keyStatus = await invoke<{ hasKey: boolean }>('get_gemini_key_status');
            if (!keyStatus.hasKey) {
                toast.error('Gemini API key not configured. Please add your API key in Settings.');
                return;
            }

            const file = uploadedFile.file;
            const CHUNK_SIZE = 5 * 1024 * 1024;
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const fileName = title || uploadedFile.name;

            setProcessingStatus("Starting upload...");

            const startResult = await invoke<{ success: boolean; upload_id: string }>('start_upload', {
                fileName,
                totalChunks,
            });

            if (!startResult.success) {
                throw new Error('Failed to start upload');
            }

            uploadId = startResult.upload_id;

            setProcessingStatus(`Uploading 1/${totalChunks}...`);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunkBlob = file.slice(start, end);

                const base64Chunk = await blobToBase64(chunkBlob);

                const chunkResult = await invoke<{ success: boolean }>('append_upload_chunk', {
                    uploadId,
                    chunkIndex: i,
                    chunkData: base64Chunk,
                });

                if (!chunkResult.success) {
                    throw new Error('Failed to upload chunk');
                }

                setProcessingStatus(`Uploading ${i + 1}/${totalChunks}...`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            setProcessingStatus("Queuing...");

            await invoke<{ job_id: string }>('enqueue_meeting_upload_processing', {
                uploadId,
                params: {
                    project_id: selectedProject.id,
                    title: fileName,
                    context: notes || null,
                    file_type: uploadedFile.fileType,
                    notes_languages: ["en"],
                    mime_type: uploadedFile.mimeType || null,
                    event_type: selectedEventType,
                    event_tags: eventTags,
                },
            });
            enqueued = true;

            toast.success("Upload queued. Processing in background.");
            router.push('/events');
        } catch (error) {
            console.error('Error uploading event:', error);

            if (uploadId && !enqueued) {
                try {
                    await invoke('cancel_upload', { uploadId });
                } catch {
                    // Swallow cleanup errors
                }
            }

            toast.error(error instanceof Error ? error.message : 'Failed to upload event');
        } finally {
            setIsProcessing(false);
        }
    }, [uploadedFile, selectedProject, title, notes, selectedEventType, eventTags, router]);

    const shouldAutoStart = inputMode === "record" && isQuickRecordEntry;

    return (
        <DashboardLayout
            breadcrumbs={[
                { label: "Events", href: "/events" },
                { label: "New Event" }
            ]}
            title="New Event"
        >
            <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
                <ModeParamHandler onModeChange={handleModeChange} onQuickRecordEntry={handleQuickRecordEntry} />
            </Suspense>
            <div className="max-w-3xl mx-auto space-y-6">
                {/* Mode Toggle */}
                <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                    <Button
                        variant={inputMode === "upload" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => requestModeChange("upload")}
                        className="gap-2"
                    >
                        <Upload className="size-4" />
                        Upload File
                    </Button>
                    <Button
                        variant={inputMode === "record" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => requestModeChange("record")}
                        className="gap-2"
                    >
                        <Mic className="size-4" />
                        Record Audio
                    </Button>
                </div>

                {/* Audio/Text Input Section */}
                <Card>
                    <CardHeader>
                        <CardTitle>
                            {inputMode === "upload" ? "Upload Recording or Transcript" : "Record Event"}
                        </CardTitle>
                        <CardDescription>
                            {inputMode === "upload"
                                ? "Upload an audio file (MP3, WAV, M4A, WebM) or text transcript (TXT)"
                                : "Record your event directly from your browser"
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {uploadedFile ? (
                            <div className="border rounded-lg p-4 bg-muted/30">
                                <div className="flex items-center gap-4">
                                    <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                                        {uploadedFile.fileType === "text" ? (
                                            <FileText className="size-6 text-primary" />
                                        ) : (
                                            <FileAudio className="size-6 text-primary" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{uploadedFile.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {formatFileSize(uploadedFile.size)}
                                            {uploadedFile.duration && ` · ${formatDuration(uploadedFile.duration)}`}
                                            {uploadedFile.fileType === "text" && " · Text Transcript"}
                                        </p>
                                    </div>
                                    {uploadedFile.url && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            asChild
                                            className="text-muted-foreground hover:text-primary"
                                        >
                                            <a href={uploadedFile.url} download={uploadedFile.name}>
                                                <Download className="size-4" />
                                            </a>
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleRemoveFile}
                                        className="text-muted-foreground hover:text-destructive"
                                    >
                                        <X className="size-4" />
                                    </Button>
                                </div>

                                {uploadedFile.fileType === "audio" && uploadedFile.url && (
                                    <audio
                                        src={uploadedFile.url}
                                        controls
                                        className="w-full mt-4 rounded"
                                    />
                                )}
                            </div>
                        ) : inputMode === "upload" ? (
                            <div
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer",
                                    isDragging
                                        ? "border-primary bg-primary/5"
                                        : "border-muted-foreground/25 hover:border-primary/50"
                                )}
                            >
                                <input
                                    type="file"
                                    accept="audio/*,video/webm,video/mp4,text/plain,.mp3,.wav,.m4a,.webm,.ogg,.mp4,.txt"
                                    onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                                    className="hidden"
                                    id="file-upload"
                                />
                                <label htmlFor="file-upload" className="cursor-pointer">
                                    <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
                                        <Upload className="size-8 text-primary" />
                                    </div>
                                    <p className="text-lg font-medium mb-1">
                                        Drop your file here
                                    </p>
                                    <p className="text-muted-foreground mb-4">
                                        or click to browse
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Audio: MP3, WAV, M4A, WebM (max 500MB)<br/>
                                        Text: TXT transcript files
                                    </p>
                                </label>
                            </div>
                        ) : (
                            <AudioRecorder onRecordingComplete={handleRecordingComplete} autoStart={shouldAutoStart} onUnsavedRecordingChange={setHasUnsavedRecording} />
                        )}
                    </CardContent>
                </Card>

                {/* Event Details */}
                <Card>
                    <CardHeader>
                        <CardTitle>Event Details</CardTitle>
                        <CardDescription>
                            Add information about your event (optional)
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Project Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">
                                Project <span className="text-destructive">*</span>
                            </label>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between overflow-hidden min-w-0">
                                        {loadingProjects ? (
                                            <span className="flex items-center gap-2 text-muted-foreground">
                                                <Loader2 className="size-4 animate-spin" />
                                                Loading projects...
                                            </span>
                                        ) : selectedProject ? (
                                            <span className="flex items-center gap-2 truncate">
                                                <FolderKanban className="size-4 shrink-0" />
                                                <span className="truncate">{selectedProject.display_name}</span>
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">Select a project</span>
                                        )}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-[400px]">
                                    {loadingProjects ? (
                                        <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                                            <Loader2 className="size-4 animate-spin" />
                                            Loading projects...
                                        </div>
                                    ) : projects.length === 0 ? (
                                        <DropdownMenuItem
                                            onClick={() => setShowCreateProjectDialog(true)}
                                            className="flex items-center gap-2 cursor-pointer"
                                        >
                                            <Plus className="size-4" />
                                            Create first project
                                        </DropdownMenuItem>
                                    ) : (
                                        <>
                                            {projects.map((project) => (
                                                <DropdownMenuItem
                                                    key={project.id}
                                                    onClick={() => setSelectedProject(project)}
                                                    className="flex items-center gap-2"
                                                >
                                                    <FolderKanban className="size-4" />
                                                    <span>{project.display_name}</span>
                                                    <span className="ml-auto text-xs text-muted-foreground">
                                                        {project.meeting_count || 0} events
                                                    </span>
                                                </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => setShowCreateProjectDialog(true)}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <Plus className="size-4" />
                                                Create new project
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <p className="text-xs text-muted-foreground">
                                Choose where this event belongs.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="title" className="text-sm font-medium">
                                Event Title
                            </label>
                            <Input
                                id="title"
                                placeholder="e.g., Weekly Team Standup"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                            />
                        </div>

                        {/* Event Type */}
                        <div className="space-y-2">
                            <label htmlFor="event-type" className="text-sm font-medium">
                                Event Type
                            </label>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full justify-between">
                                        <span className="truncate">{selectedEventType}</span>
                                        <ChevronDown className="size-4 shrink-0 ml-2" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-[400px] max-h-[300px] overflow-y-auto">
                                    {EVENT_TYPE_PRESETS.map((type) => (
                                        <DropdownMenuItem
                                            key={type}
                                            onClick={() => setSelectedEventType(type)}
                                            className={selectedEventType === type ? "bg-primary/10" : ""}
                                        >
                                            {type}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <p className="text-xs text-muted-foreground">
                                Choose the type that best describes this event.
                            </p>
                        </div>

                        {/* Tags Input */}
                        <div className="space-y-2">
                            <label htmlFor="tags" className="text-sm font-medium">
                                Tags
                            </label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                                    <Input
                                        id="tags"
                                        placeholder="Add a tag..."
                                        value={tagInput}
                                        onChange={(e) => setTagInput(e.target.value)}
                                        onKeyDown={handleTagKeyDown}
                                        className="pl-10"
                                    />
                                </div>
                                <Button variant="outline" onClick={handleAddTag} type="button">
                                    Add
                                </Button>
                            </div>
                            {eventTags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {eventTags.map((tag) => (
                                        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                                            {tag}
                                            <button
                                                onClick={() => handleRemoveTag(tag)}
                                                className="ml-1 hover:text-destructive rounded-sm cursor-pointer"
                                                type="button"
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Press Enter or comma to add a tag.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor="notes" className="text-sm font-medium">
                                Additional Notes
                            </label>
                            <Textarea
                                id="notes"
                                placeholder="Any context about the event..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={3}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Submit Button */}
                <div className="flex justify-end gap-3">
                    <Button variant="outline" asChild>
                        <Link href="/events">Cancel</Link>
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!uploadedFile || !selectedProject || isProcessing}
                        className="gap-2"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                {processingStatus || "Processing..."}
                            </>
                        ) : (
                            <>
                                <Upload className="size-4" />
                                Upload Event
                            </>
                        )}
                    </Button>
                </div>

                {/* Discard Recording Confirmation Dialog */}
                <Dialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Cancel recording?</DialogTitle>
                            <DialogDescription>
                                Going to Upload File will stop and discard your current recording.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setShowDiscardDialog(false)}
                            >
                                Keep Recording
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    setShowDiscardDialog(false);
                                    setHasUnsavedRecording(false);
                                    setIsQuickRecordEntry(false);
                                    if (pendingMode) setInputMode(pendingMode);
                                }}
                            >
                                Cancel Recording
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={showCreateProjectDialog} onOpenChange={setShowCreateProjectDialog}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create new project</DialogTitle>
                            <DialogDescription>
                                Add a project to organize this event.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <label htmlFor="project-name" className="text-sm font-medium">Project name</label>
                                <Input
                                    id="project-name"
                                    placeholder="e.g., Team Events"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="project-description" className="text-sm font-medium">Description</label>
                                <Textarea
                                    id="project-description"
                                    placeholder="What is this project for?"
                                    value={newProjectDescription}
                                    onChange={(e) => setNewProjectDescription(e.target.value)}
                                    rows={2}
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="project-goals" className="text-sm font-medium">Goals</label>
                                <Textarea
                                    id="project-goals"
                                    placeholder="What do you want to achieve?"
                                    value={newProjectGoals}
                                    onChange={(e) => setNewProjectGoals(e.target.value)}
                                    rows={2}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setShowCreateProjectDialog(false);
                                    setNewProjectName("");
                                    setNewProjectDescription("");
                                    setNewProjectGoals("");
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateProject}
                                disabled={!newProjectName.trim() || isCreatingProject}
                            >
                                {isCreatingProject ? (
                                    <>
                                        <Loader2 className="size-4 mr-2 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    "Create project"
                                )}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

            </div>
        </DashboardLayout>
    );
}