// views/habits.js -- Feature 1: Habits (Fixed Layout)

// ---------------------------------------------------------------------------
// Small date/format helpers
// ---------------------------------------------------------------------------

function getTodayIso() {
  return localDateIso(new Date());
}

function localDateIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTooltipDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatShortValue(v) {
  if (v == null) return '';
  const rounded = Math.round(v * 10) / 10;
  return String(rounded);
}

// ---------------------------------------------------------------------------
// Tooltip (GitHub-style floating tooltip)
// ---------------------------------------------------------------------------

let _habitTooltipEl = null;
function ensureTooltip() {
  if (_habitTooltipEl) return _habitTooltipEl;
  _habitTooltipEl = document.createElement('div');
  _habitTooltipEl.id = 'habit-tooltip';
  document.body.appendChild(_habitTooltipEl);
  return _habitTooltipEl;
}
function showHabitTooltip(e, html) {
  const tip = ensureTooltip();
  tip.innerHTML = html;
  tip.style.opacity = '1';
  positionTooltip(e, tip);
}
function moveHabitTooltip(e) { positionTooltip(e, ensureTooltip()); }
function hideHabitTooltip() { if (_habitTooltipEl) _habitTooltipEl.style.opacity = '0'; }
function positionTooltip(e, tip) {
  const pad = 12;
  let x = e.clientX + pad, y = e.clientY + pad;
  const rect = tip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = e.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight) y = e.clientY - rect.height - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

// ---------------------------------------------------------------------------
// Undo snackbar
// ---------------------------------------------------------------------------

