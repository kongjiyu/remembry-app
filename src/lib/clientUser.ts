export const REMEMBRY_USER_ID_STORAGE_KEY = "remembry_user_id";
export const REMEMBRY_USER_ID_HEADER = "x-remembry-user-id";
export const REMEMBRY_DISPLAY_NAME_STORAGE_KEY = "remembry_display_name";
export const REMEMBRY_DISPLAY_NAME_PROMPTED_KEY = "remembry_display_name_prompted";

function generateUserId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }

    return `user_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function getOrCreateRemembryUserId(): string {
    if (typeof window === "undefined") {
        return "";
    }

    const existing = localStorage.getItem(REMEMBRY_USER_ID_STORAGE_KEY);
    if (existing) {
        return existing;
    }

    const created = generateUserId();
    localStorage.setItem(REMEMBRY_USER_ID_STORAGE_KEY, created);
    return created;
}

/**
 * Returns the user's preferred display name, or empty string if not set.
 * Display name is purely cosmetic — never used as an identifier. Safe to
 * leave unset; callers must fall back to a generic greeting.
 */
export function getDisplayName(): string {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(REMEMBRY_DISPLAY_NAME_STORAGE_KEY) || "";
}

export function setDisplayName(name: string): void {
    if (typeof window === "undefined") return;
    const trimmed = name.trim();
    if (trimmed) {
        localStorage.setItem(REMEMBRY_DISPLAY_NAME_STORAGE_KEY, trimmed);
    } else {
        localStorage.removeItem(REMEMBRY_DISPLAY_NAME_STORAGE_KEY);
    }
}

/**
 * Returns true if we've already prompted the user for a display name this
 * device, so we don't nag them every page load. Separate flag from the name
 * itself so clearing the name doesn't re-prompt — only the user clearing
 * localStorage or first-time install triggers a prompt.
 */
export function hasPromptedForDisplayName(): boolean {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(REMEMBRY_DISPLAY_NAME_PROMPTED_KEY) === "1";
}

export function markDisplayNamePrompted(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(REMEMBRY_DISPLAY_NAME_PROMPTED_KEY, "1");
}

export function buildUserHeaders(baseHeaders?: HeadersInit): HeadersInit {
    const headers = new Headers(baseHeaders || {});
    const userId = getOrCreateRemembryUserId();

    if (userId) {
        headers.set(REMEMBRY_USER_ID_HEADER, userId);
    }

    return headers;
}
