// views/projects.js — Feature 5: Markdown notes rendering added

async function renderProjects(main) {
  const [projects, areas] = await Promise.all([API.listProjects(), API.listAreas()]);
  let selectionMode = false;
  const selectedProjects = new Set();

  main.innerHTML = `
    <div class="view-header">
      <h1>Projects</h1>
      <div class="view-actions">
        <button id="toggle-project-selection">Select projects</button>
        <button class="primary" id="new-project-btn">+ New Project</button>
      </div>
    </div>
    <div class="filter-bar">
      <div class="search-wrap">
        <input type="search" id="search-projects" placeholder="Search projects…" autocomplete="off">
      </div>
      <select id="filter-area">
        <option value="">All areas</option>
        ${areas.map((a) => `<option value="${a.id}">${a.icon || ''} ${escapeHtml(a.title)}</option>`).join('')}
      </select>
      <select id="filter-status">
        <option value="">All statuses</option>
        ${['active', 'paused', 'done', 'dropped'].map((s) => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <button id="clear-filters" class="clear-filters-btn" title="Clear filters">Clear</button>
    </div>
    <div id="projects-count" class="filter-count"></div>
    <div class="selection-toolbar" id="project-selection-toolbar" hidden>
      <label><input type="checkbox" id="select-all-projects"> Select visible</label>
      <span id="selected-project-count">0 selected</span>
      <button type="button" id="pause-selected-projects">Pause selected</button>
      <button type="button" id="delete-selected-projects" class="danger-btn">Delete selected</button>
      <button type="button" id="clear-project-selection">Clear</button>
    </div>
    <div id="projects-grid" class="grid grid-cards"></div>
  `;

  const grid = document.getElementById('projects-grid');
  const countEl = document.getElementById('projects-count');
  const searchInput = document.getElementById('search-projects');
  const areaSelect = document.getElementById('filter-area');
  const statusSelect = document.getElementById('filter-status');
  const clearBtn = document.getElementById('clear-filters');

  function getFilters() {
    return {
      query: searchInput.value.trim().toLowerCase(),
      area: areaSelect.value,
      status: statusSelect.value,
    };
  }

  function matchesSearch(p, query) {
    if (!query) return true;
    return (
      p.title.toLowerCase().includes(query) ||
      (p.description || '').toLowerCase().includes(query) ||
      (p.area_title || '').toLowerCase().includes(query) ||
      p.tags.some((t) => t.toLowerCase().includes(query))
    );
  }

  function draw() {
    const { query, area, status } = getFilters();
    const hasFilters = query || area || status;
    clearBtn.style.display = hasFilters ? 'inline-flex' : 'none';

    const filtered = projects.filter((p) =>
      (!area || p.area_id === area) &&
      (!status || p.status === status) &&
      matchesSearch(p, query)
    );

    countEl.textContent = hasFilters
      ? `${filtered.length} of ${projects.length} project${projects.length !== 1 ? 's' : ''}`
      : '';

    if (!filtered.length) {
      grid.innerHTML = hasFilters
        ? `<div class="empty-state">No projects match your search.</div>`
        : `<div class="empty-state">No projects yet. A project is anything with a finish line — "MemSnap", "CTF Training". Add one under an area.</div>`;
    } else {
      grid.innerHTML = filtered.map((p) => projectCard(p, query, selectionMode, selectedProjects.has(p.id))).join('');
      grid.querySelectorAll('.project-card').forEach((el) => {
        el.addEventListener('click', (event) => {
          if (event.target.closest('.project-select')) return;
          if (!selectionMode) openProjectDetail(projects.find((p) => p.id === el.dataset.projectId), areas);
        });
      });
      grid.querySelectorAll('.project-select').forEach((checkbox) => {
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedProjects.add(checkbox.dataset.projectId);
          else selectedProjects.delete(checkbox.dataset.projectId);
          updateSelection(filtered);
        });
      });
    }
    updateSelection(filtered);
  }

  function updateSelection(filtered) {
    document.getElementById('selected-project-count').textContent = `${selectedProjects.size} selected`;
    const all = document.getElementById('select-all-projects');
    const visible = filtered.map((p) => p.id);
    all.checked = visible.length > 0 && visible.every((id) => selectedProjects.has(id));
    all.indeterminate = visible.some((id) => selectedProjects.has(id)) && !all.checked;
  }

  draw();

  // Auto-open from calendar deep-link
  if (window._pendingDetailOpen?.type === 'project') {
    const { id } = window._pendingDetailOpen;
    window._pendingDetailOpen = null;
    const p = projects.find((p) => p.id === id);
    if (p) openProjectDetail(p, areas);
  }

  searchInput.addEventListener('input', draw);
  areaSelect.addEventListener('change', draw);
  statusSelect.addEventListener('change', draw);
  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    areaSelect.value = '';
    statusSelect.value = '';
    draw();
  });
  document.getElementById('new-project-btn').addEventListener('click', () => openProjectModal(null, areas));
  document.getElementById('toggle-project-selection').addEventListener('click', (event) => {
    selectionMode = !selectionMode;
    if (!selectionMode) selectedProjects.clear();
    event.currentTarget.textContent = selectionMode ? 'Exit selection' : 'Select projects';
    document.getElementById('project-selection-toolbar').hidden = !selectionMode;
    draw();
  });
  document.getElementById('select-all-projects').addEventListener('change', (event) => {
    const { query, area, status } = getFilters();
    const visible = projects.filter((p) => (!area || p.area_id === area) && (!status || p.status === status) && matchesSearch(p, query));
    if (event.target.checked) visible.forEach((p) => selectedProjects.add(p.id));
    else visible.forEach((p) => selectedProjects.delete(p.id));
    draw();
  });
  document.getElementById('clear-project-selection').addEventListener('click', () => { selectedProjects.clear(); draw(); });
  document.getElementById('pause-selected-projects').addEventListener('click', () => runProjectBulkAction('pause'));
  document.getElementById('delete-selected-projects').addEventListener('click', () => runProjectBulkAction('delete'));

  async function runProjectBulkAction(action) {
    const ids = [...selectedProjects];
    if (!ids.length) return appAlert('Select at least one project first.');
    const accepted = await appConfirm(
      action === 'delete'
        ? `Delete ${ids.length} selected project${ids.length === 1 ? '' : 's'}? Projects with tasks or progress history will be kept and reported as an error; associated records will not be cascade-deleted.`
        : `Pause ${ids.length} selected project${ids.length === 1 ? '' : 's'}?`,
      { title: action === 'delete' ? 'Delete projects' : 'Pause projects', confirmText: action === 'delete' ? 'Delete' : 'Pause', danger: action === 'delete' },
    );
    if (!accepted) return;
    try {
      const result = await API.bulkProjects({ ids, action });
      selectedProjects.clear();
      if (result.affected !== ids.length) await appAlert(`Only ${result.affected} project(s) were updated.`, { title: 'Partial result' });
      draw();
    } catch (error) {
      appAlert(error.message, { title: 'Project action failed' });
    }
  }
}

