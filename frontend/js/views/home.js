// views/home.js — Today page: what to do right now

async function renderHome(main) {
  const [d, habits, areas] = await Promise.all([
    API.dashboard(),
    API.listHabits(),
    API.listAreas(),
  ]);

  const today    = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const dayOfWeek = (today.getDay() + 6) % 7; // 0=Mon

  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Habits scheduled for today
  const todayHabits = habits.filter((h) => {
    if (h.status !== 'active') return false;
    if (h.frequency === 'daily') return true;
    if (h.frequency === 'weekly') return dayOfWeek === 0;
    if (h.frequency === 'custom' && h.target_days)
      return h.target_days.split(',').map((x) => parseInt(x.trim())).includes(dayOfWeek);
    if (h.frequency === 'x_per_week' || h.frequency === 'x_per_month') return true;
    return false;
  });

  const doneCount   = todayHabits.filter((h) => h.done_today).length;
  const habitTotal  = todayHabits.length;

  const neglected = areas.filter((a) => a.health_status === 'neglected' && a.active_project_count > 0);

  main.innerHTML = `
    <div class="view-header">
      <div>
        <h1>${greeting}</h1>
        <div class="muted mono" style="font-size:12px; margin-top:2px;">${today.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' })}</div>
      </div>
    </div>

    ${neglected.length ? `
      <div class="callout" style="margin-bottom:20px; border-color:rgba(224,92,92,0.4);">
        <span style="color:var(--danger);">Neglected:</span>
        ${neglected.map((a) => `<strong>${escapeHtml(a.title)}</strong>`).join(' and ')} — no task activity in 14+ days.
        <a href="#/areas" style="margin-left:8px; font-size:12px;">-> Areas</a>
      </div>
    ` : ''}

    <div class="grid grid-4" style="margin-bottom:24px;">
      <div class="card stat-card">
        <div class="stat-label">Due Today</div>
        <div class="stat-value">${d.tasks_due_today}</div>
        <div class="stat-sub">${d.tasks_due_week} this week</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Habits Done</div>
        <div class="stat-value">${doneCount}<span style="font-size:14px; font-weight:400; color:var(--text-muted);">/${habitTotal}</span></div>
        <div class="stat-sub">${habitTotal - doneCount} remaining</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Life Score</div>
        <div class="stat-value">${d.life_score}%</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Streak</div>
        <div class="stat-value">${d.streak}d</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:24px; align-items:start;">

      <!-- Today's Habits -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">Today's Habits</h2>
          <a href="#/habits" style="font-size:11px;">All habits -></a>
        </div>
        ${todayHabits.length ? `
          <div id="home-habits-list">
            ${todayHabits.map((h) => homeHabitRow(h)).join('')}
          </div>
        ` : `<div class="muted" style="font-size:12px; padding:8px 0;">No habits scheduled for today.</div>`}
      </div>

      <!-- Focus + Upcoming -->
      <div>
        ${d.focus_suggestion ? `
          <div class="card" style="margin-bottom:16px; border-left:2px solid var(--accent);">
            <h2 style="margin-bottom:8px;">Focus Now</h2>
            <div style="font-family:var(--font-display); font-weight:600; font-size:14px; margin-bottom:4px;">${escapeHtml(d.focus_suggestion.title)}</div>
            <div class="muted" style="font-size:11px;">${escapeHtml(d.focus_suggestion.project_title || '')} &nbsp;·&nbsp; <span class="badge priority-${d.focus_suggestion.priority}">${d.focus_suggestion.priority}</span></div>
          </div>
        ` : ''}

        <div class="card">
          <h2>Upcoming Deadlines</h2>
          ${d.upcoming_deadlines.length ? d.upcoming_deadlines.slice(0, 6).map((t) => `
            <div class="list-row">
              <span style="font-size:13px;">${escapeHtml(t.title)}</span>
              <span class="muted mono" style="font-size:11px; white-space:nowrap;">${fmtDate(t.due_date)}</span>
            </div>
          `).join('') : `<div class="muted" style="font-size:12px;">Nothing due in the next 14 days.</div>`}
        </div>
      </div>

    </div>

    <!-- Recently completed -->
    ${d.recent_completed.length ? `
      <div class="card" style="margin-bottom:20px;">
        <h2>Recently Completed</h2>
        ${d.recent_completed.slice(0, 5).map((t) => `
          <div class="list-row">
            <span style="font-size:13px;">${escapeHtml(t.title)}</span>
            <span class="muted mono" style="font-size:11px;">${fmtDate(t.completed_at)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <!-- Weekly review -->
    <div class="card" id="review-section-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0;">Weekly Review</h2>
      </div>
      <div id="review-section-body"></div>
    </div>
  `;

  // Habit check buttons
  document.querySelectorAll('.home-habit-check').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.habitId;
      btn.disabled = true;
      await API.logHabit(id, { done: true });
      renderHome(main);
    });
  });

  // Weekly review section
  const reviewBody = document.getElementById('review-section-body');
  if (reviewBody) renderWeeklyReviewSection(reviewBody);
}

function homeHabitRow(h) {
  return `
    <div class="list-row" style="align-items:center; padding:6px 0;">
      <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
        <span style="width:3px; height:20px; background:${h.color || 'var(--border)'}; border-radius:2px; flex-shrink:0;"></span>
        <div style="min-width:0;">
          <div style="font-size:13px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(h.title)}</div>
          ${h.area_title ? `<div class="muted" style="font-size:11px;">${escapeHtml(h.area_title)}</div>` : ''}
        </div>
        <div style="display:flex; gap:2px; flex-shrink:0; margin-left:auto; margin-right:8px;">
          ${h.last7.map((d) => `<div title="${d.date}" style="width:9px; height:9px; border-radius:1px; background:${
            !d.scheduled ? 'transparent' :
            d.done ? 'var(--success)' :
            d.date < new Date().toISOString().slice(0,10) ? 'rgba(224,92,92,0.35)' : 'var(--border)'
          };"></div>`).join('')}
        </div>
      </div>
      <button class="home-habit-check" data-habit-id="${h.id}" ${h.done_today ? 'disabled' : ''}
        style="padding:3px 10px; font-size:11px; flex-shrink:0;
               color:${h.done_today ? 'var(--success)' : 'var(--text-muted)'};
               border-color:${h.done_today ? 'rgba(78,202,139,0.4)' : 'var(--border)'};">
        ${h.done_today ? '✓ done' : 'mark done'}
      </button>
    </div>
  `;
}

Router.register('/home', renderHome);
// Keep /dashboard as alias for now so old bookmarks work
Router.register('/dashboard', renderHome);
