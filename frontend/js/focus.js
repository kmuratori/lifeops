// focus.js -- Feature 4: Focus Mode (Today View)

const FocusMode = {
  STORAGE_KEY: 'lifeops-focus-mode',

  active() { return localStorage.getItem(this.STORAGE_KEY) === '1'; },

  enter() {
    localStorage.setItem(this.STORAGE_KEY, '1');
    document.body.classList.add('focus-mode');
    this._renderFocusView();
  },

  exit() {
    localStorage.setItem(this.STORAGE_KEY, '0');
    document.body.classList.remove('focus-mode');
    Router.resolve();
  },

  toggle() { if (this.active()) this.exit(); else this.enter(); },

  init() {
    if (this.active()) {
      document.body.classList.add('focus-mode');
      this._renderFocusView();
    }
  },

  async _renderFocusView() {
    const main = document.getElementById('main-panel');
    main.innerHTML = `<div class="empty-state">Loading...</div>`;

    const [tasks, habits] = await Promise.all([API.listTasks(), API.listHabits()]);

    const focusDate  = new Date();
    const todayStr   = `${focusDate.getFullYear()}-${String(focusDate.getMonth() + 1).padStart(2, '0')}-${String(focusDate.getDate()).padStart(2, '0')}`;
    const hour       = new Date().getHours();
    const greeting   = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const dayOfWeek  = (new Date().getDay() + 6) % 7; // 0=Mon

    const todayHabits = habits.filter((h) => {
      if (h.frequency === 'daily') return true;
      if (h.frequency === 'weekly') return dayOfWeek === 0;
      if (h.frequency === 'custom' && h.target_days) {
        return h.target_days.split(',').map((x) => parseInt(x.trim())).includes(dayOfWeek);
      }
      return false;
    });

    const dueTodayTasks = tasks
      .filter((t) => t.due_date === todayStr && t.status !== 'done')
      .sort((a, b) => {
        const ord = { critical: 0, high: 1, medium: 2, low: 3 };
        return (ord[a.priority] || 2) - (ord[b.priority] || 2);
      });

    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress' && t.due_date !== todayStr);

    const suggested = tasks
      .filter((t) => t.status === 'todo' && t.due_date !== todayStr)
      .sort((a, b) => {
        const ord = { critical: 0, high: 1, medium: 2, low: 3 };
        return (ord[a.priority] || 2) - (ord[b.priority] || 2);
      })[0] || null;

    main.innerHTML = `
      <div class="focus-header">
        <div>
          <div class="focus-greeting">${greeting}</div>
          <div class="muted" style="font-size:12px;">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
        <button id="exit-focus-btn" class="danger-btn" style="font-size:12px;">Exit Focus</button>
      </div>

      ${todayHabits.length ? `
        <div class="focus-section">
          <h2>Habits today</h2>
          ${todayHabits.map((h) => `
            <div class="focus-habit-row">
              <span style="font-size:13px;">${escapeHtml(h.title)}</span>
              <button class="focus-habit-check" data-habit-id="${h.id}" ${h.done_today ? 'disabled' : ''}
                style="font-size:11px; padding:3px 10px;
                  color:${h.done_today ? 'var(--success)' : 'var(--text-muted)'};
                  border-color:${h.done_today ? 'rgba(78,202,139,0.4)' : 'var(--border)'};">
                ${h.done_today ? 'done' : 'mark done'}
              </button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${dueTodayTasks.length ? `
        <div class="focus-section">
          <h2>Due today (${dueTodayTasks.length})</h2>
          ${dueTodayTasks.map((t) => focusTaskRow(t)).join('')}
        </div>
      ` : ''}

      ${inProgressTasks.length ? `
        <div class="focus-section">
          <h2>In progress</h2>
          ${inProgressTasks.map((t) => focusTaskRow(t)).join('')}
        </div>
      ` : ''}

      ${suggested ? `
        <div class="focus-section">
          <h2>Suggested focus</h2>
          <div class="callout">
            <div style="font-family:var(--font-display); font-weight:600; font-size:13px; margin-bottom:4px;">${escapeHtml(suggested.title)}</div>
            <div class="muted" style="font-size:11px;">${escapeHtml(suggested.project_title || '')} -- <span class="badge priority-${suggested.priority}">${suggested.priority}</span></div>
          </div>
        </div>
      ` : ''}

      ${!dueTodayTasks.length && !inProgressTasks.length && !suggested ? `
        <div class="empty-state" style="margin-top:40px;">Nothing urgent today.</div>
      ` : ''}
    `;

    document.getElementById('exit-focus-btn').addEventListener('click', () => FocusMode.exit());
    document.querySelectorAll('.focus-habit-check').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await logWithUndo(
          btn.dataset.habitId,
          { done: true },
          { done: false, value: null },
          'Habit updated',
          () => FocusMode._renderFocusView(),
        );
        FocusMode._renderFocusView();
      });
    });
  },
};

function focusTaskRow(t) {
  return `
    <div class="focus-task-row">
      <span class="badge priority-${t.priority}" style="flex-shrink:0;">${t.priority}</span>
      <span style="flex:1; font-size:13px;">${escapeHtml(t.title)}</span>
      <span class="muted" style="font-size:11px; flex-shrink:0;">${escapeHtml(t.project_title || '')}</span>
    </div>
  `;
}