function highlightText(text, query) {
  if (!query || !text) return escapeHtml(text || '');
  return escapeHtml(text).replace(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
    '<mark>$1</mark>'
  );
}

function projectCard(p, query, selectionMode = false, selected = false) {
  const overdue = p.target_date && daysUntil(p.target_date) < 0 && p.status !== 'done';
  return `
    <div class="card project-card dream-stripe" style="border-left-color:${p.area_color || 'var(--border)'}" data-project-id="${p.id}">
      ${selectionMode ? `<label class="project-select-control"><input type="checkbox" class="project-select" data-project-id="${p.id}" aria-label="Select ${escapeHtml(p.title)}" ${selected ? 'checked' : ''}></label>` : ''}
      <div class="pc-head">
        <span class="pc-title">${highlightText(p.title, query)}</span>
        <span class="badge status-${p.status}">${p.status}</span>
      </div>
      <div class="pc-tags">${p.tags.map((t) => highlightText(t, query)).join(' · ')}</div>
      <div class="pc-progress-row">
        <div class="progress-bar"><div style="width:${(p.progress * 100).toFixed(0)}%"></div></div>
        <span class="pc-progress-pct mono">${(p.progress * 100).toFixed(0)}%</span>
      </div>
      <div class="muted mono" style="font-size:11px;">${p.tasks_done}/${p.tasks_total} tasks done</div>
      <div class="pc-meta">
        <span>${p.area_title ? highlightText(p.area_title, query) + ' · ' : ''}Due: ${fmtDate(p.target_date)}</span>
        ${overdue ? `<span style="color:var(--danger);">Overdue</span>` : ''}
      </div>
    </div>
  `;
}

