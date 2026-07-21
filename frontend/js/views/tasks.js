// views/tasks.js — spec section 5.5, Kanban with drag-and-drop

const KANBAN_COLS = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

let _taskFilters = { project: '', priority: '', query: '', due: '' };

async function renderTasks(main) {
  const [tasks, projects] = await Promise.all([API.listTasks(), API.listProjects()]);

  main.innerHTML = `
    <div class="view-header">
      <h1>Tasks</h1>
      <button class="primary" id="new-task-btn">+ New Task</button>
    </div>
    <div class="filter-bar">
      <div class="search-wrap">
        <input type="search" id="search-tasks" placeholder="Search tasks…" autocomplete="off" value="${escapeHtml(_taskFilters.query)}">
      </div>
      <select id="filter-project">
        <option value="">All projects</option>
        ${projects.map((p) => `<option value="${p.id}" ${_taskFilters.project === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
      </select>
      <select id="filter-priority">
        <option value="">All priorities</option>
        ${['low', 'medium', 'high', 'critical'].map((p) => `<option value="${p}" ${_taskFilters.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <select id="filter-due">
        <option value="">Any due date</option>
        <option value="overdue" ${_taskFilters.due === 'overdue' ? 'selected' : ''}>Overdue</option>
        <option value="today" ${_taskFilters.due === 'today' ? 'selected' : ''}>Due today</option>
        <option value="week" ${_taskFilters.due === 'week' ? 'selected' : ''}>Due this week</option>
        <option value="none" ${_taskFilters.due === 'none' ? 'selected' : ''}>No due date</option>
      </select>
      <button id="clear-task-filters" class="clear-filters-btn" title="Clear filters">✕ Clear</button>
    </div>
    <div id="tasks-count" class="filter-count"></div>
    <div class="kanban" id="kanban-board"></div>
  `;

  const countEl = document.getElementById('tasks-count');

  function matchesDue(t) {
    const due = _taskFilters.due;
    if (!due) return true;
    if (due === 'none') return !t.due_date;
    if (!t.due_date) return false;
    const d = daysUntil(t.due_date);
    if (due === 'overdue') return d < 0 && t.status !== 'done';
    if (due === 'today') return d === 0;
    if (due === 'week') return d >= 0 && d <= 7;
    return true;
  }

  function applyFilters(all) {
    const q = _taskFilters.query.trim().toLowerCase();
    return all.filter((t) =>
      (!_taskFilters.project || t.project_id === _taskFilters.project) &&
      (!_taskFilters.priority || t.priority === _taskFilters.priority) &&
      matchesDue(t) &&
      (!q || t.title.toLowerCase().includes(q) ||
           (t.project_title || '').toLowerCase().includes(q) ||
           (t.notes || '').toLowerCase().includes(q))
    );
  }

  function updateClearBtn() {
    const hasFilters = _taskFilters.project || _taskFilters.priority || _taskFilters.due || _taskFilters.query;
    document.getElementById('clear-task-filters').style.display = hasFilters ? 'inline-flex' : 'none';
  }

  function drawBoard() {
    const filtered = applyFilters(tasks);
    const q = _taskFilters.query.trim().toLowerCase();
    const hasFilters = _taskFilters.project || _taskFilters.priority || _taskFilters.due || _taskFilters.query;

    countEl.textContent = hasFilters
      ? `${filtered.length} of ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`
      : '';

    const board = document.getElementById('kanban-board');
    board.innerHTML = KANBAN_COLS.map((col) => {
      const colTasks = filtered.filter((t) => t.status === col.key);
      return `
        <div class="kanban-col" data-status="${col.key}">
          <div class="kanban-col-title"><span>${col.label}</span><span>${colTasks.length}</span></div>
          <div class="kanban-tasks">
            ${colTasks.map((t) => `
              <div class="task-card" draggable="true" data-task-id="${t.id}" style="border-left-color:${t.area_color || 'var(--border)'}">
                <div class="tc-title">${highlightTaskText(t.title, q)}</div>
                <div class="tc-meta">
                  <span>${highlightTaskText(t.project_title || '', q)}</span>
                  <span class="badge priority-${t.priority}">${t.priority}</span>
                </div>
                ${t.due_date ? `<div class="muted mono" style="font-size:10px; margin-top:4px;">${fmtDate(t.due_date)}${daysUntil(t.due_date) < 0 && t.status !== 'done' ? ' <span style="color:var(--danger);">overdue</span>' : ''}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    wireKanbanDnD(board, tasks);
    board.querySelectorAll('.task-card').forEach((el) => {
      el.addEventListener('click', () => openTaskModal(tasks.find((t) => t.id === el.dataset.taskId), projects));
    });

    updateClearBtn();
  }

  drawBoard();

  // Auto-open from calendar deep-link
  if (window._pendingDetailOpen?.type === 'task') {
    const { id } = window._pendingDetailOpen;
    window._pendingDetailOpen = null;
    const t = tasks.find((t) => t.id === id);
    if (t) openTaskModal(t, projects);
  }

  document.getElementById('search-tasks').addEventListener('input', (e) => {
    _taskFilters.query = e.target.value;
    drawBoard();
  });
  document.getElementById('filter-project').addEventListener('change', (e) => {
    _taskFilters.project = e.target.value;
    drawBoard();
  });
  document.getElementById('filter-priority').addEventListener('change', (e) => {
    _taskFilters.priority = e.target.value;
    drawBoard();
  });
  document.getElementById('filter-due').addEventListener('change', (e) => {
    _taskFilters.due = e.target.value;
    drawBoard();
  });
  document.getElementById('clear-task-filters').addEventListener('click', () => {
    _taskFilters = { project: '', priority: '', query: '', due: '' };
    document.getElementById('search-tasks').value = '';
    document.getElementById('filter-project').value = '';
    document.getElementById('filter-priority').value = '';
    document.getElementById('filter-due').value = '';
    drawBoard();
  });
  document.getElementById('new-task-btn').addEventListener('click', () => openTaskModal(null, projects));
}

function highlightTaskText(text, query) {
  if (!query || !text) return escapeHtml(text || '');
  return escapeHtml(text).replace(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
    '<mark>$1</mark>'
  );
}

function wireKanbanDnD(board, tasks) {
  let draggedId = null;
  board.querySelectorAll('.task-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      draggedId = card.dataset.taskId;
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  board.querySelectorAll('.kanban-col').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!draggedId) return;
      const newStatus = col.dataset.status;
      await API.updateTask(draggedId, { status: newStatus });
      Router.resolve();
    });
  });
}

function openTaskModal(task, projects) {
  const isEdit = !!task;
  showModal(`
    <h2>${isEdit ? 'Edit Task' : 'New Task'}</h2>
    <form id="task-form">
      <div class="field"><label>Title</label><input name="title" required value="${task ? escapeHtml(task.title) : ''}" placeholder="Write MemSnap README"></div>
      <div class="field"><label>Project</label>
        <select name="project_id" required>
          ${projects.map((p) => `<option value="${p.id}" ${task?.project_id === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-3">
        <div class="field"><label>Status</label>
          <select name="status">
            ${KANBAN_COLS.map((c) => `<option value="${c.key}" ${task?.status === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Priority</label>
          <select name="priority">
            ${['low', 'medium', 'high', 'critical'].map((p) => `<option value="${p}" ${task?.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Effort (hrs)</label><input type="number" min="0" name="effort" value="${task ? task.effort : 1}"></div>
      </div>
      <div class="field"><label>Due date</label><input type="date" name="due_date" value="${task?.due_date || ''}"></div>
      <div class="field"><label>Notes</label><textarea name="notes" rows="3">${task ? escapeHtml(task.notes) : ''}</textarea></div>
      <div style="display:flex; justify-content:space-between; margin-top:16px;">
        <div>${isEdit ? `<button type="button" id="delete-task" class="danger-btn">Delete</button>` : '<span></span>'}</div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="cancel-modal">Cancel</button>
          <button type="submit" class="primary">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  if (isEdit) {
    document.getElementById('delete-task').addEventListener('click', async () => {
      await API.deleteTask(task.id);
      closeModal();
      Router.resolve();
    });
  }
  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      title: fd.get('title'), project_id: fd.get('project_id'),
      status: fd.get('status') || 'todo', priority: fd.get('priority') || 'medium',
      due_date: fd.get('due_date') || null,
      effort: parseInt(fd.get('effort')) || 1, notes: fd.get('notes'),
    };
    if (isEdit) await API.updateTask(task.id, payload);
    else await API.createTask(payload);
    closeModal();
    Router.resolve();
  });
}

Router.register('/tasks', renderTasks);
