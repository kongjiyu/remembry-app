/**
 * Normalizes meeting data between Tauri (SQLite) and legacy API shapes.
 *
 * Tauri shape:
 *   { id, title, project_id, created_at, mime_type?, file_type? }
 *
 * Legacy shape (from older API):
 *   { id, name, displayName, projectName, projectDisplayName, uploadTime, mimeType }
 */

export interface NormalizedMeeting {
    // Core identity (used for keys and links)
    id: string;
    name: string;

    // Display info
    displayName: string;
    title: string;

    // Project info
    project_id: string;
    projectName: string;
    projectDisplayName: string;

    // Timestamps
    created_at: string;
    uploadTime: string;

    // File metadata
    mimeType: string;
    file_type: string;

    // Transcription (optional)
    transcription?: { text: string; language?: string };
    notes_by_language?: Record<string, unknown>;
    default_language?: string;
    available_languages?: string[];
}

/**
 * Normalizes a raw meeting object from either Tauri (SQLite) or legacy API.
 */
export function normalizeMeeting(
    raw: Record<string, unknown> | NormalizedMeeting,
    projectMap?: Map<string, string>
): NormalizedMeeting {
    // Detect Tauri mode: raw has `title` but not `displayName`
    const isTauriMode = Boolean((raw as Record<string, unknown>).title) && !raw.displayName;

    if (isTauriMode) {
        const r = raw as Record<string, unknown>;
        const projectId = String(r.project_id || '');
        return {
            id: String(r.id || ''),
            name: String(r.id || ''),
            displayName: String(r.title || 'Untitled Meeting'),
            title: String(r.title || 'Untitled Meeting'),
            project_id: projectId,
            projectName: projectId,
            projectDisplayName: projectMap?.get(projectId) || projectId,
            created_at: String(r.created_at || ''),
            uploadTime: String(r.created_at || ''),
            mimeType: String(r.mime_type || r.file_type || ''),
            file_type: String(r.file_type || ''),
            transcription: r.transcription as NormalizedMeeting['transcription'],
            notes_by_language: r.notes_by_language as NormalizedMeeting['notes_by_language'],
            default_language: r.default_language as NormalizedMeeting['default_language'],
            available_languages: r.available_languages as NormalizedMeeting['available_languages'],
        };
    }

    // Legacy API mode
    const r = raw as Record<string, unknown>;
    return {
        id: String(r.id || r.name || ''),
        name: String(r.name || r.id || ''),
        displayName: String(r.displayName || r.title || 'Untitled Meeting'),
        title: String(r.title || r.displayName || 'Untitled Meeting'),
        project_id: String(r.project_id || r.projectName || ''),
        projectName: String(r.projectName || r.project_id || ''),
        projectDisplayName: String(r.projectDisplayName || ''),
        created_at: String(r.created_at || r.uploadTime || ''),
        uploadTime: String(r.uploadTime || r.created_at || ''),
        mimeType: String(r.mimeType || ''),
        file_type: String(r.file_type || ''),
        transcription: r.transcription as NormalizedMeeting['transcription'],
        notes_by_language: r.notes_by_language as NormalizedMeeting['notes_by_language'],
        default_language: r.default_language as NormalizedMeeting['default_language'],
        available_languages: r.available_languages as NormalizedMeeting['available_languages'],
    };
}

/**
 * Builds a map of project_id -> display_name from a projects array.
 */
export function buildProjectMap(projects: Array<{ id: string; display_name: string }>): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of projects) {
        map.set(p.id, p.display_name);
    }
    return map;
}

/**
 * Maps a MIME media type to a compact badge label.
 *
 * - Strips MIME parameters (e.g. `;codecs=opus`)
 * - Maps common MIME types to human-readable labels
 * - Falls back to the file_type or a generic label
 */
export function formatMimeBadgeLabel(mimeType: string, fileType?: string): string {
    const input = mimeType?.trim();
    if (!input) {
        return fileType?.toUpperCase() || 'FILE';
    }

    // Strip MIME parameters (e.g. "audio/webm;codecs=opus" → "audio/webm")
    const base = input.split(';')[0];
    const subtype = base.split('/')[1]?.toUpperCase() || '';

    const mimeMap: Record<string, string> = {
        'WEBM': 'WEBM',
        'MP4': 'MP4',
        'MPEG': 'MP3',
        'MP3': 'MP3',
        'WAV': 'WAV',
        'X-WAV': 'WAV',
        'OGG': 'OGG',
        'FLAC': 'FLAC',
        'PLAINTEXT': 'TXT',
        'PLAIN': 'TXT',
        'X-M4A': 'M4A',
        'M4A': 'M4A',
        'MP4A-LATM': 'M4A',
    };

    if (mimeMap[subtype]) {
        return mimeMap[subtype];
    }

    // Strip common vendor prefix and check fallback (e.g. "X-M4A" → "M4A")
    if (subtype.startsWith('X-')) {
        const stripped = subtype.slice(2);
        if (mimeMap[stripped]) {
            return mimeMap[stripped];
        }
    }

    return fileType?.toUpperCase() || 'FILE';
}

/**
 * Groups meetings by project_id and returns a map of project_id -> count.
 */
export function countMeetingsByProject(meetings: NormalizedMeeting[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const m of meetings) {
        counts.set(m.project_id, (counts.get(m.project_id) || 0) + 1);
    }
    return counts;
}