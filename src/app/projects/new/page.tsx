"use client";

import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FolderKanban, Plus } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { navigateTo } from "@/lib/navigation";

export default function NewProjectPage() {
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [goals, setGoals] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            // Call API to create project with RAG store
            const response = await apiFetch('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name,
                    description,
                    goals,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create project');
            }

            const data = await response.json();
            console.log('Project created successfully:', data.project);

            // Redirect to projects page
            navigateTo("/projects");
        } catch (error) {
            console.error('Error creating project:', error);
            alert(error instanceof Error ? error.message : 'Failed to create project');
            setIsSubmitting(false);
        }
    };

    const isFormValid = name.trim().length > 0;

    return (
        <DashboardLayout
            breadcrumbs={[
                { label: "Projects", href: "/projects" },
                { label: "New Project" },
            ]}
            title="Create New Project"
        >
            <div className="max-w-2xl mx-auto">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Project Basic Info */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Details</CardTitle>
                            <CardDescription>
                                Set up your project information and organization
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Project Name */}
                            <div className="space-y-2">
                                <label htmlFor="name" className="text-sm font-medium">
                                    Project Name <span className="text-destructive">*</span>
                                </label>
                                <Input
                                    id="name"
                                    placeholder="e.g., Q1 Product Launch"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-2">
                                <label htmlFor="description" className="text-sm font-medium">
                                    Description
                                </label>
                                <Textarea
                                    id="description"
                                    placeholder="Brief description of the project..."
                                    rows={3}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Optional: Add a brief description to help identify this project
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Project Goals */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Goals & Objectives</CardTitle>
                            <CardDescription>
                                Define what you want to achieve with this project
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="goals" className="text-sm font-medium">
                                    Goals
                                </label>
                                <Textarea
                                    id="goals"
                                    placeholder="List your project goals and objectives..."
                                    rows={4}
                                    value={goals}
                                    onChange={(e) => setGoals(e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Preview */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Preview</CardTitle>
                            <CardDescription>
                                How your project will appear in the projects list
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-lg p-4">
                                <div className="flex items-center gap-3">
                                    <div className="size-12 rounded-lg bg-blue-500 flex items-center justify-center text-white">
                                        <FolderKanban className="size-6" />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-semibold">
                                            {name || "Project Name"}
                                        </h3>
                                        <p className="text-sm text-muted-foreground">
                                            {description || "No description provided"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Actions */}
                    <div className="flex gap-3 justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => navigateTo('/', { replace: true })}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!isFormValid || isSubmitting}
                            className="gap-2"
                        >
                            {isSubmitting ? (
                                <>Creating...</>
                            ) : (
                                <>
                                    <Plus className="size-4" />
                                    Create Project
                                </>
                            )}
                        </Button>
                    </div>
                </form>
            </div>
        </DashboardLayout>
    );
}
