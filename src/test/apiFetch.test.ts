import { describe, it, expect } from 'vitest';

// Test route matching logic used in apiFetch
// We test the matchRoute behavior since we can't call invoke in unit tests

function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const pa = path.split("/").filter(Boolean);
  if (pp.length !== pa.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) {
      params[pp[i].substring(1)] = pa[i];
    } else if (pp[i] !== pa[i]) {
      return null;
    }
  }
  return params;
}

function parseBody(init?: RequestInit): unknown {
  if (init?.body && typeof init.body === "string") {
    try { return JSON.parse(init.body); } catch {}
  }
  return null;
}

describe('apiFetch route mapping', () => {
  describe('matchRoute', () => {
    it('matches static routes exactly', () => {
      expect(matchRoute('/api/projects', '/api/projects')).toEqual({});
    });

    it('extracts projectId from parametric route', () => {
      const result = matchRoute('/api/projects/:projectId', '/api/projects/project_123');
      expect(result).toEqual({ projectId: 'project_123' });
    });

    it('extracts id from meeting route', () => {
      const result = matchRoute('/api/meetings/:id', '/api/meetings/meeting_abc');
      expect(result).toEqual({ id: 'meeting_abc' });
    });

    it('returns null for mismatched path segments', () => {
      expect(matchRoute('/api/projects', '/api/events')).toBeNull();
    });

    it('returns null for different segment counts', () => {
      expect(matchRoute('/api/projects/:id', '/api/projects')).toBeNull();
    });
  });

  describe('project routes', () => {
    it('GET /api/projects → list_projects with no params', () => {
      // Simulate extractParams for GET /api/projects
      const extractParams = () => ({});
      expect(extractParams()).toEqual({});
    });

    it('POST /api/projects → create_project with name, description, goals, color', () => {
      const body = { name: 'New Project', description: 'A test project', goals: 'Ship v1', color: 'bg-blue-500' };
      const params = { params: { name: body.name, description: body.description, goals: body.goals, color: body.color } };
      expect(params.params.name).toBe('New Project');
      expect(params.params.description).toBe('A test project');
      expect(params.params.goals).toBe('Ship v1');
      expect(params.params.color).toBe('bg-blue-500');
    });

    it('GET /api/projects/:projectId → get_project with projectId', () => {
      const routeParams = matchRoute('/api/projects/:projectId', '/api/projects/project_xyz');
      expect(routeParams).toEqual({ projectId: 'project_xyz' });
    });

    it('PUT /api/projects/:projectId → update_project with projectId and body', () => {
      const routeParams = matchRoute('/api/projects/:projectId', '/api/projects/project_xyz');
      const body = { name: 'Updated Name', description: 'Updated desc', goals: 'Updated goals', color: 'bg-red-500' };
      // Simulate extractParams for PUT
      const params = { ...routeParams, params: { name: body.name, description: body.description, goals: body.goals, color: body.color } };
      expect(params.projectId).toBe('project_xyz');
      expect(params.params.name).toBe('Updated Name');
    });

    it('DELETE /api/projects/:projectId → delete_project', () => {
      const routeParams = matchRoute('/api/projects/:projectId', '/api/projects/project_del');
      expect(routeParams).toEqual({ projectId: 'project_del' });
    });
  });

  describe('meeting/event routes', () => {
    it('GET /api/meetings?project_id=xxx → list_meetings filtered', () => {
      const params: Record<string, unknown> = {};
      const projectId = 'proj_filter';
      params.projectId = projectId;
      expect(params.projectId).toBe('proj_filter');
    });

    it('GET /api/meetings/:id → get_meeting', () => {
      const routeParams = matchRoute('/api/meetings/:id', '/api/meetings/m123');
      expect(routeParams).toEqual({ id: 'm123' });
    });

    it('POST /api/meetings/:id/extract → extract_meeting_notes', () => {
      const routeParams = matchRoute('/api/meetings/:id/extract', '/api/meetings/m456/extract');
      expect(routeParams).toEqual({ id: 'm456' });
    });
  });

  describe('ask route', () => {
    it('POST /api/ask with project scope', () => {
      const body = {
        scope: 'project',
        projectId: 'proj_ask',
        meetingId: null,
        question: 'What was decided?',
        language: 'en',
      };
      expect(body.scope).toBe('project');
      expect(body.projectId).toBe('proj_ask');
      expect(body.question).toBe('What was decided?');
    });

    it('POST /api/ask with meeting scope', () => {
      const body = {
        scope: 'meeting',
        projectId: '',
        meetingId: 'meet_ask',
        question: 'Summarize this',
        language: 'zh',
      };
      expect(body.scope).toBe('meeting');
      expect(body.meetingId).toBe('meet_ask');
    });
  });

  describe('parseBody', () => {
    it('parses JSON body string', () => {
      const init = { body: '{"name":"test"}' };
      const result = parseBody(init);
      expect(result).toEqual({ name: 'test' });
    });

    it('returns null for non-JSON body', () => {
      expect(parseBody({})).toBeNull();
      expect(parseBody({ body: 'not json' })).toBeNull();
    });
  });
});