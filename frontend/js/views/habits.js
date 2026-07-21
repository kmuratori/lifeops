// views/habits.js -- Feature 1: Habits

async function renderHabits(main) {
  const [habits, areas] = await Promise.all([API.listHabits(), API.listAreas()]);

  main.innerHTML = `
    <div class="view-header">
      <h1>Habits</h1>
      <button class="primary" id="new-habit-btn">+ New Habit</button>
    </div>
    ${!habits.length ? `<div class="empty-state">No habits yet. A habit is a recurring action with no finish line — "meditate", "read", "exercise".</div>` : ''}
    <div id="habits-grid" class="grid grid-cards"></div>
  `;

  const grid = document.getElementById('habits-grid');
  if (habits.length) {
    grid.innerHTML = habits.map((h) => habitCard(h)).join('');

    grid.querySelectorAll('.habit-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.habit-check-btn') ||
            e.target.closest('.habit-log-btn') ||
            e.target.closest('.habit-value-input')) return;
        openHabitDetail(habits.find((h) => h.id === el.dataset.habitId), areas);
      });
    });

    // Yes/No toggle
    grid.querySelectorAll('.habit-check-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id   = btn.dataset.habitId;
        const done = btn.dataset.done === 'false';
        btn.disabled = true;
        await API.logHabit(id, { done });
        renderHabits(main);
      });
    });

    // Measurable "Log" button
    grid.querySelectorAll('.habit-log-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id    = btn.dataset.habitId;
        const input = grid.querySelector(`.habit-value-input[data-habit-id="${id}"]`);
        const val   = parseFloat(input?.value);
        if (!input || isNaN(val)) { input?.focus(); return; }
        btn.disabled = true;
        await API.logHabit(id, { done: true, value: val });
        renderHabits(main);
      });
    });

    // Allow Enter key in measurable input
    grid.querySelectorAll('.habit-value-input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const id  = input.dataset.habitId;
          const btn = grid.querySelector(`.habit-log-btn[data-habit-id="${id}"]`);
          btn?.click();
        }
      });
    });
  }

  // Auto-open from calendar deep-link
  if (window._pendingDetailOpen?.type === 'habit') {
    const { id } = window._pendingDetailOpen;
    window._pendingDetailOpen = null;
    const h = habits.find((h) => h.id === id);
    if (h) openHabitDetail(h, areas);
  }

  document.getElementById('new-habit-btn').addEventListener('click', () => openHabitModal(null, areas));
}

function habitCard(h) {
  const color     = h.color || 'var(--border)';
  const freqLabel = formatFrequency(h);
  const pct       = Math.round(h.completion_rate * 100);
  const measurable = h.habit_type === 'measurable';

  const actionArea = measurable
    ? `<div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
         ${h.value_today != null
           ? `<span style="font-size:11px; color:var(--success); white-space:nowrap;">✓ ${h.value_today}${h.unit ? ' ' + escapeHtml(h.unit) : ''}</span>`
           : ''}
         <input type="number" class="habit-value-input" data-habit-id="${h.id}"
           min="0" step="any" placeholder="${h.unit ? escapeHtml(h.unit) : '…'}"
           style="width:56px; padding:3px 5px; font-size:11px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface-raised); color:var(--text);"
           title="Log today's value">
         <button class="habit-log-btn" data-habit-id="${h.id}"
           style="padding:3px 8px; font-size:11px; border:1px solid var(--border); border-radius:var(--radius); cursor:pointer;">Log</button>
       </div>`
    : `<button class="habit-check-btn ${h.done_today ? 'habit-done' : ''}"
         data-habit-id="${h.id}" data-done="${h.done_today}"
         title="${h.done_today ? 'Done today' : 'Mark done'}"
         style="padding:4px 10px; font-size:11px;
           border-color:${h.done_today ? 'rgba(78,202,139,0.4)' : 'var(--border)'};
           color:${h.done_today ? 'var(--success)' : 'var(--text-muted)'};">
         ${h.done_today ? '✓ done' : 'mark done'}
       </button>`;

  return `
    <div class="card habit-card dream-stripe" style="border-left-color:${color}" data-habit-id="${h.id}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div style="min-width:0; flex:1; margin-right:8px;">
          <div style="font-family:var(--font-display); font-weight:600; font-size:13px; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(h.title)}</div>
          <div class="muted" style="font-size:11px;">${freqLabel}${h.unit ? ' · ' + escapeHtml(h.unit) : ''}${h.area_title ? ' / ' + escapeHtml(h.area_title) : ''}</div>
        </div>
        ${actionArea}
      </div>

      <div style="display:flex; gap:3px; margin-bottom:10px;">
        ${h.last7.map((d) => {
          const todayIso = new Date().toISOString().slice(0,10);
          const bg = !d.scheduled ? 'var(--bg-base)'
            : d.done ? 'var(--success)'
            : d.date < todayIso ? 'rgba(224,92,92,0.3)'
            : 'var(--border)';
          const tip = measurable && d.value != null ? `${d.date}: ${d.value}${h.unit ? ' ' + h.unit : ''}` : d.date;
          return `<div title="${tip}" style="flex:1; height:14px; border-radius:1px; background:${bg};"></div>`;
        }).join('')}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
        <span class="muted">${h.current_streak}${streakUnit(h)} streak</span>
        <span class="muted mono">${pct}% ${rateLabel(h)}</span>
      </div>
    </div>
  `;
}

