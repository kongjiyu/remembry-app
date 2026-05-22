"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/apiFetch";
import { normalizeMeeting, buildProjectMap, type NormalizedMeeting } from "@/lib/meetingViews";
import { UploadJobsBanner } from "@/components/ui/upload-jobs-banner";
import Link from "next/link";
import {
    Mic, FileText, CheckCircle2, Upload,
    FolderKanban, Plus,
    Search, ArrowRight, Sparkles, Calendar
} from "lucide-react";

interface Project {
    id: string;
    display_name: string;
    color: string;
    description: string;
    goals: string;
    created_at: string;
    meeting_count?: number;
    meetings?: Meeting[];
}

interface Meeting {
    id: string;
    display_name: string;
    title: string;
    project_id: string;
    created_at: string;
    transcription?: { text: string; language?: string };
    notes_by_language?: Record<string, unknown>;
    default_language?: string;
    available_languages?: string[];
}

export default function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [meetings, setMeetings] = useState<NormalizedMeeting[]>([]);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [projectsRes, meetingsRes] = await Promise.all([
                apiFetch('/api/projects'),
                apiFetch('/api/meetings'),
            ]);
            const projectsJson = projectsRes.ok ? await projectsRes.json() : {};
            const meetingsJson = meetingsRes.ok ? await meetingsRes.json() : {};
            const projectsData = projectsJson.projects || [];
            const rawMeetings: Record<string, unknown>[] = meetingsJson.meetings || [];
            const projectMap = buildProjectMap(projectsData);
            const normalizedMeetings = rawMeetings.map((m: Record<string, unknown>) => normalizeMeeting(m, projectMap));
            setProjects(projectsData);
            setMeetings(normalizedMeetings);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const totalMeetings = meetings.length;

    const projectMeetingCounts = new Map<string, number>();
    for (const m of meetings) {
        projectMeetingCounts.set(m.project_id, (projectMeetingCounts.get(m.project_id) || 0) + 1);
    }

    const recentMeetingsList = [...meetings]
        .filter(m => !m.displayName.startsWith('project-'))
        .sort((a, b) => {
            const timeA = new Date(a.uploadTime || 0).getTime();
            const timeB = new Date(b.uploadTime || 0).getTime();
            return timeB - timeA;
        })
        .slice(0, 5);

    const recentProjectsList = projects.slice(0, 3);

    return (
        <DashboardLayout breadcrumbs={[{ label: "Dashboard" }]} title="Overview">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-8">

                {/* ACTIVE / FAILED UPLOAD JOBS */}
                <div className="col-span-1 md:col-span-12">
                    <UploadJobsBanner />
                </div>

                {/* HERO SECTION */}
                <div className="col-span-1 md:col-span-8 flex flex-col gap-6">
                    <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary/10 via-background to-background shadow-lg">
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                            <Sparkles className="w-64 h-64 text-primary" />
                        </div>
                        <CardHeader>
                            <CardTitle className="text-3xl font-light tracking-tight">
                                Good Morning, <span className="font-semibold text-primary">Creator</span>
                            </CardTitle>
                            <CardDescription className="text-lg">
                                You have <span className="font-medium text-foreground">{totalMeetings} events</span> processed and ready for search.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="relative z-10 space-y-4">
                            <div className="relative max-w-xl">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-5" />
                                <Input
                                    className="pl-10 h-12 bg-background/50 backdrop-blur-sm border-primary/20 focus-visible:ring-primary/30 text-base shadow-sm rounded-xl"
                                    placeholder="Ask Remembry: &quot;What did we decide about the roadmap?&quot;"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-lg">
                                        <ArrowRight className="size-4" />
                                    </Button>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 pt-2">
                                <Button
                                    size="lg"
                                    className="gap-3 h-12 px-6 shadow-lg shadow-primary/25 rounded-xl font-medium"
                                    asChild
                                >
                                    <Link href="/events/new?mode=record">
                                        <div className="flex items-center justify-center size-8 rounded-full bg-white/20">
                                            <Mic className="size-5" />
                                        </div>
                                        Quick Record
                                    </Link>
                                </Button>
                                <span className="text-sm text-muted-foreground">Start capturing instantly</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* RECENT PROJECTS ROW */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {loading ? (
                             [1, 2, 3].map(i => (
                                <div key={i} className="h-32 rounded-2xl bg-muted/20 animate-pulse" />
                             ))
                        ) : recentProjectsList.length > 0 ? (
                            recentProjectsList.map((project) => (
                                <Link key={project.id} href={`/projects/detail?id=${encodeURIComponent(project.id)}`}>
                                    <Card className="h-full hover:bg-muted/50 transition-all duration-300 hover:scale-[1.02] border border-border/50 shadow-sm bg-card/50 backdrop-blur-sm cursor-pointer group">
                                        <CardContent className="p-5 flex flex-col justify-between h-full">
                                            <div className="flex justify-between items-start">
                                                <div className={`size-10 rounded-xl ${project.color || 'bg-gradient-to-br from-blue-500 to-violet-500'} flex items-center justify-center text-white shadow-md group-hover:shadow-lg transition-shadow`}>
                                                    <FolderKanban className="size-5" />
                                                </div>
                                                <Badge variant="secondary" className="bg-background/80 backdrop-blur-md">
                                                    {projectMeetingCounts.get(project.id) || 0}
                                                </Badge>
                                            </div>
                                            <div>
                                                <h3 className="font-medium break-words mt-3 group-hover:text-primary transition-colors">{project.display_name}</h3>
                                                <p className="text-xs text-muted-foreground">Updated recently</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            ))
                        ) : (
                            <div className="col-span-3 flex items-center justify-center h-32 border border-dashed rounded-2xl border-muted">
                                <Link href="/projects/new" className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors">
                                    <Plus className="size-4" /> Create first project
                                </Link>
                            </div>
                        )}
                        <Link href="/projects/new">
                            <Card className="h-full hover:bg-muted/50 transition-all duration-300 hover:scale-[1.02] border border-dashed border-border/50 hover:border-primary/50 bg-card/30 backdrop-blur-sm cursor-pointer group shadow-sm">
                                <CardContent className="p-5 flex flex-col items-center justify-center h-full gap-3 min-w-0">
                                    <div className="size-11 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300 flex-shrink-0">
                                        <Plus className="size-5" />
                                    </div>
                                    <div className="text-center">
                                        <span className="text-sm font-semibold text-muted-foreground group-hover:text-primary transition-colors break-words">New Project</span>
                                        <p className="text-[10px] text-muted-foreground/40 mt-0.5 uppercase tracking-widest font-bold">Add Store</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    </div>
                </div>

                {/* STATS & ACTIONS COLUMN */}
                <div className="col-span-1 md:col-span-4 flex flex-col gap-6">
                    <div className="grid grid-cols-2 gap-4">
                        <Link href="/events/new" className="col-span-2">
                            <Button size="lg" className="w-full h-14 text-lg font-medium shadow-md shadow-primary/20 rounded-xl">
                                <Upload className="mr-2 size-5" /> Upload
                            </Button>
                        </Link>
                        <Link href="/events">
                            <Button variant="outline" size="lg" className="w-full h-12 rounded-xl bg-card/50 backdrop-blur-sm">
                                <Mic className="mr-2 size-4" /> Events
                            </Button>
                        </Link>
                        <Link href="/projects">
                            <Button variant="outline" size="lg" className="w-full h-12 rounded-xl bg-card/50 backdrop-blur-sm">
                                <FolderKanban className="mr-2 size-4" /> Projects
                            </Button>
                        </Link>
                    </div>

                    <Card className="flex-1 border-none shadow-sm bg-card/50 backdrop-blur-xl">
                        <CardHeader>
                            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Analytics</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center gap-4">
                                <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                                    <Mic className="size-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-2xl font-bold">{totalMeetings}</div>
                                    <div className="text-xs text-muted-foreground">Total Recordings</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="size-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 flex-shrink-0">
                                    <CheckCircle2 className="size-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-2xl font-bold">{projects.length}</div>
                                    <div className="text-xs text-muted-foreground">Active Projects</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* RECENT EVENTS */}
                <div className="col-span-1 md:col-span-12">
                    <Card className="border-none shadow-sm bg-card/50 backdrop-blur-xl">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Recent Activity</CardTitle>
                                <CardDescription>Your latest event notes and insights</CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" asChild>
                                <Link href="/events" className="text-muted-foreground hover:text-primary">View All</Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                {loading ? (
                                    <div className="text-center py-8 text-muted-foreground">Loading...</div>
                                ) : recentMeetingsList.length === 0 ? (
                                    <div className="text-center py-12 border-2 border-dashed rounded-xl border-muted/50">
                                        <div className="flex flex-col items-center gap-2">
                                            <Mic className="size-8 text-muted-foreground/50" />
                                            <p className="text-muted-foreground font-medium">No recent events</p>
                                        </div>
                                    </div>
                                ) : (
                                    recentMeetingsList.map((meeting) => (
                                        <Link
                                            key={meeting.id}
                                            href={`/events/detail?id=${encodeURIComponent(meeting.id)}&projectName=${encodeURIComponent(meeting.project_id)}&displayName=${encodeURIComponent(meeting.projectDisplayName || '')}`}
                                            className="group flex items-center justify-between p-4 rounded-xl hover:bg-muted/50 transition-all duration-200 border border-transparent hover:border-border/50 min-w-0"
                                        >
                                            <div className="flex items-center gap-4 min-w-0 flex-1">
                                                <div className="size-10 rounded-full bg-secondary flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                                                    <FileText className="size-5 text-secondary-foreground" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="font-medium group-hover:text-primary transition-colors break-words">
                                                        {meeting.displayName}
                                                    </h4>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <span className="flex items-center gap-1 flex-shrink-0">
                                                            <Calendar className="size-3" />
                                                            {meeting.uploadTime ? new Date(meeting.uploadTime).toLocaleDateString() : 'Unknown'}
                                                        </span>
                                                        <span className="flex-shrink-0">•</span>
                                                        <span className="break-words min-w-0">{meeting.projectDisplayName}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <Badge variant="outline" className="bg-emerald-500/5 text-emerald-600 border-emerald-500/20 group-hover:bg-emerald-500/10 transition-colors flex-shrink-0">
                                                Processed
                                            </Badge>
                                        </Link>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </DashboardLayout>
    );
}
