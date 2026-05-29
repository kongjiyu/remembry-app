"use client";

import * as React from "react";
import { AppLink } from "@/components/ui/app-link";
import { usePathname } from "next/navigation";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar";
import {
    LayoutDashboard,
    Mic,
    Settings,
    FolderKanban,
} from "lucide-react";

const navItems = [
    {
        title: "Dashboard",
        url: "/dashboard",
        icon: LayoutDashboard,
    },
    {
        title: "Projects",
        url: "/projects",
        icon: FolderKanban,
    },
    {
        title: "Events",
        url: "/events",
        icon: Mic,
    },
];

const settingsItems = [
    {
        title: "Settings",
        url: "/settings",
        icon: Settings,
    },
];

export function AppSidebar() {
    const pathname = usePathname();

    return (
        <Sidebar collapsible="icon" variant="floating" className="z-50">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild className="group-data-[collapsible=icon]:p-0">
                            <AppLink href="/dashboard" className="flex items-center gap-3">
                                <img
                                    src="/remembry-logo.png"
                                    alt="Remembry"
                                    className="size-8 shrink-0 rounded-xl object-contain"
                                />
                                <div className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
                                    <span className="font-semibold text-lg tracking-tight">Remembry</span>
                                    <span className="text-xs text-muted-foreground">AI Event Notes</span>
                                </div>
                            </AppLink>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Main</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {navItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        asChild
                                        isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                                        tooltip={item.title}
                                        className="rounded-lg transition-all duration-200"
                                    >
                                        <AppLink href={item.url}>
                                            <item.icon className="size-4" />
                                            <span>{item.title}</span>
                                        </AppLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <SidebarGroupLabel>Settings</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {settingsItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton
                                        asChild
                                        isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                                        tooltip={item.title}
                                        className="rounded-lg transition-all duration-200"
                                    >
                                        <AppLink href={item.url}>
                                            <item.icon className="size-4" />
                                            <span>{item.title}</span>
                                        </AppLink>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarRail />
        </Sidebar>
    );
}
