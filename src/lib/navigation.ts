/**
 * Internal navigation utilities for Tauri static export builds.
 *
 * Next.js Link / router.push / router.replace do not work reliably inside
 * the Tauri WebView because the static export serves files from the filesystem
 * and Next.js client-side routing intercepts clicks without completing the
 * navigation. This module provides browser-native navigation that always works.
 */

/**
 * Determine whether a URL is internal (app pages) vs external.
 * External URLs are passed through without modification.
 */
function isInternalHref(href: string): boolean {
  // Skip external protocols and special URLs
  if (/^(https?:|mailto:|tel:|blob:|data:)/.test(href)) return false;
  // Hash-only links (e.g. "#section") are not navigation
  if (href.startsWith("#")) return false;
  // Absolute paths starting with / are internal
  if (href.startsWith("/")) return true;
  // Relative paths are internal
  return true;
}

/**
 * Normalize an internal href to work with Tauri static export.
 *
 * Next.js static export requires trailing slashes for clean URLs:
 *   /events/new     -> /events/new/
 *   /projects       -> /projects/
 *   /events/new?mode=record -> /events/new/?mode=record
 *   /events/new#top -> /events/new/#top
 *
 * Hash fragments and query strings are preserved.
 * External URLs (https:, mailto:, tel:, blob:, data:) are returned unchanged.
 */
export function normalizeInternalHref(href: string): string {
  // Pass through external protocols and hash-only links unchanged
  if (/^(https?:|mailto:|tel:|blob:|data:)/.test(href)) return href;
  if (href.startsWith("#")) return href;

  // Split on the first ? or # only (not all of them)
  const match = href.match(/^([^?#]+)([?#].*)?$/);
  if (!match) return href;
  const [, pathPart, queryOrHash] = match;
  const normalizedPath = pathPart.endsWith("/") ? pathPart : `${pathPart}/`;
  return queryOrHash ? `${normalizedPath}${queryOrHash}` : normalizedPath;
}

/**
 * Module-level navigation guard. The `<NavigationBlocker />` component
 * registers a guard when a recording is active; the guard resolves
 * `true` to allow the navigation, `false` to block it. Returns a
 * promise so callers can `await` the user's decision.
 *
 * Why module-level: `navigateTo` is a free function (not a hook) and is
 * called from many places — toast success handlers, link click handlers,
 * programmatic flows. Pushing the guard through a React context would
 * require refactoring every call site. The module-level slot is set by
 * exactly one component (the layout's `<NavigationBlocker />`) and
 * cleared on unmount / when the recording ends.
 */
type NavigationGuard = (href: string) => Promise<boolean>;
let activeGuard: NavigationGuard | null = null;

export function setNavigationGuard(fn: NavigationGuard | null): void {
  activeGuard = fn;
}

/**
 * Navigate to an internal page using native browser navigation.
 * External URLs and special links are passed through as-is.
 *
 * If a navigation guard is registered (typically because a recording is
 * active), the guard is awaited first. A `false` return aborts the
 * navigation — the user has chosen to stay.
 */
export async function navigateTo(href: string, options?: { replace?: boolean }): Promise<void> {
  if (activeGuard && isInternalHref(href)) {
    const allowed = await activeGuard(href);
    if (!allowed) return;
  }

  if (!isInternalHref(href)) {
    // External or special URLs: let the browser handle them naturally
    if (options?.replace) {
      window.location.replace(href);
    } else {
      window.location.href = href;
    }
    return;
  }

  const normalized = normalizeInternalHref(href);

  if (options?.replace) {
    window.location.replace(normalized);
  } else {
    window.location.href = normalized;
  }
}

/**
 * Force a page reload — useful after data mutations in the static build.
 */
export function reloadPage(): void {
  window.location.reload();
}