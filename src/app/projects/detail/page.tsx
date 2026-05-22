"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    FolderKanban,
    Plus,
    Search,
    MoreVertical,
    Mic,
    Calendar,
    FileText,
    ArrowLeft,
    Upload,
    MessageCircleQuestion,
    Trash2,
    Loader2,
    Gavel,
    ListTodo,
    HelpCircle,
    Sparkles,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/apiFetch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatMimeBadgeLabel } from "@/lib/meetingViews";
import {
    aggregateProjectKnowledge,
    MeetingWithKnowledge,
    ProjectKnowledgeOverview,
    ProjectKnowledgeItem,
} from "@/lib/eventKnowledge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface Meeting {
    id: string;
    display_name: string;
    uploadTime?: string;
    mimeType?: string;
    file_type?: string;
    knowledge_by_language?: Record<string, unknown> | null;
    default_language?: string | null;
}

interface Project {
    id: string;
    display_name: string;
    color: string;
    description: string;
    goals: string;
    created_at: string;
    meeting_count?: number;
}

interface ProjectDetail extends Project {
    meetings: Meeting[];
}

function formatDate(dateString?: string) {
    if (!dateString) return 'Unknown date';
    return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function KnowledgeRow({ item, project }: { item: ProjectKnowledgeItem; project: ProjectDetail }) {
    const eventUrl = `/events/detail?id=${encodeURIComponent(item.sourceEventId)}&projectName=${encodeURIComponent(project.id)}&displayName=${encodeURIComponent(project.display_name)}`;

    const icon = item.itemType === 'decision'
        ? <Gavel className="size-4 text-orange-500 shrink-0 mt-0.5" />
        : item.itemType === 'action_item'
        ? <ListTodo className="size-4 text-green-500 shrink-0 mt-0.5" />
        : <HelpCircle className="size-4 text-purple-500 shrink-0 mt-0.5" />;

    const typeBadge = item.itemType === 'decision'
        ? <Badge variant="outline" className="text-xs text-orange-600 border-orange-200">Decision</Badge>
        : item.itemType === 'action_item'
        ? <Badge variant="outline" className="text-xs text-green-600 border-green-200">Action Item</Badge>
        : <Badge variant="outline" className="text-xs text-purple-600 border-purple-200">Question</Badge>;

    return (
        <Link
            href={eventUrl}
            className="flex gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 transition-colors items-start group"
        >
            {icon}
            <div className="flex-1 min-w-0 break-words whitespace-normal">
                <p className="text-sm leading-relaxed">{item.content}</p>
                <div className="flex flex-wrap gap-1.5 items-center mt-1.5">
                    {typeBadge}
                    {item.itemType === 'action_item' && item.assignee && (
                        <Badge variant="outline" className="text-xs">Assignee: {item.assignee}</Badge>
                    )}
                    {item.itemType === 'action_item' && item.dueDate && (
                        <Badge variant="outline" className="text-xs">Due: {item.dueDate}</Badge>
                    )}
                    {item.itemType === 'question' && item.questionStatus && (
                        <Badge
                            variant={item.questionStatus === "answered" ? "default" : item.questionStatus === "partially_answered" ? "outline" : "secondary"}
                            className="text-xs"
                        >
                            {item.questionStatus.replace("_", " ")}
                        </Badge>
                    )}
                    {item.answer && (
                        <span className="text-xs text-muted-foreground italic">Answer: {item.answer}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{item.sourceEventTitle}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{formatDate(item.sourceEventDate)}</span>
                </div>
            </div>
        </Link>
    );
}

function ProjectDetailContent() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const projectName = searchParams.get("id") || "";

    const [project, setProject] = useState<ProjectDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [meetingToDelete, setMeetingToDelete] = useState<Meeting | null>(null);
    const [showDeleteMeetingDialog, setShowDeleteMeetingDialog] = useState(false);
    const [isDeletingMeeting, setIsDeletingMeeting] = useState(false);
    const [projectOverview, setProjectOverview] = useState<ProjectKnowledgeOverview | null>(null);
    const [expandedTabs, setExpandedTabs] = useState<Record<string, boolean>>({});

    const toggleExpanded = (tab: string) => {
        setExpandedTabs(prev => ({ ...prev, [tab]: !prev[tab] }));
    };

    useEffect(() => {
        if (projectName) {
            fetchProjectDetails();
        }
    }, [projectName]);

    const fetchProjectDetails = async () => {
        try {
            setLoading(true);

            const projectsResponse = await apiFetch('/api/projects');
            if (!projectsResponse.ok) {
                throw new Error('Failed to fetch projects');
            }
            const projectsData = await projectsResponse.json();
            const foundProject = projectsData.projects?.find((p: ProjectDetail) => p.id === projectName);

            if (!foundProject) {
                console.error('Project not found');
                setLoading(false);
                return;
            }

            const meetingsResponse = await apiFetch(`/api/meetings?project_id=${encodeURIComponent(projectName)}`);
            const meetingsData = meetingsResponse.ok ? await meetingsResponse.json() : { meetings: [] };
            const meetings: Meeting[] = (meetingsData.meetings || []).map((m: Record<string, unknown>) => ({
                id: String(m.id || ''),
                display_name: String(m.title || m.display_name || 'Untitled Event'),
                uploadTime: String(m.created_at || ''),
                mimeType: String(m.mime_type || m.file_type || ''),
                knowledge_by_language: (m.knowledge_by_language as Record<string, unknown> | null) || null,
                default_language: (m.default_language as string | null) || null,
            }));

            const meetingsForOverview: MeetingWithKnowledge[] = meetings.map(m => ({
                id: m.id,
                title: m.display_name,
                created_at: m.uploadTime || '',
                knowledge_by_language: m.knowledge_by_language || null,
                default_language: m.default_language || null,
            }));
            setProjectOverview(aggregateProjectKnowledge(meetingsForOverview));

            setProject({
                ...foundProject,
                meetings,
                meeting_count: meetings.length,
            });
        } catch (error) {
            console.error('Error fetching project:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredEvents = (project?.meetings || []).filter(meeting =>
        meeting.display_name.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const handleDeleteProject = async () => {
        if (!project) return;

        try {
            setIsDeleting(true);
            const response = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete project');
            }

            router.push('/projects');
        } catch (error) {
            console.error('Error deleting project:', error);
            alert(error instanceof Error ? error.message : 'Failed to delete project');
        } finally {
            setIsDeleting(false);
            setShowDeleteDialog(false);
        }
    };

    const handleDeleteMeeting = async () => {
        if (!meetingToDelete || !project) return;

        try {
            setIsDeletingMeeting(true);
            const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingToDelete.id)}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete meeting');
            }

            const remainingMeetings = project.meetings.filter(m => m.id !== meetingToDelete.id);
            const meetingsForOverview: MeetingWithKnowledge[] = remainingMeetings.map(m => ({
                id: m.id,
                title: m.display_name,
                created_at: m.uploadTime || '',
                knowledge_by_language: m.knowledge_by_language || null,
                default_language: m.default_language || null,
            }));
            setProjectOverview(aggregateProjectKnowledge(meetingsForOverview));

            setProject(prev => prev ? {
                ...prev,
                meetings: remainingMeetings,
                meeting_count: (prev.meeting_count || 1) - 1,
            } : null);
        } catch (error) {
            console.error('Error deleting meeting:', error);
            alert(error instanceof Error ? error.message : 'Failed to delete meeting');
        } finally {
            setIsDeletingMeeting(false);
            setShowDeleteMeetingDialog(false);
            setMeetingToDelete(null);
        }
    };

    if (loading) {
        return (
            <DashboardLayout
                breadcrumbs={[
                    { label: "Projects", href: "/projects" },
                    { label: "Loading..." }
                ]}
                title="Loading..."
            >
                <div className="flex items-center justify-center py-12">
                    <p className="text-muted-foreground">Loading project details...</p>
                </div>
            </DashboardLayout>
        );
    }

    if (!project) {
        return (
            <DashboardLayout
                breadcrumbs={[
                    { label: "Projects", href: "/projects" },
                    { label: "Not Found" }
                ]}
                title="Project Not Found"
            >
                <Card className="py-12">
                    <CardContent className="text-center">
                        <FolderKanban className="size-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-semibold mb-2">Project Not Found</h3>
                        <p className="text-muted-foreground mb-4">
                            The project you&apos;re looking for doesn&apos;t exist or has been deleted.
                        </p>
                        <Button asChild>
                            <Link href="/projects">
                                <ArrowLeft className="size-4 mr-2" />
                                Back to Projects
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </DashboardLayout>
        );
    }

    const meetingsNewUrl = `/events/new?projectName=${encodeURIComponent(project.id)}&displayName=${encodeURIComponent(project.display_name)}`;

    return (
        <DashboardLayout
            breadcrumbs={[
                { label: "Projects", href: "/projects" },
                { label: project.display_name }
            ]}
            title={project.display_name}
        >
            <div className="space-y-6">
                {/* Header Actions */}
                <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <Button variant="outline" asChild>
                        <Link href="/projects">
                            <ArrowLeft className="size-4 mr-2" />
                            Back to Projects
                        </Link>
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" asChild>
                            <Link href={`/ask?scope=project&projectName=${encodeURIComponent(project.id)}&displayName=${encodeURIComponent(project.display_name)}`}>
                                <MessageCircleQuestion className="size-4 mr-2" />
                                Ask Questions
                            </Link>
                        </Button>
                        <Button asChild className="gap-2">
                            <Link href={meetingsNewUrl}>
                                <Upload className="size-4" />
                                Upload Event
                            </Link>
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon">
                                    <MoreVertical className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive">
                                    <Trash2 className="size-4 mr-2" />
                                    Delete Project
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {/* Project Info */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Total Events
                            </CardTitle>
                            <Mic className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">{project.meeting_count}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Uploaded recordings
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Created
                            </CardTitle>
                            <Calendar className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold">
                                {new Date(project.created_at).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Project start date
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                RAG Store
                            </CardTitle>
                            <FileText className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-sm font-mono truncate">
                                {project.id.split('/').pop()}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Store identifier
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Project Knowledge Overview */}
                {projectOverview && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-semibold">Project Overview</h2>
                        </div>
                        <Tabs defaultValue="all" className="w-full">
                            <TabsList className="w-fit max-w-full justify-start bg-transparent gap-1 p-0">
                                <TabsTrigger value="all" className="h-8 flex-none px-3 whitespace-nowrap gap-1.5">
                                    All
                                    <Badge variant="secondary" className="text-xs">{projectOverview.allItems.length}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="decisions" className="h-8 flex-none px-3 whitespace-nowrap gap-1.5">
                                    <Gavel className="size-4 text-orange-500" />
                                    Decisions
                                    <Badge variant="secondary" className="text-xs">{projectOverview.decisionsCount}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="action_items" className="h-8 flex-none px-3 whitespace-nowrap gap-1.5">
                                    <ListTodo className="size-4 text-green-500" />
                                    Action Items
                                    <Badge variant="secondary" className="text-xs">{projectOverview.actionItemsCount}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="questions" className="h-8 flex-none px-3 whitespace-nowrap gap-1.5">
                                    <HelpCircle className="size-4 text-purple-500" />
                                    Questions
                                    <Badge variant="secondary" className="text-xs">{projectOverview.questionsCount}</Badge>
                                </TabsTrigger>
                                <TabsTrigger value="needs_extraction" className="h-8 flex-none px-3 whitespace-nowrap gap-1.5">
                                    <Sparkles className="size-4 text-muted-foreground" />
                                    Needs Extraction
                                    <Badge variant="secondary" className="text-xs">{projectOverview.missingEvents.length}</Badge>
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="all" className="mt-4">
                                <div className="space-y-2">
                                    {projectOverview.allItems.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-8 text-center">No knowledge extracted yet.</p>
                                    ) : (
                                        <>
                                            {(expandedTabs["all"] ? projectOverview.allItems : projectOverview.allItems.slice(0, 4)).map((item, i) => (
                                                <KnowledgeRow key={i} item={item} project={project} />
                                            ))}
                                            {projectOverview.allItems.length > 4 && (
                                                <button
                                                    onClick={() => toggleExpanded("all")}
                                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2"
                                                >
                                                    {expandedTabs["all"] ? "Show fewer" : `Show all ${projectOverview.allItems.length}`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="decisions" className="mt-4">
                                <div className="space-y-2">
                                    {projectOverview.decisions.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-8 text-center">No decisions yet.</p>
                                    ) : (
                                        <>
                                            {(expandedTabs["decisions"] ? projectOverview.decisions : projectOverview.decisions.slice(0, 3)).map((item, i) => (
                                                <KnowledgeRow key={i} item={item} project={project} />
                                            ))}
                                            {projectOverview.decisions.length > 3 && (
                                                <button
                                                    onClick={() => toggleExpanded("decisions")}
                                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2"
                                                >
                                                    {expandedTabs["decisions"] ? "Show fewer" : `Show all ${projectOverview.decisions.length}`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="action_items" className="mt-4">
                                <div className="space-y-2">
                                    {projectOverview.actionItems.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-8 text-center">No action items yet.</p>
                                    ) : (
                                        <>
                                            {(expandedTabs["action_items"] ? projectOverview.actionItems : projectOverview.actionItems.slice(0, 3)).map((item, i) => (
                                                <KnowledgeRow key={i} item={item} project={project} />
                                            ))}
                                            {projectOverview.actionItems.length > 3 && (
                                                <button
                                                    onClick={() => toggleExpanded("action_items")}
                                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2"
                                                >
                                                    {expandedTabs["action_items"] ? "Show fewer" : `Show all ${projectOverview.actionItems.length}`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="questions" className="mt-4">
                                <div className="space-y-2">
                                    {projectOverview.questions.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-8 text-center">No questions yet.</p>
                                    ) : (
                                        <>
                                            {(expandedTabs["questions"] ? projectOverview.questions : projectOverview.questions.slice(0, 3)).map((item, i) => (
                                                <KnowledgeRow key={i} item={item} project={project} />
                                            ))}
                                            {projectOverview.questions.length > 3 && (
                                                <button
                                                    onClick={() => toggleExpanded("questions")}
                                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2"
                                                >
                                                    {expandedTabs["questions"] ? "Show fewer" : `Show all ${projectOverview.questions.length}`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="needs_extraction" className="mt-4">
                                <div className="flex flex-wrap gap-2">
                                    {projectOverview.missingEvents.length === 0 ? (
                                        <p className="text-sm text-muted-foreground py-8 text-center">All events have knowledge extracted.</p>
                                    ) : (
                                        <>
                                            {(expandedTabs["needs_extraction"] ? projectOverview.missingEvents : projectOverview.missingEvents.slice(0, 6)).map((evt) => {
                                                const meetingUrl = `/events/detail?id=${encodeURIComponent(evt.id)}&projectName=${encodeURIComponent(project.id)}&displayName=${encodeURIComponent(project.display_name)}`;
                                                return (
                                                    <Link
                                                        key={evt.id}
                                                        href={meetingUrl}
                                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm hover:bg-muted transition-colors"
                                                    >
                                                        <FileText className="size-4 text-muted-foreground" />
                                                        <span>{evt.title || "Untitled Event"}</span>
                                                        <span className="text-xs text-muted-foreground ml-1">{formatDate(evt.date)}</span>
                                                    </Link>
                                                );
                                            })}
                                            {projectOverview.missingEvents.length > 6 && (
                                                <button
                                                    onClick={() => toggleExpanded("needs_extraction")}
                                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2"
                                                >
                                                    {expandedTabs["needs_extraction"] ? "Show fewer" : `Show all ${projectOverview.missingEvents.length}`}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                )}

                {/* Events Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                        <h2 className="text-xl font-semibold">Events</h2>
                        <div className="flex-1 max-w-sm">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search events..."
                                    className="pl-9"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {filteredEvents.length === 0 ? (
                        <Card className="py-12">
                            <CardContent className="text-center">
                                <Mic className="size-12 text-muted-foreground mx-auto mb-4" />
                                <h3 className="text-lg font-semibold mb-2">
                                    {searchQuery ? "No events found" : "No events yet"}
                                </h3>
                                <p className="text-muted-foreground mb-4">
                                    {searchQuery
                                        ? "Try adjusting your search query"
                                        : "Upload your first event recording to get started"
                                    }
                                </p>
                                {!searchQuery && (
                                    <Button asChild>
                                        <Link href={meetingsNewUrl}>
                                            <Plus className="size-4 mr-2" />
                                            Upload Event
                                        </Link>
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4">
                            {filteredEvents.map((meeting, index) => {
                                const encodedDocName = encodeURIComponent(meeting.id);
                                const meetingUrl = `/events/detail?id=${encodedDocName}&projectName=${encodeURIComponent(project.id)}&displayName=${encodeURIComponent(project.display_name)}`;
                                return (
                                    <Card key={meeting.id || index} className="group hover:shadow-md transition-shadow relative">
                                        <CardHeader>
                                            <div className="flex items-start justify-between gap-3">
                                                <Link
                                                    href={meetingUrl}
                                                    className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                                                >
                                                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                                                        <Mic className="size-5 text-primary" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <CardTitle className="text-base line-clamp-1">
                                                            {meeting.display_name || 'Untitled Event'}
                                                        </CardTitle>
                                                        <CardDescription className="flex items-center gap-2 mt-1">
                                                            <Calendar className="size-3" />
                                                            {formatDate(meeting.uploadTime)}
                                                            {meeting.mimeType && (
                                                                <>
                                                                    <span className="text-muted-foreground">·</span>
                                                                    <Badge variant="outline" className="text-xs">
                                                                        {formatMimeBadgeLabel(meeting.mimeType, meeting.file_type)}
                                                                    </Badge>
                                                                </>
                                                            )}
                                                        </CardDescription>
                                                    </div>
                                                </Link>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-8 opacity-0 group-hover:opacity-100 transition-opacity relative z-10"
                                                        >
                                                            <MoreVertical className="size-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem asChild>
                                                            <Link href={meetingUrl}>
                                                                View Transcript
                                                            </Link>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem asChild>
                                                            <Link href={`/ask?scope=meeting&id=${encodeURIComponent(meeting.id)}&name=${encodeURIComponent(meeting.display_name)}&projectName=${encodeURIComponent(project.id)}&displayName=${encodeURIComponent(project.display_name)}`}>
                                                                Ask Questions
                                                            </Link>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem>Download</DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setMeetingToDelete(meeting);
                                                                setShowDeleteMeetingDialog(true);
                                                            }}
                                                            className="text-destructive"
                                                        >
                                                            <Trash2 className="size-4 mr-2" />
                                                            Delete Event
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </CardHeader>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Project Confirmation Dialog */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Project</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete &quot;{project?.display_name}&quot;? This will permanently delete
                            the project and all {project?.meeting_count} associated event(s) from the local store. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowDeleteDialog(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteProject}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="size-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="size-4 mr-2" />
                                    Delete Project
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Event Confirmation Dialog */}
            <Dialog open={showDeleteMeetingDialog} onOpenChange={setShowDeleteMeetingDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Event</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete &quot;{meetingToDelete?.display_name}&quot;? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowDeleteMeetingDialog(false);
                                setMeetingToDelete(null);
                            }}
                            disabled={isDeletingMeeting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteMeeting}
                            disabled={isDeletingMeeting}
                        >
                            {isDeletingMeeting ? (
                                <>
                                    <Loader2 className="size-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="size-4 mr-2" />
                                    Delete Event
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
}

export default function ProjectDetailsPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center py-12"><p className="text-muted-foreground">Loading project details...</p></div>}>
            <ProjectDetailContent />
        </Suspense>
    );
}