let _snackbarTimer = null;
function showUndoSnackbar(message, onUndo) {
  let el = document.getElementById('habit-snackbar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'habit-snackbar';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${escapeHtml(message)}</span><button id="snackbar-undo-btn">Undo</button>`;
  el.classList.add('show');
  clearTimeout(_snackbarTimer);
  document.getElementById('snackbar-undo-btn').onclick = async () => {
    el.classList.remove('show');
    clearTimeout(_snackbarTimer);
    await onUndo();
  };
  _snackbarTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

async function logWithUndo(habitId, payload, prevLog, message, refresh) {
  try {
    const updated = await API.logHabit(habitId, payload);
    showUndoSnackbar(message, async () => {
      const revertPayload = prevLog && prevLog.done
        ? { done: prevLog.done, value: prevLog.value, date: payload.date }
        : { done: false, value: null, date: payload.date };
      try {
        await API.logHabit(habitId, revertPayload);
        refresh();
      } catch (error) {
        appAlert(error.message, { title: 'Could not undo habit update' });
      }
    });
    return updated;
  } catch (error) {
    appAlert(error.message, { title: 'Habit update failed' });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Log-value dialog
// ---------------------------------------------------------------------------

function openHabitLogDialog(habit, dateStr, prevValue, onSaved) {
  const isToday = dateStr === getTodayIso();
  const prevLog = { done: prevValue != null, value: prevValue != null ? prevValue : null };

  showModal(`
    <h2>Log value</h2>
    <div class="muted" style="font-size:12px; margin-bottom:14px;">
      ${escapeHtml(habit.title)} · ${formatTooltipDate(dateStr)}${isToday ? ' (today)' : ''}
    </div>
    <form id="habit-log-form">
      <div class="field">
        <label for="habit-log-value">Value${habit.unit ? ` (${escapeHtml(habit.unit)})` : ''}</label>
        <input id="habit-log-value" type="number" name="value" step="any" min="0" required
          aria-describedby="habit-log-value-error"
          value="${prevValue != null ? prevValue : ''}"
          placeholder="${habit.target_value != null ? 'target ' + habit.target_value : '0'}">
        <div id="habit-log-value-error" role="alert" aria-live="polite" style="color:var(--danger); font-size:11px;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; gap:8px; margin-top:16px;">
        <button type="button" id="habit-log-clear" class="danger-btn">Clear</button>
        <div style="display:flex; gap:8px;">
          <button type="button" id="habit-log-cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('habit-log-cancel').addEventListener('click', closeModal);

  document.getElementById('habit-log-clear').addEventListener('click', async () => {
    closeModal();
    await logWithUndo(habit.id, { done: false, value: null, date: dateStr }, prevLog, `Cleared ${dateStr}`, onSaved);
    onSaved();
  });

  document.getElementById('habit-log-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const finish = beginFormSubmission(e.currentTarget);
    if (!finish) return;
    try {
      const fd = new FormData(e.currentTarget);
      const val = parseFloat(fd.get('value'));
      if (!Number.isFinite(val)) {
        document.getElementById('habit-log-value-error').textContent = 'Enter a valid number.';
        document.querySelector('#habit-log-form [name="value"]').focus();
        return;
      }
      closeModal();
      await logWithUndo(habit.id, { done: true, value: val, date: dateStr }, prevLog, `Logged ${dateStr}`, onSaved);
      onSaved();
    } finally {
      finish();
    }
  });
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function sparklineSvg(values, color, w = 64, h = 22) {
  if (!values.length) return '';
  const pad = 2;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="habit-sparkline">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Cell visual — opacity tiers on var(--success)
// ---------------------------------------------------------------------------

function habitCellVisual(h, d) {
  if (!d.scheduled || !d.done) return null;

  if (h.habit_type === 'measurable' && h.target_value) {
    const ratio = d.value != null ? Math.min(1, d.value / h.target_value) : 1;
    let level = 1;
    if (ratio < 0.34) level = 0.35;
    else if (ratio < 0.67) level = 0.55;
    else if (ratio < 1) level = 0.78;
    return { bg: 'var(--success)', opacity: level };
  }
  return { bg: 'var(--success)', opacity: 1 };
}

function toggleClass(h) {
  if (h.habit_type === 'measurable') {
    if (h.value_today == null) return '';
    if (h.target_value && h.value_today < h.target_value) return 'partial';
    return 'done';
  }
  return h.done_today ? 'done' : '';
}

// ---------------------------------------------------------------------------
// Main entry — view switcher
// ---------------------------------------------------------------------------

async function renderHabits(main) {
  const [habits, areas] = await Promise.all([API.listHabits(), API.listAreas()]);
  const view = localStorage.getItem('lifeops-habits-view') || 'list';
  if (view === 'cards') await renderHabitsCards(main, habits, areas);
  else await renderHabitsList(main, habits, areas);
}

// ---------------------------------------------------------------------------
// List view — FIXED: single grid, toggle aligns with last day column
// ---------------------------------------------------------------------------

function habitWeekHeaderHtml() {
  const todayIso = getTodayIso();
  const cells = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const iso = localDateIso(d);
    const label = d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
    cells.push(`<div class="habit-week-header-cell ${iso === todayIso ? 'is-today' : ''}" aria-label="${escapeHtml(formatTooltipDate(iso))}" title="${escapeHtml(formatTooltipDate(iso))}">
      <span class="habit-week-day-name">${label}</span><span class="habit-week-day-number">${d.getDate()}</span>
    </div>`);
  }
  return cells.join('');
}

async function renderHabitsList(main, habits, areas) {
  main.innerHTML = `
    <div class="view-header">
      <h1>Habits</h1>
      <div style="display:flex; gap:8px;">
        <button id="view-toggle-btn" title="Switch view">Cards view</button>
        <button class="primary" id="new-habit-btn">+ New Habit</button>
      </div>
    </div>
    ${!habits.length
      ? `<div class="empty-state">No habits yet. A habit is a recurring action with no finish line — "meditate", "read", "exercise".</div>`
      : `
        <div class="habit-list-header">
          <div></div>
          ${habitWeekHeaderHtml()}
          <div></div>
        </div>
        <div class="habit-list" id="habits-list" role="group" aria-label="Weekly habit tracking"></div>
        <div class="muted" style="font-size:11px; margin-top:8px; padding:0 12px;">Tab to the weekly grid; arrow keys move between scheduled days and habits; Enter or Space toggles; O opens habit details.</div>
      `}
  `;

  const list = document.getElementById('habits-list');
  if (list) {
    const initialFocusHabit = habits.find((h) => h.last7.some((day) => day.scheduled))?.id;
    list.innerHTML = habits.map((h) => habitRow(h, h.id === initialFocusHabit)).join('');
    wireHabitRows(list, habits, areas, () => renderHabits(main));
    wireKeyboardNav(list, habits, areas);
  }

  document.getElementById('view-toggle-btn').addEventListener('click', () => {
    localStorage.setItem('lifeops-habits-view', 'cards');
    renderHabits(main);
  });

  if (window._pendingDetailOpen?.type === 'habit') {
    const { id } = window._pendingDetailOpen;
    window._pendingDetailOpen = null;
    const h = habits.find((h) => h.id === id);
    if (h) openHabitDetail(h, areas);
  }

  document.getElementById('new-habit-btn').addEventListener('click', () => openHabitModal(null, areas));
}

function habitRow(h, hasTabStop = false) {
  const color = h.color || h.area_color || 'var(--border)';
  const measurable = h.habit_type === 'measurable';
  const todayIndex = h.last7.findIndex((day) => day.date === getTodayIso() && day.scheduled);
  let lastScheduledIndex = -1;
  h.last7.forEach((day, index) => { if (day.scheduled) lastScheduledIndex = index; });
  const tabStopIndex = todayIndex >= 0 ? todayIndex : lastScheduledIndex;
  const cells = h.last7.map((d, index) => habitWeekCellHtml(h, d, hasTabStop && index === tabStopIndex)).join('');

  let sparkline = '';
  if (measurable) {
    const vals = h.last7.filter((d) => d.value != null).map((d) => d.value);
    if (vals.length > 1) sparkline = sparklineSvg(vals, color);
  }

  const toggleLabel = measurable
    ? (h.value_today != null ? formatShortValue(h.value_today) : '+')
    : (h.done_today ? 'Done' : 'Mark');

  return `
    <div class="habit-row" data-habit-id="${h.id}">
      <div class="habit-row-info">
        <div class="habit-row-title">${escapeHtml(h.title)}</div>
        <div class="muted habit-row-meta">
          ${formatFrequency(h)}${h.area_title ? ' / ' + escapeHtml(h.area_title) : ''}
          ${sparkline ? `<span class="habit-row-sparkline">${sparkline}</span>` : ''}
          · <span class="mono">${h.current_streak}${streakUnit(h)} streak</span>
        </div>
      </div>
      ${cells}
      <button class="habit-toggle ${toggleClass(h)}" data-habit-id="${h.id}" data-kind="${measurable ? 'measurable' : 'bool'}">${toggleLabel}</button>
    </div>
  `;
}

function habitWeekCellHtml(h, d, isTabStop = false) {
  const isToday = d.date === getTodayIso();
  const missed = d.scheduled && !d.done && d.date < getTodayIso();
  const visual = habitCellVisual(h, d);
  const cls = ['habit-week-cell', 'habit-week-cell-button'];
  if (isToday) cls.push('is-today');
  if (!d.scheduled) cls.push('not-scheduled');
  if (d.done) cls.push('is-complete');
  if (missed) cls.push('is-missed');
  const state = !d.scheduled ? 'not scheduled' : d.done ? 'completed' : missed ? 'missed' : 'not completed';
  const style = visual ? ` style="background:${visual.bg}; opacity:${visual.opacity};"` : '';
  return `<button type="button" class="${cls.join(' ')}" ${d.scheduled ? '' : 'disabled'}
    tabindex="${d.scheduled && isTabStop ? '0' : '-1'}" aria-pressed="${d.done ? 'true' : 'false'}"
    aria-label="${escapeHtml(h.title)}, ${formatTooltipDate(d.date)}, ${state}${isToday ? ', today' : ''}"
    data-date="${d.date}" data-done="${d.done}" data-value="${d.value != null ? d.value : ''}" data-scheduled="${d.scheduled}"
    data-missed="${missed}"${style}></button>`;
}

function wireHabitRows(list, habits, areas, refresh) {
  const todayIso = getTodayIso();

  list.querySelectorAll('.habit-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.habit-toggle') || e.target.closest('.habit-week-cell')) return;
      openHabitDetail(habits.find((x) => x.id === row.dataset.habitId), areas);
    });
  });

  // Today-toggle
  list.querySelectorAll('.habit-toggle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const h = habits.find((x) => x.id === btn.dataset.habitId);
      if (btn.dataset.kind === 'measurable') {
        openHabitLogDialog(h, todayIso, h.value_today, refresh);
        return;
      }
      const prevLog = { done: h.done_today, value: null };
      btn.disabled = true;
      await logWithUndo(h.id, { done: !h.done_today, date: todayIso }, prevLog, 'Habit updated', refresh);
      refresh();
    });
  });

  // Week cells: tooltip + click to edit that day
  list.querySelectorAll('.habit-week-cell').forEach((cell) => {
    if (cell.classList.contains('not-scheduled')) return;

    cell.addEventListener('mouseenter', (e) => {
      const h = habits.find((x) => x.id === cell.closest('.habit-row').dataset.habitId);
      const iso = cell.dataset.date;
      const done = cell.dataset.done === 'true';
        const missed = cell.dataset.missed === 'true';
      const val = cell.dataset.value;
        let html = `<div style="font-weight:600; margin-bottom:2px;">${formatTooltipDate(iso)}</div><div>${done ? 'Done' : missed ? 'Missed scheduled day' : 'Not completed'}</div>`;
      if (h.habit_type === 'measurable' && val) html += `<div>${val}${h.unit ? ' ' + escapeHtml(h.unit) : ''}</div>`;
      showHabitTooltip(e, html);
    });
    cell.addEventListener('mousemove', moveHabitTooltip);
    cell.addEventListener('mouseleave', hideHabitTooltip);

    cell.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideHabitTooltip();
      const h = habits.find((x) => x.id === cell.closest('.habit-row').dataset.habitId);
      const iso = cell.dataset.date;
      const prevLog = {
        done: cell.dataset.done === 'true',
        value: cell.dataset.value !== '' ? parseFloat(cell.dataset.value) : null,
      };

      if (h.habit_type === 'measurable') {
        openHabitLogDialog(h, iso, prevLog.value, refresh);
        return;
      }

      cell.disabled = true;
      await logWithUndo(h.id, { done: !prevLog.done, date: iso }, prevLog, `Updated ${iso}`, refresh);
      refresh();
    });
  });
}

// ---------------------------------------------------------------------------
// Keyboard nav
// ---------------------------------------------------------------------------

function wireKeyboardNav(list, habits, areas) {
  list.addEventListener('keydown', (e) => {
    const rows = Array.from(list.querySelectorAll('.habit-row'));
    const focusedCell = e.target.closest?.('.habit-week-cell');
    const active = (focusedCell || document.activeElement).closest?.('.habit-row');
    const idx = active ? rows.indexOf(active) : -1;

    if (focusedCell && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const currentColumn = Array.from(active.querySelectorAll('.habit-week-cell')).indexOf(focusedCell);
      const direction = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      const nextRowIndex = direction ? Math.max(0, Math.min(rows.length - 1, idx + direction)) : idx;
      const targetRow = rows[nextRowIndex];
      const cells = Array.from(targetRow?.querySelectorAll('.habit-week-cell:not(:disabled)') || []);
      const weekColumns = Array.from(targetRow?.querySelectorAll('.habit-week-cell') || []);
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const nextCell = direction
        ? cells.reduce((closest, cell) => {
            const distance = Math.abs(weekColumns.indexOf(cell) - currentColumn);
            return !closest || distance < Math.abs(weekColumns.indexOf(closest) - currentColumn) ? cell : closest;
          }, null)
        : cells
            .filter((cell) => (weekColumns.indexOf(cell) - currentColumn) * step > 0)
            .sort((a, b) => Math.abs(weekColumns.indexOf(a) - currentColumn) - Math.abs(weekColumns.indexOf(b) - currentColumn))[0];
      if (nextCell) {
        list.querySelectorAll('.habit-week-cell[tabindex="0"]').forEach((cell) => cell.tabIndex = -1);
        nextCell.tabIndex = 0;
        nextCell.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      (rows[Math.min(rows.length - 1, idx + 1)] || rows[0])?.querySelector('.habit-week-cell:not(:disabled)')?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (rows[Math.max(0, idx - 1)] || rows[0])?.querySelector('.habit-week-cell:not(:disabled)')?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && active) {
      if (!focusedCell) {
        e.preventDefault();
        active.querySelector('.habit-toggle')?.click();
      }
    } else if (e.key.toLowerCase() === 'o' && active) {
      e.preventDefault();
      openHabitDetail(habits.find((x) => x.id === active.dataset.habitId), areas);
    }
  });
}

// ---------------------------------------------------------------------------
// Card view
// ---------------------------------------------------------------------------

async function renderHabitsCards(main, habits, areas) {
  main.innerHTML = `
    <div class="view-header">
      <h1>Habits</h1>
      <div style="display:flex; gap:8px;">
        <button id="view-toggle-btn" title="Switch view">List view</button>
        <button class="primary" id="new-habit-btn">+ New Habit</button>
      </div>
    </div>
    ${!habits.length ? `<div class="empty-state">No habits yet. A habit is a recurring action with no finish line — "meditate", "read", "exercise".</div>` : ''}
    <div id="habits-grid" class="grid grid-cards"></div>
  `;

  const grid = document.getElementById('habits-grid');
  if (habits.length) {
    grid.innerHTML = habits.map((h) => habitCard(h)).join('');

    grid.querySelectorAll('.habit-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.habit-toggle')) return;
        openHabitDetail(habits.find((h) => h.id === el.dataset.habitId), areas);
      });
    });

    grid.querySelectorAll('.habit-toggle').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const h = habits.find((x) => x.id === btn.dataset.habitId);
        const todayIso = getTodayIso();
        if (btn.dataset.kind === 'measurable') {
          openHabitLogDialog(h, todayIso, h.value_today, () => renderHabits(main));
          return;
        }
        const prevLog = { done: h.done_today, value: null };
        btn.disabled = true;
        await logWithUndo(h.id, { done: !h.done_today, date: todayIso }, prevLog, 'Habit updated', () => renderHabits(main));
        renderHabits(main);
      });
    });
  }

  if (window._pendingDetailOpen?.type === 'habit') {
    const { id } = window._pendingDetailOpen;
    window._pendingDetailOpen = null;
    const h = habits.find((h) => h.id === id);
    if (h) openHabitDetail(h, areas);
  }

  document.getElementById('view-toggle-btn').addEventListener('click', () => {
    localStorage.setItem('lifeops-habits-view', 'list');
    renderHabits(main);
  });
  document.getElementById('new-habit-btn').addEventListener('click', () => openHabitModal(null, areas));
}

function habitCard(h) {
  const color      = h.color || h.area_color || 'var(--border)';
  const freqLabel  = formatFrequency(h);
  const pct        = Math.round(h.completion_rate * 100);
  const measurable = h.habit_type === 'measurable';
  const todayIso   = getTodayIso();

  const toggleLabel = measurable
    ? (h.value_today != null ? formatShortValue(h.value_today) : '+')
    : (h.done_today ? 'Done' : 'Mark');

  return `
    <div class="card habit-card dream-stripe" style="border-left-color:${color}" data-habit-id="${h.id}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div style="min-width:0; flex:1; margin-right:8px;">
          <div style="font-family:var(--font-display); font-weight:600; font-size:13px; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(h.title)}</div>
          <div class="muted" style="font-size:11px;">${freqLabel}${h.unit ? ' · ' + escapeHtml(h.unit) : ''}${h.area_title ? ' / ' + escapeHtml(h.area_title) : ''}</div>
        </div>
        <button class="habit-toggle ${toggleClass(h)}" data-habit-id="${h.id}" data-kind="${measurable ? 'measurable' : 'bool'}">${toggleLabel}</button>
      </div>

      <div role="img" aria-label="${escapeHtml(`${h.title}, last seven days: ${h.last7.map((d) => {
        const state = !d.scheduled ? 'not scheduled' : d.done ? 'completed' : d.date < todayIso ? 'missed' : d.date === todayIso ? 'not completed, today' : 'not completed';
        return `${formatTooltipDate(d.date)}, ${state}`;
      }).join('; ')}`)}" style="display:flex; gap:3px; margin-bottom:10px;">
        ${h.last7.map((d) => {
          let style;
          if (!d.scheduled) style = 'background:repeating-linear-gradient(45deg, var(--bg-base), var(--bg-base) 3px, var(--border) 3px, var(--border) 4px); opacity:1;';
          else if (d.done) { const v = habitCellVisual(h, d); style = `background:${v.bg}; opacity:${v.opacity};`; }
          else if (d.date < todayIso) style = 'background:color-mix(in srgb, var(--danger) 24%, var(--surface)); opacity:1;';
          else if (d.date === todayIso) style = 'background:color-mix(in srgb, var(--accent) 25%, var(--surface)); opacity:1;';
          else style = 'background:var(--border); opacity:1;';
          const state = !d.scheduled ? 'Not scheduled' : d.done ? 'Completed' : d.date < todayIso ? 'Missed' : d.date === todayIso ? 'Not completed today' : 'Not completed';
          const value = measurable && d.value != null ? `, ${d.value}${h.unit ? ' ' + h.unit : ''}` : '';
          return `<span aria-hidden="true" title="${escapeHtml(`${formatTooltipDate(d.date)}: ${state}${value}`)}" style="flex:1; height:14px; border-radius:1px; ${style}"></span>`;
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
  if (h.frequency === 'x_per_week') return `At least ${h.frequency_count || 1} times per week`;
  if (h.frequency === 'x_per_month') return `At least ${h.frequency_count || 1} times per month`;
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
  const logs     = await API.getHabitLogs(habit.id, localDateIso(from), localDateIso(today));
  const logMap   = {};
  logs.forEach((l) => { logMap[l.date] = l; });

  const measurable = habit.habit_type === 'measurable';

  const heatmapCells = [];
  for (let i = 83; i >= 0; i--) {
    const d  = new Date(today); d.setDate(today.getDate() - i);
    const ds = localDateIso(d);
    const log = logMap[ds];
    heatmapCells.push({ date: ds, scheduled: true, done: !!log?.done, value: log?.value });
  }

  const recentNotes = logs.filter((l) => l.note).slice(-5).reverse();

  let sparklineBlock = '';
  if (measurable) {
    const recentValues = logs.filter((l) => l.value != null).slice(-30).map((l) => l.value);
    if (recentValues.length > 1) {
      const color = habit.color || habit.area_color || 'var(--success)';
      sparklineBlock = `
        <h2 style="margin-bottom:8px;">Trend — last ${recentValues.length} logged days</h2>
        <div style="margin-bottom:20px;">${sparklineSvg(recentValues, color, 320, 60)}</div>
      `;
    }
  }

  panel.innerHTML = `
    <button class="close-btn" id="close-detail" aria-label="Close details">Close</button>
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

    ${sparklineBlock}

    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <h2 style="margin:0;">Activity — last 12 weeks</h2>
      <span class="muted" style="font-size:11px;">click a cell to edit</span>
    </div>
    <div id="habit-heatmap" style="display:grid; grid-template-columns:repeat(12,1fr); gap:2px; margin-bottom:20px;">
      ${heatmapCells.map((c) => {
        const v = habitCellVisual(habit, c);
        return `<div class="heatmap-cell" data-date="${c.date}" data-done="${c.done}" data-value="${c.value != null ? c.value : ''}"
          style="aspect-ratio:1; border-radius:1px; cursor:pointer;
            background:${v.bg}; opacity:${v.opacity};
            border:1px solid var(--border);
            transition:transform 0.1s;"></div>`;
      }).join('')}
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

  panel.querySelectorAll('.heatmap-cell').forEach((cell) => {
    cell.addEventListener('mouseenter', (e) => {
      cell.style.transform = 'scale(1.15)';
      const iso = cell.dataset.date;
      const done = cell.dataset.done === 'true';
      let html = `<div style="font-weight:600; margin-bottom:2px;">${formatTooltipDate(iso)}</div><div>${done ? 'Done' : 'Not done'}</div>`;
      if (measurable && cell.dataset.value) {
        html += `<div>${cell.dataset.value}${habit.unit ? ' ' + escapeHtml(habit.unit) : ''}</div>`;
      }
      showHabitTooltip(e, html);
    });
    cell.addEventListener('mousemove', moveHabitTooltip);
    cell.addEventListener('mouseleave', () => { cell.style.transform = ''; hideHabitTooltip(); });

    cell.addEventListener('click', async () => {
      hideHabitTooltip();
      const dateStr = cell.dataset.date;
      const prevValue = cell.dataset.value !== '' ? parseFloat(cell.dataset.value) : null;

      if (measurable) {
        openHabitLogDialog(habit, dateStr, prevValue, () => openHabitDetail(habit, areas));
        return;
      }

      const wasDone = cell.dataset.done === 'true';
      const prevLog = { done: wasDone, value: null };
      const newDone = !wasDone;

      cell.dataset.done = String(newDone);
      cell.style.background = newDone ? 'var(--success)' : 'var(--bg-base)';
      cell.style.opacity = '1';

      try {
        const updated = await logWithUndo(habit.id, { done: newDone, date: dateStr }, prevLog, `Updated ${dateStr}`, () => openHabitDetail(habit, areas));
        habit.current_streak = updated.current_streak;
        habit.longest_streak = updated.longest_streak;
        habit.completion_rate = updated.completion_rate;
        habit.done_today = updated.done_today;
        const statCards = panel.querySelectorAll('.stat-value');
        if (statCards[0]) statCards[0].textContent = `${updated.current_streak}${streakUnit(habit)}`;
        if (statCards[1]) statCards[1].textContent = `${updated.longest_streak}${streakUnit(habit)}`;
        if (statCards[2]) statCards[2].textContent = `${Math.round(updated.completion_rate * 100)}%`;
      } catch (err) {
        cell.dataset.done = String(wasDone);
        cell.style.background = wasDone ? 'var(--success)' : 'var(--bg-base)';
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
    if (await appConfirm(`Archive "${habit.title}"?`, { title: 'Archive habit', confirmText: 'Archive', danger: true })) {
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

      <div class="field"><label>Type</label>
        <select name="habit_type" id="habit-type-select">
          <option value="yes_no"      ${hType === 'yes_no'      ? 'selected' : ''}>Yes / No — done or not done</option>
          <option value="measurable"  ${hType === 'measurable'  ? 'selected' : ''}>Measurable — log a number</option>
        </select>
      </div>

      <div id="measurable-fields" style="display:${hType === 'measurable' ? 'block' : 'none'};">
        <div class="field"><label>Target value <span class="muted" style="font-weight:400;">(optional)</span></label>
          <input type="number" name="target_value" min="0" step="any"
            value="${habit?.target_value != null ? habit.target_value : ''}"
            placeholder="e.g. 5" style="width:120px;">
          <span class="muted" style="font-size:11px; margin-left:8px;">marks complete when reached</span>
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

      <div class="field" id="freq-count-field" style="display:${(freq === 'x_per_week' || freq === 'x_per_month') ? 'block' : 'none'};">
        <label>Target (X)</label>
        <input type="number" name="frequency_count" min="1" max="31" value="${count}" style="width:100px;">
        <span class="muted" style="font-size:11px; margin-left:8px;">times per <span id="freq-unit-label">${freq === 'x_per_month' ? 'month' : 'week'}</span></span>
      </div>

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
    const finish = beginFormSubmission(e.currentTarget);
    if (!finish) return;
    try {
    const fd         = new FormData(e.target);
    const freq       = fd.get('frequency');
    const habit_type = fd.get('habit_type') || 'yes_no';
    let target_days     = null;
    let frequency_count = null;
    let target_value    = null;
    let unit             = null;

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
    } catch (error) {
      appAlert(error.message, { title: 'Could not save habit' });
    } finally {
      finish();
    }
  });
}

Router.register('/habits', renderHabits);
