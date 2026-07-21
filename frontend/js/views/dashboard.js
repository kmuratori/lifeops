// views/dashboard.js — Insights & analytics (replaces the old Insights view)

async function renderDashboard(main) {
  const [dashData, progress, effort, completion, roi, bottlenecks, reviews] = await Promise.all([
    API.dashboard(),
    API.progressOverTime(),
    API.effortDistribution(),
    API.completionRate(),
    API.areaRoi(),
    API.bottlenecks(),
    API.listReviews(),
  ]);

  main.innerHTML = `
    <div class="view-header">
      <h1>Dashboard</h1>
      <span class="muted" style="font-size:12px;">Progress, trends, and what's working</span>
    </div>

    <!-- Top stats row -->
    <div class="grid grid-4" style="margin-bottom:20px;">
      <div class="card stat-card">
        <div class="stat-label">Life Score</div>
        <div class="stat-value">${dashData.life_score}%</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Active Projects</div>
        <div class="stat-value">${dashData.active_projects}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Streak</div>
        <div class="stat-value">${dashData.streak}d</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">Due Today</div>
        <div class="stat-value">${dashData.tasks_due_today}</div>
        <div class="stat-sub">${dashData.tasks_due_week} this week</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:20px;">
      <div class="card">
        <h2>Progress Over Time — last 90 days</h2>
        <div class="muted" style="font-size:11px; margin-bottom:6px;">One line per project</div>
        ${progress.length
          ? `<div style="height:240px;"><canvas id="chart-progress"></canvas></div>`
          : `<div class="empty-state" style="padding:20px 0;">No snapshots yet. Trigger one below.</div>`}
      </div>
      <div class="card">
        <h2>Effort Distribution — completed tasks by Area</h2>
        ${effort.length
          ? `<div style="height:240px;"><canvas id="chart-effort"></canvas></div>`
          : `<div class="empty-state" style="padding:20px 0;">Complete some tasks to see effort.</div>`}
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:20px;">
      <div class="card">
        <h2>Completion Rate — weekly</h2>
        <div style="height:220px;"><canvas id="chart-completion"></canvas></div>
      </div>
      <div class="card">
        <h2>Life Balance — Radar</h2>
        ${dashData.radar.length
          ? `<div style="height:220px;"><canvas id="chart-radar-big"></canvas></div>`
          : `<div class="empty-state" style="padding:20px 0;">Add areas to populate the radar.</div>`}
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h2>Area ROI</h2>
      ${roi.length ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>Area</th>
              <th class="num">Tasks done</th>
              <th class="num">Hours invested</th>
              <th class="num">Progress</th>
            </tr>
          </thead>
          <tbody>
            ${roi.map((r) => `
              <tr>
                <td>${escapeHtml(r.icon || '')} ${escapeHtml(r.area)}</td>
                <td class="num">${r.tasks_done}</td>
                <td class="num">${r.hours_invested}h</td>
                <td class="num">${r.progress}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : `<div class="empty-state" style="padding:20px 0;">No areas yet.</div>`}
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h2>Dead Weight — bottleneck detector</h2>
      ${bottlenecks.length
        ? bottlenecks.map((b) => `
          <div class="list-row">
            <span>${escapeHtml(b.title)}</span>
            <span class="muted" style="font-size:11px;">${b.stuck_pct}% stuck / ${b.tasks_total} tasks</span>
          </div>
        `).join('')
        : `<div class="muted" style="font-size:12px; padding:8px 0;">Nothing stuck. Every active project has moved in the last 14 days.</div>`}
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h2>History — Weekly Reviews</h2>
      ${reviews.length
        ? `<div id="reviews-list">${reviews.map((r) => reviewSummaryRow(r)).join('')}</div>`
        : `<div class="muted" style="font-size:12px; padding:8px 0;">No weekly reviews yet. Complete a review from the Home page.</div>`}
    </div>

    <div style="margin-top:12px;">
      <button id="trigger-snapshot">Take snapshot now</button>
      <span class="muted" style="font-size:11px; margin-left:8px;">Normally runs automatically at 23:59 each day.</span>
    </div>
  `;

  if (progress.length)        renderLineChart('chart-progress', progress);
  if (effort.length)          renderDonutChart('chart-effort', effort);
  renderBarChart('chart-completion', completion);
  if (dashData.radar.length)  renderRadarChart('chart-radar-big', dashData.radar);

  document.getElementById('trigger-snapshot').addEventListener('click', async () => {
    await API.triggerSnapshot();
    renderDashboard(main);
  });

  // Expandable review rows
  document.querySelectorAll('.review-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const id = row.dataset.reviewId;
      const existing = document.getElementById(`review-detail-${id}`);
      if (existing) { existing.remove(); return; }
      const review  = reviews.find((r) => r.id === id);
      const detail  = document.createElement('div');
      detail.id     = `review-detail-${id}`;
      detail.style.cssText = 'padding:10px 14px; background:var(--surface-raised); border-radius:var(--radius); margin:2px 0 8px; font-size:12px;';
      detail.innerHTML = reviewDetailContent(review, null);
      row.after(detail);
    });
  });
}

function reviewSummaryRow(r) {
  const moodLabels = ['', 'Rough', 'Meh', 'Okay', 'Good', 'Great'];
  const mood  = r.mood ? moodLabels[r.mood] || '--' : '--';
  const week  = new Date(r.week_start + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  });
  return `
    <div class="list-row review-row" data-review-id="${r.id}"
      style="cursor:pointer; flex-wrap:wrap; gap:4px;">
      <span style="font-family:var(--font-display); font-size:12px; flex:1;">Week of ${week}</span>
      <span class="muted" style="font-size:11px;">${mood}</span>
      ${r.wins_snippet ? `<div style="width:100%; color:var(--text-muted); font-size:11px;">${escapeHtml(r.wins_snippet)}</div>` : ''}
    </div>
  `;
}

function reviewDetailContent(r, stats) {
  return `
    ${r.wins      ? `<div style="margin-bottom:6px;"><div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:2px;">Wins</div><div class="markdown-body">${renderMd(r.wins)}</div></div>` : ''}
    ${r.struggles ? `<div style="margin-bottom:6px;"><div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:2px;">Struggles</div><div class="markdown-body">${renderMd(r.struggles)}</div></div>` : ''}
    ${r.next_week_focus ? `<div><div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:2px;">Focus</div><div class="markdown-body">${renderMd(r.next_week_focus)}</div></div>` : ''}
  `;
}

Router.register('/insights', renderDashboard);