async function openProjectDetail(project, areas) {
  const overlay = document.getElementById('detail-overlay');
  const panel = document.getElementById('detail-panel');
  overlay.classList.add('open');
  panel.classList.add('open');
  panel.innerHTML = `<div class="empty-state">Loading…</div>`;

  const [tasks, sparkline] = await Promise.all([API.listTasks(), API.projectSparkline(project.id)]);
  const projectTasks = tasks.filter((t) => t.project_id === project.id);
  const area = areas.find((a) => a.id === project.area_id);

  function renderNotesSection(editMode) {
    if (editMode) {
      return `
        <div id="notes-section">
          <textarea id="notes-field" rows="8" style="width:100%;">${escapeHtml(project.notes || '')}</textarea>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button id="save-notes" class="primary">Save</button>
            <button id="cancel-notes">Cancel</button>
          </div>
        </div>
      `;
    }
    return `
      <div id="notes-section">
        ${project.notes
          ? `<div class="markdown-body">${renderMd(project.notes)}</div>`
          : `<div class="muted" style="font-size:12px;">No notes yet.</div>`}
        <button id="edit-notes-btn" style="margin-top:8px; font-size:11px;">Edit notes</button>
      </div>
    `;
  }

  panel.innerHTML = `
    <button class="close-btn" id="close-detail" aria-label="Close details">Close</button>
    <h1>${escapeHtml(project.title)}</h1>
    <div class="badge status-${project.status}" style="margin-bottom:12px;">${project.status}</div>
    <p class="muted" style="font-size:13px; white-space:pre-wrap;">${escapeHtml(project.description || 'No description yet.')}</p>

    <div class="field">
      <label>Area</label>
      <div style="font-size:13px;">${area ? `${area.icon || ''} ${escapeHtml(area.title)}` : '<span class="muted">Unassigned</span>'}</div>
    </div>

    <div class="progress-bar" style="margin:10px 0;"><div style="width:${(project.progress * 100).toFixed(0)}%"></div></div>
    <div class="muted mono" style="font-size:11px;">${project.tasks_done}/${project.tasks_total} tasks · ${(project.progress * 100).toFixed(0)}%</div>

    ${sparkline.length > 1 ? `<h2 style="margin-top:20px;">Progress — last 30 days</h2><svg id="detail-sparkline" class="sparkline" width="200" height="36"></svg>` : ''}

    <h2 style="margin-top:20px;">Tasks (${projectTasks.length})</h2>
    <div id="detail-tasks">
      ${projectTasks.length ? projectTasks.map((t) => `
        <div class="list-row">
          <span>${escapeHtml(t.title)} <span class="badge priority-${t.priority}" style="margin-left:4px;">${t.priority}</span></span>
          <span class="badge status-${t.status}">${t.status}</span>
        </div>
      `).join('') : `<div class="muted" style="font-size:12px;">No tasks yet.</div>`}
    </div>

    <h2 style="margin-top:20px;">Notes</h2>
    ${renderNotesSection(false)}

    <div style="display:flex; gap:8px; margin-top:24px;">
      <button id="edit-project-btn">Edit project</button>
      <button id="delete-project-btn" class="danger-btn">Delete</button>
    </div>
  `;

  if (sparkline.length > 1) renderSparkline('detail-sparkline', sparkline);

  function wireNotes(editMode) {
    if (!editMode) {
      document.getElementById('edit-notes-btn').addEventListener('click', () => {
        document.getElementById('notes-section').outerHTML = renderNotesSection(true);
        wireNotes(true);
      });
    } else {
      document.getElementById('save-notes').addEventListener('click', async () => {
        const notes = document.getElementById('notes-field').value;
        await API.updateProject(project.id, { ...projectToPayload(project), notes });
        project.notes = notes;
        document.getElementById('notes-section').outerHTML = renderNotesSection(false);
        wireNotes(false);
      });
      document.getElementById('cancel-notes').addEventListener('click', () => {
        document.getElementById('notes-section').outerHTML = renderNotesSection(false);
        wireNotes(false);
      });
    }
  }
  wireNotes(false);

  document.getElementById('close-detail').addEventListener('click', closeProjectDetail);
  overlay.onclick = (e) => { if (e.target === overlay) closeProjectDetail(); };
  document.getElementById('edit-project-btn').addEventListener('click', () => {
    closeProjectDetail();
    openProjectModal(project, areas);
  });
  document.getElementById('delete-project-btn').addEventListener('click', async () => {
    const accepted = await appConfirm(
      `Delete "${project.title}"? Tasks and progress snapshots are never cascade-deleted. Move or detach its tasks and export any history first; the server blocks deletion while dependencies remain.`,
      { title: 'Delete project', confirmText: 'Delete', danger: true },
    );
    if (!accepted) return;
    try {
      await API.deleteProject(project.id);
      closeProjectDetail();
      Router.resolve();
    } catch (error) {
      appAlert(error.message, { title: 'Project was not deleted' });
    }
  });
}

function closeProjectDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  document.getElementById('detail-panel').classList.remove('open');
}

function projectToPayload(p) {
  return {
    title: p.title, area_id: p.area_id, description: p.description,
    start_date: p.start_date, target_date: p.target_date, status: p.status,
    tags: p.tags, notes: p.notes,
  };
}

function openProjectModal(project, areas) {
  const isEdit = !!project;
  showModal(`
    <h2>${isEdit ? 'Edit Project' : 'New Project'}</h2>
    <form id="project-form">
      <div class="field"><label>Title</label><input name="title" required value="${project ? escapeHtml(project.title) : ''}" placeholder="MemSnap"></div>
      <div class="field"><label>Area</label>
        <select name="area_id">
          <option value="">— unassigned —</option>
          ${areas.map((a) => `<option value="${a.id}" ${project?.area_id === a.id ? 'selected' : ''}>${a.icon || ''} ${escapeHtml(a.title)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Description</label><textarea name="description" rows="3">${project ? escapeHtml(project.description || '') : ''}</textarea></div>
      <div class="grid grid-2">
        <div class="field"><label>Start date</label><input type="date" name="start_date" value="${project?.start_date || ''}"></div>
        <div class="field"><label>Target date</label><input type="date" name="target_date" value="${project?.target_date || ''}"></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Status</label>
          <select name="status">
            ${['active', 'paused', 'done', 'dropped'].map((s) => `<option value="${s}" ${project?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Tags (comma-separated)</label><input name="tags" value="${project ? escapeHtml(project.tags.join(', ')) : ''}" placeholder="security, portfolio"></div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
        <button type="button" id="cancel-modal">Cancel</button>
        <button type="submit" class="primary">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  document.getElementById('project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const finish = beginFormSubmission(e.currentTarget);
    if (!finish) return;
    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        title: fd.get('title'),
        area_id: fd.get('area_id') || null,
        description: fd.get('description') || null,
        start_date: fd.get('start_date') || null,
        target_date: fd.get('target_date') || null,
        status: fd.get('status'),
        tags: fd.get('tags').split(',').map((t) => t.trim()).filter(Boolean),
        notes: project?.notes || null,
      };
      if (isEdit) await API.updateProject(project.id, payload);
      else await API.createProject(payload);
      closeModal();
      Router.resolve();
    } catch (error) {
      appAlert(error.message, { title: 'Could not save project' });
    } finally {
      finish();
    }
  });
}

Router.register('/projects', renderProjects);
