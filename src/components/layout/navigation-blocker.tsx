"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useRecording } from "@/components/layout/recording-provider";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { setNavigationGuard, navigateTo } from "@/lib/navigation";

/**
 * Global "you have a live recording" navigation guard.
 *
 * Why this exists: the recording toast was disabled because the floating
 * pop-up had too many edge cases (racy state, stuck UI, missed events).
 * Without the toast, the user has no global control surface to stop a
 * recording — they have to navigate to /events/new or similar. To keep
 * the recording from being silently lost when the user clicks a sidebar
 * link or hits the back button mid-recording, this component intercepts
 * every navigation attempt and prompts a confirmation.
 *
 * The guard covers:
 * 1. **Link clicks** (sidebar, breadcrumbs, AppLink) — a document-level
 *    capture-phase click listener that catches any anchor with an
 *    internal href, calls `preventDefault` + `stopImmediatePropagation`
 *    (so the AppLink's bubble-phase onClick doesn't also fire
 *    `navigateTo` underneath us), and shows the dialog.
 * 2. **Programmatic navigation** via `navigateTo` — a module-level
 *    guard registered with `setNavigationGuard` so any code path that
 *    navigates goes through the same check.
 * 3. **Browser back / forward** — a `popstate` listener that re-pushes
 *    the current path to keep the user on the page until they confirm.
 * 4. **Full page unload** (close, refresh, app quit) — a `beforeunload`
 *    handler that asks the browser to confirm.
 *
 * When the user chooses "Stop recording and leave", the provider's
 * `stop()` is awaited (so the audio is flushed to disk) BEFORE the
 * navigation proceeds. The new page then sees the completed recording
 * via the provider's `lastCompleted` field — no audio is lost.
 */
