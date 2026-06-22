import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
    icon?: React.ComponentType<{ className?: string }>;
    title: string;
    description?: string;
    action?: { label: string; onClick: () => void };
    className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div className={cn("flex flex-col items-center justify-center text-center p-12 rounded-xl border border-dashed border-border/60 bg-muted/20", className)}>
            {Icon && (
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                    <Icon className="size-6 text-muted-foreground" />
                </div>
            )}
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
            {action && (
                <Button onClick={action.onClick} className="mt-4" size="sm">{action.label}</Button>
            )}
        </div>
    );
}
