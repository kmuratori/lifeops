// api.js — thin fetch wrappers over the FastAPI backend

const API = {
  async _req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText || '');
      let message = text || res.statusText || `HTTP ${res.status}`;
      try {
        const payload = JSON.parse(text);
        const detail = payload.detail ?? payload.message;
        if (typeof detail === 'string') message = detail;
        else if (detail !== undefined) message = JSON.stringify(detail);
      } catch {}
      throw new Error(`${method} ${path} failed: ${message}`);
    }
    if (res.status === 204) return null;
    return res.json();
  },

  // Dreams
  listDreams: () => API._req('GET', '/api/dreams'),
  createDream: (d) => API._req('POST', '/api/dreams', d),
  updateDream: (id, d) => API._req('PUT', `/api/dreams/${id}`, d),
  deleteDream: (id) => API._req('DELETE', `/api/dreams/${id}`),

  // Areas
  listAreas: () => API._req('GET', '/api/areas'),
  createArea: (a) => API._req('POST', '/api/areas', a),
  updateArea: (id, a) => API._req('PUT', `/api/areas/${id}`, a),
  deleteArea: (id) => API._req('DELETE', `/api/areas/${id}`),

  // Projects
  listProjects: () => API._req('GET', '/api/projects'),
  getProject: (id) => API._req('GET', `/api/projects/${id}`),
  createProject: (p) => API._req('POST', '/api/projects', p),
  updateProject: (id, p) => API._req('PUT', `/api/projects/${id}`, p),
  deleteProject: (id) => API._req('DELETE', `/api/projects/${id}`),
  projectSparkline: (id) => API._req('GET', `/api/projects/${id}/sparkline`),

  // Tasks
  listTasks: () => API._req('GET', '/api/tasks'),
  createTask: (t) => API._req('POST', '/api/tasks', t),
  updateTask: (id, t) => API._req('PUT', `/api/tasks/${id}`, t),
  deleteTask: (id) => API._req('DELETE', `/api/tasks/${id}`),
  quickAdd: (text, selection = null) => API._req('POST', '/api/tasks/quick-add', {
    text,
    ...(selection ? { selection_kind: selection.kind, selection_id: selection.id } : {}),
  }),
  taskSuggestions: (q) => API._req('GET', `/api/tasks/suggestions?q=${encodeURIComponent(q)}`),
  bulkTasks: (payload) => API._req('POST', '/api/tasks/bulk', payload),
  bulkProjects: (payload) => API._req('POST', '/api/projects/bulk', payload),

  // Insights
  dashboard: () => API._req('GET', '/api/insights/dashboard'),
  progressOverTime: () => API._req('GET', '/api/insights/progress-over-time'),
  effortDistribution: () => API._req('GET', '/api/insights/effort-distribution'),
  completionRate: () => API._req('GET', '/api/insights/completion-rate'),
  areaRoi: () => API._req('GET', '/api/insights/area-roi'),
  bottlenecks: () => API._req('GET', '/api/insights/bottlenecks'),
  triggerSnapshot: () => API._req('POST', '/api/insights/snapshot'),

  // Feature 1: Habits
  listHabits: () => API._req('GET', '/api/habits'),
  createHabit: (h) => API._req('POST', '/api/habits', h),
  updateHabit: (id, h) => API._req('PUT', `/api/habits/${id}`, h),
  archiveHabit: (id) => API._req('DELETE', `/api/habits/${id}`),
  // payload: { done, note?, date? }  — date is ISO string, defaults to today server-side
  logHabit: (id, payload) => API._req('POST', `/api/habits/${id}/log`, payload),
  getHabitLogs: (id, from_date, to_date) => {
    const params = new URLSearchParams();
    if (from_date) params.set('from_date', from_date);
    if (to_date) params.set('to_date', to_date);
    return API._req('GET', `/api/habits/${id}/logs?${params}`);
  },

  // Feature 2: Calendar
  getCalendar: (month) => API._req('GET', `/api/calendar?month=${month}`),

  // Feature 3: Weekly Reviews
  listReviews: () => API._req('GET', '/api/reviews'),
  getCurrentReview: () => API._req('GET', '/api/reviews/current'),
  saveReview: (id, payload) => API._req('POST', `/api/reviews/${id}`, payload),
  getReviewStats: (id) => API._req('GET', `/api/reviews/${id}/stats`),

  // Feature 7: Settings / Backup
  getSettings: () => API._req('GET', '/api/settings/stats'),
  downloadBackup: () => fetch('/api/settings/backup').then(async r => {
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename=(.+)/);
    const filename = match ? match[1] : 'lifeops_backup.json';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }),
  downloadCsv: () => fetch('/api/settings/export/csv').then(async r => {
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename=(.+)/);
    const filename = match ? match[1] : 'lifeops_export.zip';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }),
  importBackup: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/settings/import', { method: 'POST', body: fd }).then(r => r.json());
  },
  previewImport: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/settings/import/preview', { method: 'POST', body: fd }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Could not validate this backup');
      return data;
    });
  },
  commitImport: (token, conflictPolicy) => API._req('POST', '/api/settings/import/commit', { token, conflict_policy: conflictPolicy }),
  exportData: (options) => {
    const params = new URLSearchParams(options);
    window.location.assign(`/api/settings/export?${params.toString()}`);
  },
};
