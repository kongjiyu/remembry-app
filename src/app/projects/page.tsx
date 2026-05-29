"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FolderKanban, Plus, Search, MoreVertical, Mic, CheckCircle2, Trash2, Loader2 } from "lucide-react";
import { AppLink } from "@/components/ui/app-link";
import { apiFetch } from "@/lib/apiFetch";
import { normalizeMeeting, buildProjectMap, countMeetingsByProject, type NormalizedMeeting } from "@/lib/meetingViews";
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

interface Project {
    id: string;
    display_name: string;
    color: string;
    description: string;
    goals: string;
    created_at: string;
}

export default function ProjectsPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [meetings, setEvents] = useState<NormalizedMeeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        async function loadData() {
            try {
                const [projectsRes, eventsRes] = await Promise.all([
                    apiFetch('/api/projects'),
                    apiFetch('/api/events'),
                ]);
                if (cancelled) return;
                const projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] };
                const eventsData = eventsRes.ok ? await eventsRes.json() : { meetings: [] };
                setProjects(projectsData.projects || []);
                setEvents(eventsData.meetings || []);
            } catch (error) {
                if (!cancelled) console.error('Error fetching data:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        loadData();
        return () => { cancelled = true; };
    }, []);

    const fetchProjects = async () => {
        try {
            const response = await apiFetch('/api/projects');
            if (!response.ok) throw new Error('Failed to fetch projects');
            const data = await response.json();
            setProjects(data.projects || []);
        } catch (error) {
            console.error('Error fetching projects:', error);
        }
    };

    useEffect(() => {
        if (projects.length > 0) {
            const projectMap = buildProjectMap(projects);
            setEvents(prev => prev.map(m => normalizeMeeting(m, projectMap)));
        }
    }, [projects]);

    const eventCounts = countMeetingsByProject(meetings);
    const totalEventCount = meetings.length;

    const handleDeleteProject = async () => {
        if (!projectToDelete) return;

        try {
            setIsDeleting(true);
            const response = await apiFetch(`/api/projects/${encodeURIComponent(projectToDelete.id)}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete project');
            }

            await fetchProjects();
            setProjectToDelete(null);
        } catch (error) {
            console.error('Error deleting project:', error);
            alert(error instanceof Error ? error.message : 'Failed to delete project');
        } finally {
            setIsDeleting(false);
        }
    };

    const filteredProjects = projects.filter(project =>
        project.display_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getEventCount = (projectId: string) => eventCounts.get(projectId) || 0;

    return (
        <DashboardLayout
            breadcrumbs={[{ label: "Projects" }]}
            title="Projects"
        >
            <div className="space-y-6">
                {/* Header Actions */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 max-w-sm">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <Input
                                placeholder="Search projects..."
                                className="pl-9"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                    <Button asChild size="lg" className="gap-2">
                        <AppLink href="/projects/new">
                            <Plus className="size-5" />
                            New Project
                        </AppLink>
                    </Button>
                </div>

                {/* Stats */}
                <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Total Projects
                            </CardTitle>
                            <FolderKanban className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">{projects.length}</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                From RAG file search stores
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Created This Month
                            </CardTitle>
                            <Mic className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">
                                {projects.filter(p => {
                                    const projectDate = new Date(p.created_at);
                                    const now = new Date();
                                    return projectDate.getMonth() === now.getMonth() &&
                                           projectDate.getFullYear() === now.getFullYear();
                                }).length}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Active this month
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                Total Events
                            </CardTitle>
                            <CheckCircle2 className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold">
                                {totalEventCount}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Across all projects
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Projects Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <p className="text-muted-foreground">Loading projects...</p>
                    </div>
                ) : filteredProjects.length === 0 ? (
                    <Card className="py-12">
                        <CardContent className="text-center">
                            <FolderKanban className="size-12 text-muted-foreground mx-auto mb-4" />
                            <h3 className="text-lg font-semibold mb-2">
                                {searchQuery ? "No projects found" : "No projects yet"}
                            </h3>
                            <p className="text-muted-foreground mb-4">
                                {searchQuery
                                    ? "Try adjusting your search query"
                                    : "Create your first project to get started"
                                }
                            </p>
                            {!searchQuery && (
                                <Button asChild>
                                    <AppLink href="/projects/new">
                                        <Plus className="size-4 mr-2" />
                                        Create Project
                                    </AppLink>
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredProjects.map((project) => {
                            const createdDate = new Date(project.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            });
                            const eventCount = getEventCount(project.id);

                            return (
                                <Card key={project.id} className="hover:shadow-md transition-shadow">
                                    <CardHeader>
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="size-10 rounded-lg bg-blue-500 flex items-center justify-center text-white">
                                                    <FolderKanban className="size-5" />
                                                </div>
                                                <div>
                                                    <CardTitle className="text-base">{project.display_name}</CardTitle>
                                                </div>
                                            </div>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="size-8">
                                                        <MoreVertical className="size-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem asChild>
                                                        <AppLink href={`/projects/detail?id=${encodeURIComponent(project.id)}`}>View Details</AppLink>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={(e) => {
                                                        e.preventDefault();
                                                        setProjectToDelete(project);
                                                    }} className="text-destructive">
                                                        <Trash2 className="size-4 mr-2" />
                                                        Delete Project
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                        <CardDescription className="mt-2">
                                            {eventCount} {eventCount === 1 ? 'event' : 'events'} in this project
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between text-sm">
                                                <span className="text-muted-foreground">Events</span>
                                                <span className="font-semibold">{eventCount}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">
                                                    Created: {createdDate}
                                                </span>
                                                <Badge className="bg-success/10 text-success border-success/20">Active</Badge>
                                            </div>
                                            <div className="pt-2">
                                                <Button asChild className="w-full" variant={eventCount === 0 ? "default" : "outline"}>
                                                    <AppLink href={eventCount === 0 ? `/events/new` : `/projects/detail?id=${encodeURIComponent(project.id)}`}>
                                                        {eventCount === 0 ? (
                                                            <>
                                                                <Plus className="size-4 mr-2" />
                                                                Upload Recording
                                                            </>
                                                        ) : (
                                                            'View Details'
                                                        )}
                                                    </AppLink>
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Delete Project Confirmation Dialog */}
            <Dialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Project</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete &quot;{projectToDelete?.display_name}&quot;? This will permanently delete
                            the project and all {projectToDelete ? getEventCount(projectToDelete.id) : 0} associated event(s) from the local store. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setProjectToDelete(null)}
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
        </DashboardLayout>
    );
}