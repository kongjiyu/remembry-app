export const REMEMBRY_USER_ID_STORAGE_KEY = "remembry_user_id";
export const REMEMBRY_USER_ID_HEADER = "x-remembry-user-id";

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

export function buildUserHeaders(baseHeaders?: HeadersInit): HeadersInit {
    const headers = new Headers(baseHeaders || {});
    const userId = getOrCreateRemembryUserId();

    if (userId) {
        headers.set(REMEMBRY_USER_ID_HEADER, userId);
    }

    return headers;
}
