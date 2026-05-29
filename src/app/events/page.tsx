"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Mic, Upload, Search, MoreVertical, Clock, CheckCircle2, Loader2, AlertCircle, FolderKanban, Trash2 } from "lucide-react";
import { AppLink } from "@/components/ui/app-link";
import { apiFetch } from "@/lib/apiFetch";
import { normalizeMeeting, buildProjectMap, formatMimeBadgeLabel, type NormalizedMeeting } from "@/lib/meetingViews";
import { UploadJobsBanner } from "@/components/ui/upload-jobs-banner";
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

function getStatusInfo(status: string) {
    switch (status) {
        case "completed":
            return {
                badge: <Badge className="bg-success/10 text-success border-success/20 gap-1"><CheckCircle2 className="size-3" />Synced</Badge>,
                icon: CheckCircle2,
                color: "text-success",
            };
        case "processing":
            return {
                badge: <Badge className="bg-primary/10 text-primary border-primary/20 gap-1"><Loader2 className="size-3 animate-spin" />Processing</Badge>,
                icon: Loader2,
                color: "text-primary",
            };
        case "pending_review":
            return {
                badge: <Badge className="bg-warning/10 text-warning border-warning/20 gap-1"><AlertCircle className="size-3" />Review</Badge>,
                icon: AlertCircle,
                color: "text-warning",
            };
        default:
            return {
                badge: <Badge variant="secondary">Unknown</Badge>,
                icon: Clock,
                color: "text-muted-foreground",
            };
    }
}

export default function EventsPage() {
    const [meetings, setMeetings] = useState<NormalizedMeeting[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [meetingToDelete, setMeetingToDelete] = useState<NormalizedMeeting | null>(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        fetchMeetings();
    }, []);

    const fetchMeetings = async () => {
        try {
            setLoading(true);
            const [meetingsRes, projectsRes] = await Promise.all([
                apiFetch('/api/meetings'),
                apiFetch('/api/projects'),
            ]);

            if (!meetingsRes.ok) throw new Error('Failed to fetch events');

            const meetingsData = await meetingsRes.json();
            const projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] };

            const rawMeetings: Record<string, unknown>[] = meetingsData.meetings || [];
            const projectMap = buildProjectMap((projectsData.projects || []) as Array<{ id: string; display_name: string }>);
            setMeetings(rawMeetings.map(m => normalizeMeeting(m, projectMap)));
        } catch (error) {
            console.error('Error fetching events:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredMeetings = meetings.filter(meeting =>
        meeting.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        meeting.projectDisplayName?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'Unknown date';
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const formatTime = (dateString?: string) => {
        if (!dateString) return '';
        return new Date(dateString).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleDeleteMeeting = async () => {
        if (!meetingToDelete) return;

        try {
            setIsDeleting(true);
            const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingToDelete.id)}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete event');
            }

            setMeetings(prev => prev.filter(m => m.id !== meetingToDelete.id));
        } catch (error) {
            console.error('Error deleting event:', error);
            alert(error instanceof Error ? error.message : 'Failed to delete event');
        } finally {
            setIsDeleting(false);
            setShowDeleteDialog(false);
            setMeetingToDelete(null);
        }
    };
    return (
        <DashboardLayout breadcrumbs={[{ label: "Events" }]} title="Events">
            <div className="space-y-6">
                {/* Header Actions */}
                <div className="flex flex-col sm:flex-row gap-4 justify-between">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                            placeholder="Search events..."
                            className="pl-10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <Button asChild className="gap-2">
                        <AppLink href="/events/new">
                            <Upload className="size-4" />
                            Upload Recording
                        </AppLink>
                    </Button>
                </div>

                {/* Active / Failed Upload Jobs */}
                <UploadJobsBanner onJobCompleted={fetchMeetings} />

                {/* Loading State */}
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <p className="text-muted-foreground">Loading events...</p>
                    </div>
                ) : filteredMeetings.length === 0 ? (
                    /* Empty State */
                    <Card className="border-dashed">
                        <CardContent className="flex flex-col items-center justify-center py-16">
                            <div className="flex size-16 items-center justify-center rounded-full bg-muted mb-4">
                                <Mic className="size-8 text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-medium mb-2">
                                {searchQuery ? "No events found" : "No events yet"}
                            </h3>
                            <p className="text-muted-foreground text-center max-w-sm mb-4">
                                {searchQuery
                                    ? "Try adjusting your search query"
                                    : "Upload your first recording to get started with AI-powered transcription and knowledge extraction."
                                }
                            </p>
                            {!searchQuery && (
                                <Button asChild>
                                    <AppLink href="/events/new">
                                        <Upload className="size-4 mr-2" />
                                        Upload Recording
                                    </AppLink>
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    /* Events Grid */
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredMeetings.map((meeting, index) => {
                            const statusInfo = getStatusInfo("completed");
                            const encodedDocName = encodeURIComponent(meeting.id || meeting.name || String(index));
                            return (
                                <Card key={meeting.id || meeting.name || index} className="group hover:shadow-lg transition-all hover:border-primary/50 relative">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-start justify-between gap-2 min-w-0">
                                            <AppLink
                                                href={`/events/detail?id=${encodedDocName}&projectName=${encodeURIComponent(meeting.project_id || meeting.projectName)}&displayName=${encodeURIComponent(meeting.projectDisplayName || '')}`}
                                                className="flex items-start gap-3 min-w-0 flex-1 hover:opacity-80 transition-opacity"
                                            >
                                                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 flex-shrink-0">
                                                    <Mic className="size-5 text-primary" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <CardTitle className="text-base break-words">
                                                        {meeting.displayName || 'Untitled Event'}
                                                    </CardTitle>
                                                    <CardDescription className="break-words">
                                                        {formatDate(meeting.uploadTime)} · {formatTime(meeting.uploadTime)}
                                                    </CardDescription>
                                                </div>
                                            </AppLink>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                    <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 relative z-10">
                                                        <MoreVertical className="size-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem asChild>
                                                        <AppLink href={`/projects/detail?id=${encodeURIComponent(meeting.project_id || meeting.projectName)}`}>View Project</AppLink>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem asChild>
                                                        <AppLink href={`/events/detail?id=${encodedDocName}&projectName=${encodeURIComponent(meeting.project_id || meeting.projectName)}&displayName=${encodeURIComponent(meeting.projectDisplayName || '')}`}>
                                                            View Transcript
                                                        </AppLink>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setMeetingToDelete(meeting);
                                                            setShowDeleteDialog(true);
                                                        }}
                                                        className="text-destructive"
                                                    >
                                                        <Trash2 className="size-4 mr-2" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="pt-0">
                                        <div className="flex items-start gap-2 mb-3">
                                            <FolderKanban className="size-3 text-muted-foreground mt-1 flex-shrink-0" />
                                            <span className="text-sm text-muted-foreground break-words">
                                                {meeting.projectDisplayName}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {meeting.mimeType && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {formatMimeBadgeLabel(meeting.mimeType, meeting.file_type)}
                                                    </Badge>
                                                )}
                                            </div>
                                            {statusInfo.badge}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Delete Event Confirmation Dialog */}
            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Event</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete &quot;{meetingToDelete?.displayName}&quot;? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowDeleteDialog(false);
                                setMeetingToDelete(null);
                            }}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDeleteMeeting}
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