function streakUnit(h) {
  if (h.frequency === 'x_per_week') return 'wk';
  if (h.frequency === 'x_per_month') return 'mo';
  return 'd';
}

function rateLabel(h) {
  if (h.frequency === 'x_per_week') return 'last 4 wks';
  if (h.frequency === 'x_per_month') return 'last 3 mo';
  return 'last 30d';
}

function formatFrequency(h) {
  if (h.frequency === 'daily') return 'Daily';
  if (h.frequency === 'weekly') return 'Weekly (Mon)';
  if (h.frequency === 'x_per_week') return `≥${h.frequency_count || 1}× per week`;
  if (h.frequency === 'x_per_month') return `≥${h.frequency_count || 1}× per month`;
  if (h.frequency === 'custom' && h.target_days) {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return h.target_days.split(',').map((d) => names[parseInt(d.trim())] || d).join('/');
  }
  return h.frequency;
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

async function openHabitDetail(habit, areas) {
  const overlay = document.getElementById('detail-overlay');
  const panel   = document.getElementById('detail-panel');
  overlay.classList.add('open');
  panel.classList.add('open');
  panel.innerHTML = `<div class="empty-state">Loading...</div>`;

  const today    = new Date();
  const from     = new Date(today); from.setDate(today.getDate() - 83);
  const logs     = await API.getHabitLogs(habit.id, from.toISOString().slice(0, 10), today.toISOString().slice(0, 10));
  const logMap   = {};
  logs.forEach((l) => { logMap[l.date] = l.done; });

  const todayIso = today.toISOString().slice(0, 10);

  const heatmapCells = [];
  for (let i = 83; i >= 0; i--) {
    const d  = new Date(today); d.setDate(today.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    heatmapCells.push({ date: ds, done: !!logMap[ds] });
  }

  const recentNotes = logs.filter((l) => l.note).slice(-5).reverse();

  panel.innerHTML = `
    <button class="close-btn" id="close-detail">×</button>
    <h1 style="margin-right:32px;">${escapeHtml(habit.title)}</h1>
    <div class="muted" style="font-size:11px; margin-bottom:16px;">${formatFrequency(habit)}${habit.area_title ? ' / ' + escapeHtml(habit.area_title) : ''}</div>

    <div class="grid grid-3" style="margin-bottom:20px; gap:8px;">
      <div class="card stat-card" style="padding:10px;">
        <div class="stat-label">Streak</div>
        <div class="stat-value" style="font-size:20px;">${habit.current_streak}${streakUnit(habit)}</div>
      </div>
      <div class="card stat-card" style="padding:10px;">
        <div class="stat-label">Best</div>
        <div class="stat-value" style="font-size:20px;">${habit.longest_streak}${streakUnit(habit)}</div>
      </div>
      <div class="card stat-card" style="padding:10px;">
        <div class="stat-label">${rateLabel(habit)}</div>
        <div class="stat-value" style="font-size:20px;">${Math.round(habit.completion_rate * 100)}%</div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <h2 style="margin:0;">Activity — last 12 weeks</h2>
      <span class="muted" style="font-size:11px;">click a cell to toggle</span>
    </div>
    <div id="habit-heatmap" style="display:grid; grid-template-columns:repeat(12,1fr); gap:2px; margin-bottom:20px;">
      ${heatmapCells.map((c) => `
        <div class="heatmap-cell" data-date="${c.date}" data-done="${c.done}"
          title="${c.date}${c.done ? ' ✓' : ''}"
          style="aspect-ratio:1; border-radius:1px; cursor:pointer;
            background:${c.done ? 'var(--success)' : 'var(--surface-raised)'};
            opacity:${c.done ? 0.85 : 1};
            border:1px solid var(--border);
            transition:opacity 0.1s, transform 0.1s;">
        </div>
      `).join('')}
    </div>

    ${recentNotes.length ? `
      <h2>Recent notes</h2>
      ${recentNotes.map((l) => `
        <div class="list-row">
          <span class="muted mono" style="font-size:10px;">${l.date}</span>
          <span>${escapeHtml(l.note)}</span>
        </div>
      `).join('')}
    ` : ''}

    <div style="display:flex; gap:8px; margin-top:24px;">
      <button id="edit-habit-btn">Edit</button>
      <button id="archive-habit-btn" class="danger-btn">Archive</button>
    </div>
  `;

  // Heatmap click — toggle past day
  panel.querySelectorAll('.heatmap-cell').forEach((cell) => {
    cell.addEventListener('mouseenter', () => { cell.style.transform = 'scale(1.15)'; });
    cell.addEventListener('mouseleave', () => { cell.style.transform = ''; });
    cell.addEventListener('click', async () => {
      const dateStr = cell.dataset.date;
      const wasDone = cell.dataset.done === 'true';
      const newDone = !wasDone;

      // Optimistic update
      cell.dataset.done = String(newDone);
      cell.style.background = newDone ? 'var(--success)' : 'var(--surface-raised)';
      cell.style.opacity = newDone ? '0.85' : '1';
      cell.title = dateStr + (newDone ? ' ✓' : '');

      try {
        const updated = await API.logHabit(habit.id, { done: newDone, date: dateStr });
        // Update local habit reference for streaks
        habit.current_streak = updated.current_streak;
        habit.longest_streak = updated.longest_streak;
        habit.completion_rate = updated.completion_rate;
        habit.done_today = updated.done_today;
        // Refresh streak stats in panel without full re-render
        const statCards = panel.querySelectorAll('.stat-value');
        if (statCards[0]) statCards[0].textContent = `${updated.current_streak}${streakUnit(habit)}`;
        if (statCards[1]) statCards[1].textContent = `${updated.longest_streak}${streakUnit(habit)}`;
        if (statCards[2]) statCards[2].textContent = `${Math.round(updated.completion_rate * 100)}%`;
      } catch (err) {
        // Revert on error
        cell.dataset.done = String(wasDone);
        cell.style.background = wasDone ? 'var(--success)' : 'var(--surface-raised)';
        cell.style.opacity = wasDone ? '0.85' : '1';
      }
    });
  });

  document.getElementById('close-detail').addEventListener('click', closeHabitDetail);
  overlay.onclick = closeHabitDetail;
  document.getElementById('edit-habit-btn').addEventListener('click', () => {
    closeHabitDetail();
    openHabitModal(habit, areas);
  });
  document.getElementById('archive-habit-btn').addEventListener('click', async () => {
    if (confirm(`Archive "${habit.title}"?`)) {
      await API.archiveHabit(habit.id);
      closeHabitDetail();
      Router.resolve();
    }
  });
}

function closeHabitDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-panel').innerHTML = '';
}

// ---------------------------------------------------------------------------
// Create / Edit modal
// ---------------------------------------------------------------------------

function openHabitModal(habit, areas) {
  const isEdit  = !!habit;
  const freq    = habit?.frequency   || 'daily';
  const count   = habit?.frequency_count || 3;
  const hType   = habit?.habit_type  || 'yes_no';

  showModal(`
    <h2>${isEdit ? 'Edit Habit' : 'New Habit'}</h2>
    <form id="habit-form">
      <div class="field"><label>Title</label>
        <input name="title" required value="${habit ? escapeHtml(habit.title) : ''}" placeholder="Drink water">
      </div>
      <div class="field"><label>Area</label>
        <select name="area_id">
          <option value="">-- no area --</option>
          ${areas.map((a) => `<option value="${a.id}" ${habit?.area_id === a.id ? 'selected' : ''}>${escapeHtml(a.title)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Description</label>
        <textarea name="description" rows="2">${habit ? escapeHtml(habit.description || '') : ''}</textarea>
      </div>

      <!-- Habit type -->
      <div class="field"><label>Type</label>
        <select name="habit_type" id="habit-type-select">
          <option value="yes_no"      ${hType === 'yes_no'      ? 'selected' : ''}>Yes / No — done or not done</option>
          <option value="measurable"  ${hType === 'measurable'  ? 'selected' : ''}>Measurable — log a number</option>
        </select>
      </div>

      <!-- Measurable fields -->
      <div id="measurable-fields" style="display:${hType === 'measurable' ? 'block' : 'none'};">
        <div class="field"><label>Target value <span class="muted" style="font-weight:400;">(optional)</span></label>
          <input type="number" name="target_value" min="0" step="any"
            value="${habit?.target_value != null ? habit.target_value : ''}"
            placeholder="e.g. 5" style="width:120px;">
          <span class="muted" style="font-size:11px; margin-left:8px;">marks as ✓ when reached</span>
        </div>
        <div class="field"><label>Unit</label>
          <input name="unit" value="${habit ? escapeHtml(habit.unit || '') : ''}"
            placeholder="km, pages, min, glasses…" style="width:160px;">
        </div>
      </div>

      <div class="field"><label>Frequency</label>
        <select name="frequency" id="freq-select">
          <option value="daily"       ${freq === 'daily'       ? 'selected' : ''}>Daily</option>
          <option value="weekly"      ${freq === 'weekly'      ? 'selected' : ''}>Weekly (every Monday)</option>
          <option value="x_per_week"  ${freq === 'x_per_week'  ? 'selected' : ''}>At least X times per week</option>
          <option value="x_per_month" ${freq === 'x_per_month' ? 'selected' : ''}>At least X times per month</option>
          <option value="custom"      ${freq === 'custom'      ? 'selected' : ''}>Custom days</option>
        </select>
      </div>

      <!-- X count field (for x_per_week / x_per_month) -->
      <div class="field" id="freq-count-field" style="display:${(freq === 'x_per_week' || freq === 'x_per_month') ? 'block' : 'none'};">
        <label>Target (X)</label>
        <input type="number" name="frequency_count" min="1" max="31" value="${count}" style="width:100px;">
        <span class="muted" style="font-size:11px; margin-left:8px;">times per <span id="freq-unit-label">${freq === 'x_per_month' ? 'month' : 'week'}</span></span>
      </div>

      <!-- Custom days checkboxes -->
      <div class="field" id="custom-days-field" style="display:${freq === 'custom' ? 'block' : 'none'};">
        <label>Days</label>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((name, i) => {
            const checked = habit?.target_days && habit.target_days.split(',').map((x) => x.trim()).includes(String(i));
            return `<label style="display:flex; align-items:center; gap:4px; text-transform:none; font-size:13px;">
              <input type="checkbox" name="day_${i}" style="width:auto;" ${checked ? 'checked' : ''}>${name}
            </label>`;
          }).join('')}
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
        <button type="button" id="cancel-modal">Cancel</button>
        <button type="submit" class="primary">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </form>
  `);

  document.getElementById('habit-type-select').addEventListener('change', (e) => {
    document.getElementById('measurable-fields').style.display =
      e.target.value === 'measurable' ? 'block' : 'none';
  });
  document.getElementById('freq-select').addEventListener('change', (e) => {
    const v = e.target.value;
    document.getElementById('custom-days-field').style.display = v === 'custom' ? 'block' : 'none';
    const showCount = v === 'x_per_week' || v === 'x_per_month';
    document.getElementById('freq-count-field').style.display = showCount ? 'block' : 'none';
    if (showCount) {
      document.getElementById('freq-unit-label').textContent = v === 'x_per_month' ? 'month' : 'week';
    }
  });
  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  document.getElementById('habit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd         = new FormData(e.target);
    const freq       = fd.get('frequency');
    const habit_type = fd.get('habit_type') || 'yes_no';
    let target_days     = null;
    let frequency_count = null;
    let target_value    = null;
    let unit            = null;

    if (freq === 'custom') {
      const days = [0,1,2,3,4,5,6].filter((i) => fd.get(`day_${i}`)).map(String);
      target_days = days.join(',') || null;
    }
    if (freq === 'x_per_week' || freq === 'x_per_month') {
      frequency_count = parseInt(fd.get('frequency_count')) || 1;
    }
    if (habit_type === 'measurable') {
      const tv = parseFloat(fd.get('target_value'));
      target_value = isNaN(tv) ? null : tv;
      unit = fd.get('unit')?.trim() || null;
    }

    const payload = {
      title:       fd.get('title'),
      area_id:     fd.get('area_id') || null,
      description: fd.get('description') || null,
      frequency:   freq,
      target_days,
      frequency_count,
      habit_type,
      target_value,
      unit,
      status: habit?.status || 'active',
    };
    if (isEdit) await API.updateHabit(habit.id, payload);
    else        await API.createHabit(payload);
    closeModal();
    Router.resolve();
  });
}

Router.register('/habits', renderHabits);