export function NavigationBlocker() {
    const rec = useRecording();
    const pathname = usePathname();
    const isActive = rec.status === "recording" || rec.status === "paused";

    // The href the user is trying to navigate to, or null if no
    // navigation is pending. Set by the click listener and the
    // navigateTo guard; rendered by the Dialog below.
    const [pendingHref, setPendingHref] = React.useState<string | null>(null);

    // The resolver for the current pending navigation. There can only
    // be one pending navigation at a time — if the user clicks two
    // different links in quick succession, the first one is cancelled
    // (resolver called with `false`) and the second one takes over.
    const guardResolveRef = React.useRef<((allowed: boolean) => void) | null>(null);

    // Flag for the popstate loop guard: when we re-issue a back
    // navigation after the user confirms, the resulting popstate would
    // otherwise re-push the current path and re-open the dialog. This
    // flag tells the popstate handler to let the next event through
    // without intercepting.
    const isConfirmingBackRef = React.useRef(false);

    // Stable ref for the provider's stop action — the guard must call
    // the latest version without re-registering on every render.
    const stopRef = React.useRef(rec.stop);
    React.useEffect(() => {
        stopRef.current = rec.stop;
    });

    // Open the dialog for a pending href. Cancels any prior pending
    // navigation (resolver called with `false`) before opening the new
    // one. Returns a promise that resolves to `true` if the user
    // confirms or `false` if they cancel.
    const openDialog = React.useCallback((href: string): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            if (guardResolveRef.current) {
                guardResolveRef.current(false);
                guardResolveRef.current = null;
            }
            guardResolveRef.current = resolve;
            setPendingHref(href);
        });
    }, []);

    // Register the navigateTo guard when a recording is active. The
    // module-level slot is set here (and cleared on unmount) so any
    // code that calls `navigateTo` goes through the same check.
    React.useEffect(() => {
        if (!isActive) {
            setNavigationGuard(null);
            return;
        }
        setNavigationGuard(openDialog);
        return () => {
            setNavigationGuard(null);
        };
    }, [isActive, openDialog]);

    // Document-level click listener: intercept internal-link clicks and
    // route them through the guard. Capture phase so we run BEFORE
    // AppLink's onClick and can stopImmediatePropagation — without
    // that, AppLink would also fire its own `navigateTo(href)` after
    // our preventDefault, double-triggering the navigation.
    React.useEffect(() => {
        if (!isActive) return;
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented) return;
            // Respect modifier keys — if the user is opening in a new
            // tab, let the browser handle it natively.
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            if (e.button !== 0) return; // left click only

            const target = e.target as HTMLElement | null;
            const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return;
            if (anchor.hasAttribute("download")) return;
            const rawHref = anchor.getAttribute("href");
            if (!rawHref) return;
            // External / hash / special — let the browser handle.
            if (/^(https?:|mailto:|tel:|blob:|data:|#)/.test(rawHref)) return;

            // Fully intercept: prevent the browser navigation AND
            // stop AppLink's React onClick from also firing.
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void openDialog(rawHref);
        };
        document.addEventListener("click", onClick, true);
        return () => document.removeEventListener("click", onClick, true);
    }, [isActive, openDialog]);

    // Browser back / forward: popstate fires after the URL changes. We
    // re-push the current pathname to keep the user on the page, then
    // show the dialog. If they confirm, we re-issue the back
    // navigation; the loop-guard flag (`isConfirmingBackRef`) prevents
    // the resulting popstate from re-intercepting.
    React.useEffect(() => {
        if (!isActive) return;
        const onPopState = () => {
            if (isConfirmingBackRef.current) {
                isConfirmingBackRef.current = false;
                return;
            }
            // Re-push the current page so the back navigation is undone.
            window.history.pushState(null, "", pathname ?? "/");
            void openDialog("__popstate__");
        };
        window.addEventListener("popstate", onPopState);
        return () => window.removeEventListener("popstate", onPopState);
    }, [isActive, openDialog, pathname]);

    // beforeunload: full page navigation (close, refresh, app quit).
    // The browser shows its own native confirmation.
    React.useEffect(() => {
        if (!isActive) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            // Modern browsers ignore the returnValue string but still
            // require it to be set.
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [isActive]);

    // User chose "Stop recording and leave": stop the recording, then
    // either resolve the navigateTo guard (programmatic path), do the
    // navigation directly (link-click path), or re-issue the back
    // navigation (popstate path).
    const handleConfirm = React.useCallback(async () => {
        const href = pendingHref;
        const resolve = guardResolveRef.current;
        setPendingHref(null);
        guardResolveRef.current = null;

        try {
            await stopRef.current();
        } catch (err) {
            console.error("[NavigationBlocker] stop failed", err);
        }

        if (resolve) {
            // Programmatic navigateTo path — let the caller proceed.
            resolve(true);
        } else if (href && href !== "__popstate__") {
            // Link-click path — navigateTo's guard wasn't involved, so
            // do the navigation directly. The guard may still be set
            // (isActive is true until the state propagates), so we
            // temporarily clear it for this call.
            setNavigationGuard(null);
            navigateTo(href);
        } else if (href === "__popstate__") {
            isConfirmingBackRef.current = true;
            window.history.back();
        }
    }, [pendingHref]);

    // User chose "Stay": resolve the guard with false (cancel the
    // navigateTo call) and close the dialog. For popstate, the
    // re-pushed path is still in place, so the user stays put without
    // any further action.
    const handleCancel = React.useCallback(() => {
        const resolve = guardResolveRef.current;
        setPendingHref(null);
        guardResolveRef.current = null;
        if (resolve) resolve(false);
    }, []);

    if (!isActive) return null;

    return (
        <Dialog open={pendingHref !== null} onOpenChange={(open) => { if (!open) handleCancel(); }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Cancel recording?</DialogTitle>
                    <DialogDescription>
                        {getDestinationDescription(pendingHref)}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        Keep Recording
                    </Button>
                    <Button variant="destructive" onClick={handleConfirm}>
                        Cancel Recording
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Map a raw pending-href (or the popstate sentinel) to a user-facing
 * description for the "Cancel recording?" dialog. The wording mirrors
 * the existing in-page discard dialog at /events/new — "Going to
 * {destination} will stop and discard your current recording." — so
 * the two modals feel like the same control.
 */
function getDestinationDescription(href: string | null): string {
    if (!href || href === "__popstate__") {
        return "Leaving this page will stop and discard your current recording.";
    }
    // Extract just the path portion (drop query string + hash).
    const path = href.split(/[?#]/)[0] || href;
    const friendly = friendlyPath(path);
    return `Going to ${friendly} will stop and discard your current recording.`;
}

const PATH_LABELS: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/projects": "Projects",
    "/events": "Events",
    "/events/new": "Create Event",
    "/events/detail": "Event Details",
    "/notes": "Notes",
    "/settings": "Settings",
    "/meetings": "Meetings",
    "/meetings/new": "New Meeting",
};

function friendlyPath(path: string): string {
    // Exact match wins.
    if (PATH_LABELS[path]) return PATH_LABELS[path];
    // Match a base path: /events/abc-123 → "Event Details", /projects/abc → "Project Details"
    const segs = path.split("/").filter(Boolean);
    if (segs.length >= 2) {
        const base = `/${segs[0]}/${segs[1]}`;
        if (PATH_LABELS[base]) return PATH_LABELS[base];
        const root = `/${segs[0]}`;
        if (PATH_LABELS[root]) return PATH_LABELS[root];
    }
    // Fallback: a humanized version of the path so the description
    // never reads as a raw URL.
    return "another page";
}
