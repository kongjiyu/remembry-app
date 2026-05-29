"use client";

import { useEffect } from "react";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Separator } from "@/components/ui/separator";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { checkForUpdates, subscribeToUpdates } from "@/lib/appUpdater";
import { toast } from "sonner";

interface DashboardLayoutProps {
    children: React.ReactNode;
    breadcrumbs?: Array<{ label: string; href?: string }>;
    title?: string;
}

export function DashboardLayout({ children, breadcrumbs = [], title }: DashboardLayoutProps) {
    useEffect(() => {
        const unsub = subscribeToUpdates((status, info) => {
            if (status === "available" && info) {
                toast.success(`Remembry ${info.version} is available`, {
                    description: "Click to update",
                    action: { label: "Update", onClick: () => import("@/lib/appUpdater").then(m => m.downloadAndInstall()) },
                });
            }
        });
        checkForUpdates();
        return unsub;
    }, []);

    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="bg-background">
                <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 bg-background/80 backdrop-blur-md border-b border-border/40">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="mr-2 h-4" />
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink href="/dashboard" className="hover:text-primary transition-colors">Home</BreadcrumbLink>
                            </BreadcrumbItem>
                            {breadcrumbs.map((crumb, index) => (
                                <span key={`${crumb.label}-${index}`} className="contents">
                                    <BreadcrumbSeparator />
                                    <BreadcrumbItem>
                                        {index === breadcrumbs.length - 1 || !crumb.href ? (
                                            <BreadcrumbPage className="font-medium text-foreground">{crumb.label}</BreadcrumbPage>
                                        ) : (
                                            <BreadcrumbLink href={crumb.href} className="hover:text-primary transition-colors">{crumb.label}</BreadcrumbLink>
                                        )}
                                    </BreadcrumbItem>
                                </span>
                            ))}
                        </BreadcrumbList>
                    </Breadcrumb>
                </header>
                <main className="flex-1 overflow-auto p-6 md:p-8">
                    {title && (
                        <div className="mb-8">
                            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
                        </div>
                    )}
                    <div className="animate-in fade-in-50 slide-in-from-bottom-4 duration-500">
                        {children}
                    </div>
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
}
