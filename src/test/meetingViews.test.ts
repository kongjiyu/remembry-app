import { describe, it, expect } from 'vitest';
import { normalizeMeeting, buildProjectMap, formatMimeBadgeLabel, countMeetingsByProject } from '@/lib/meetingViews';

describe('normalizeMeeting', () => {
  describe('Tauri mode (title, no displayName)', () => {
    it('normalizes a basic Tauri meeting', () => {
      const raw = {
        id: 'meeting_123',
        title: 'Weekly Standup',
        project_id: 'project_abc',
        created_at: '2026-05-20T10:00:00Z',
        mime_type: 'audio/mp4',
      };
      const result = normalizeMeeting(raw);
      expect(result.id).toBe('meeting_123');
      expect(result.title).toBe('Weekly Standup');
      expect(result.displayName).toBe('Weekly Standup');
      expect(result.project_id).toBe('project_abc');
      expect(result.projectName).toBe('project_abc');
    });

    it('uses projectMap to resolve projectDisplayName', () => {
      const raw = {
        id: 'meeting_456',
        title: 'Sprint Planning',
        project_id: 'project_xyz',
        created_at: '2026-05-21T09:00:00Z',
      };
      const projectMap = new Map([['project_xyz', 'Engineering']]);
      const result = normalizeMeeting(raw, projectMap);
      expect(result.projectDisplayName).toBe('Engineering');
    });

    it('defaults to project_id when projectMap is missing', () => {
      const raw = { id: 'm1', title: 'Test', project_id: 'proj_1', created_at: '' };
      const result = normalizeMeeting(raw);
      expect(result.projectDisplayName).toBe('proj_1');
    });

    it('handles missing title with fallback', () => {
      const raw = { id: 'm2', project_id: 'proj_2', created_at: '' };
      const result = normalizeMeeting(raw);
      expect(result.displayName).toBe('Untitled Meeting');
      expect(result.title).toBe('Untitled Meeting');
    });

    it('preserves transcription and notes_by_language', () => {
      const raw = {
        id: 'm3',
        title: 'With Data',
        project_id: 'proj_3',
        created_at: '2026-05-22T08:00:00Z',
        transcription: { text: 'Hello world', language: 'en' },
        notes_by_language: { en: { summary: 'Test' } },
        default_language: 'en',
      };
      const result = normalizeMeeting(raw);
      expect(result.transcription).toEqual({ text: 'Hello world', language: 'en' });
      expect(result.notes_by_language).toEqual({ en: { summary: 'Test' } });
      expect(result.default_language).toBe('en');
    });
  });

  describe('Legacy mode (displayName present)', () => {
    it('normalizes a legacy meeting with displayName', () => {
      const raw = {
        id: 'meeting_789',
        name: 'meeting_789',
        displayName: 'Q1 Review',
        title: 'Q1 Review',
        project_id: 'project_aaa',
        projectName: 'project_aaa',
        projectDisplayName: 'Marketing',
        created_at: '2026-05-19T14:00:00Z',
        uploadTime: '2026-05-19T14:00:00Z',
        mimeType: 'audio/webm',
      };
      const result = normalizeMeeting(raw);
      expect(result.id).toBe('meeting_789');
      expect(result.displayName).toBe('Q1 Review');
      expect(result.projectDisplayName).toBe('Marketing');
      expect(result.mimeType).toBe('audio/webm');
    });

    it('falls back title->displayName->default', () => {
      const raw = { id: 'm4', name: 'm4', displayName: 'Legacy Event', project_id: '', created_at: '' };
      const result = normalizeMeeting(raw);
      expect(result.title).toBe('Legacy Event');
    });
  });
});

describe('buildProjectMap', () => {
  it('builds a map from project array', () => {
    const projects = [
      { id: 'p1', display_name: 'Alpha' },
      { id: 'p2', display_name: 'Beta' },
    ];
    const map = buildProjectMap(projects);
    expect(map.get('p1')).toBe('Alpha');
    expect(map.get('p2')).toBe('Beta');
    expect(map.get('p3')).toBeUndefined();
  });

  it('handles empty array', () => {
    const map = buildProjectMap([]);
    expect(map.size).toBe(0);
  });
});

describe('formatMimeBadgeLabel', () => {
  const cases = [
    ['audio/mp4', undefined, 'MP4'],
    ['audio/mp4;codecs=opus', undefined, 'MP4'],
    ['audio/webm', undefined, 'WEBM'],
    ['audio/mpeg', undefined, 'MP3'],
    ['audio/x-wav', undefined, 'WAV'],
    ['audio/ogg', undefined, 'OGG'],
    ['audio/flac', undefined, 'FLAC'],
    ['audio/x-m4a', undefined, 'M4A'],
    ['text/plain', undefined, 'TXT'],
    ['', 'wav', 'WAV'],
    ['', undefined, 'FILE'],
    ['audio/unknown', undefined, 'FILE'],
  ] as const;

  it.each(cases)('formats %s with fileType=%s → %s', (mime, fileType, expected) => {
    expect(formatMimeBadgeLabel(mime, fileType)).toBe(expected);
  });
});

describe('countMeetingsByProject', () => {
  it('counts meetings per project', () => {
    const meetings = [
      { id: 'm1', name: 'm1', displayName: 'm1', title: 'm1', project_id: 'p1', projectName: 'p1', projectDisplayName: 'p1', created_at: '', uploadTime: '', mimeType: '', file_type: '' },
      { id: 'm2', name: 'm2', displayName: 'm2', title: 'm2', project_id: 'p1', projectName: 'p1', projectDisplayName: 'p1', created_at: '', uploadTime: '', mimeType: '', file_type: '' },
      { id: 'm3', name: 'm3', displayName: 'm3', title: 'm3', project_id: 'p2', projectName: 'p2', projectDisplayName: 'p2', created_at: '', uploadTime: '', mimeType: '', file_type: '' },
    ];
    const counts = countMeetingsByProject(meetings);
    expect(counts.get('p1')).toBe(2);
    expect(counts.get('p2')).toBe(1);
  });

  it('handles empty array', () => {
    const counts = countMeetingsByProject([]);
    expect(counts.size).toBe(0);
  });
});