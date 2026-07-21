// review.js -- Feature 3: Weekly Review rendered as a dashboard section (not overlay)

const MOOD_OPTIONS = [
  { value: 1, label: 'Rough'  },
  { value: 2, label: 'Meh'    },
  { value: 3, label: 'Okay'   },
  { value: 4, label: 'Good'   },
  { value: 5, label: 'Great'  },
];

// Called by dashboard to render the review card into a container element.
async function renderWeeklyReviewSection(container) {
  container.innerHTML = `<span class="muted" style="font-size:12px;">Loading review...</span>`;

  const review = await API.getCurrentReview().catch(() => null);
  if (!review) {
    container.innerHTML = `<span class="muted" style="font-size:12px;">Could not load review.</span>`;
    return;
  }

  if (review.completed_at) {
    _renderReviewDone(container, review);
  } else {
    _renderReviewStart(container, review);
  }
}

function _renderReviewDone(container, review) {
  const week = new Date(review.week_start + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric'
  });
  const mood = review.mood ? MOOD_OPTIONS.find((m) => m.value === review.mood)?.label : '--';
  container.innerHTML = `
    <div class="muted" style="font-size:12px; margin-bottom:10px;">
      Week of ${week} -- completed. Mood: <strong>${mood}</strong>
    </div>
    ${review.wins ? `
      <div style="margin-bottom:8px;">
        <div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px;">Wins</div>
        <div class="markdown-body">${renderMd(review.wins)}</div>
      </div>
    ` : ''}
    ${review.next_week_focus ? `
      <div>
        <div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px;">Next week focus</div>
        <div class="markdown-body">${renderMd(review.next_week_focus)}</div>
      </div>
    ` : ''}
    <button id="redo-review-btn" style="margin-top:12px; font-size:11px;">Edit this review</button>
  `;
  container.querySelector('#redo-review-btn').addEventListener('click', () => {
    _renderReviewSteps(container, review);
  });
}

function _renderReviewStart(container, review) {
  const week = new Date(review.week_start + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric'
  });
  container.innerHTML = `
    <div class="muted" style="font-size:12px; margin-bottom:12px;">Week of ${week} -- not yet completed.</div>
    <button id="start-review-btn" class="primary" style="font-size:12px;">Start this week's review</button>
  `;
  container.querySelector('#start-review-btn').addEventListener('click', async () => {
    // Load stats before opening steps
    const stats = await API.getReviewStats(review.id).catch(() => null);
    _renderReviewSteps(container, review, stats);
  });
}

function _renderReviewSteps(container, review, stats) {
  const totalSteps = 5;
  let step = 1;
  const fd = {
    wins:            review.wins || '',
    struggles:       review.struggles || '',
    next_week_focus: review.next_week_focus || '',
    focus_task_ids:  review.focus_task_ids || '',
    mood:            review.mood || null,
  };
  const selectedTaskIds = new Set((review.focus_task_ids || '').split(',').filter(Boolean));
  let cachedTasks = null;

  async function getTasksOnce() {
    if (!cachedTasks) cachedTasks = await API.listTasks().catch(() => []);
    return cachedTasks;
  }

  function dots() {
    return Array.from({ length: totalSteps }, (_, i) => {
      const cls = i + 1 === step ? 'active' : i + 1 < step ? 'done' : '';
      return `<div class="review-step-dot ${cls}"></div>`;
    }).join('');
  }

  async function render() {
    const stepHtml = await buildStep(step);
    container.innerHTML = `
      <div class="review-step-indicator">${dots()}</div>
      <div id="review-step-body">${stepHtml}</div>
      <div class="review-nav">
        <button id="rv-back" ${step === 1 ? 'disabled' : ''}>Back</button>
        <span class="muted" style="font-size:11px;">Step ${step} of ${totalSteps}</span>
        <button id="rv-next" class="primary">${step === totalSteps ? 'Finish' : 'Next'}</button>
      </div>
    `;

    wireMoodButtons();
    wireTaskCheckboxes();

    container.querySelector('#rv-back').addEventListener('click', () => {
      save(); step--; render();
    });
    container.querySelector('#rv-next').addEventListener('click', async () => {
      save();
      if (step === totalSteps) {
        await submit();
      } else {
        step++;
        render();
      }
    });
  }

  async function buildStep(s) {
    if (s === 1) {
      return `
        <div style="font-size:13px; font-weight:600; margin-bottom:12px;">Last week at a glance</div>
        ${stats ? `
          <div class="grid grid-2" style="gap:8px; margin-bottom:12px;">
            <div class="card stat-card" style="padding:10px;">
              <div class="stat-label">Tasks completed</div>
              <div class="stat-value" style="font-size:20px;">${stats.tasks_completed}</div>
            </div>
            <div class="card stat-card" style="padding:10px;">
              <div class="stat-label">Habit hit rate</div>
              <div class="stat-value" style="font-size:20px;">${Math.round((stats.habits_hit_rate || 0) * 100)}%</div>
            </div>
            <div class="card stat-card" style="padding:10px;">
              <div class="stat-label">Tasks added</div>
              <div class="stat-value" style="font-size:20px;">${stats.tasks_added}</div>
            </div>
            <div class="card stat-card" style="padding:10px;">
              <div class="stat-label">Projects moved</div>
              <div class="stat-value" style="font-size:20px;">${stats.projects_moved}</div>
            </div>
          </div>
          ${stats.most_active_area ? `<div class="muted" style="font-size:12px;">Most active area: <strong style="color:var(--text-primary);">${escapeHtml(stats.most_active_area)}</strong></div>` : ''}
        ` : `<div class="muted" style="font-size:12px;">No stats yet -- keep using LifeOps daily.</div>`}
      `;
    }
    if (s === 2) return `
      <div style="font-size:13px; font-weight:600; margin-bottom:6px;">What went well this week?</div>
      <div class="muted" style="font-size:12px; margin-bottom:10px;">Be specific. A win is a win.</div>
      <textarea name="wins" rows="6" style="width:100%;" placeholder="- Shipped the auth flow&#10;- Went to the gym three times">${escapeHtml(fd.wins)}</textarea>
    `;
    if (s === 3) return `
      <div style="font-size:13px; font-weight:600; margin-bottom:6px;">What slowed you down?</div>
      <div class="muted" style="font-size:12px; margin-bottom:10px;">No judgment -- just honest observation.</div>
      <textarea name="struggles" rows="6" style="width:100%;" placeholder="- Kept context-switching&#10;- Missed the thesis chapter">${escapeHtml(fd.struggles)}</textarea>
    `;
    if (s === 4) {
      const tasks = await getTasksOnce();
      const todoTasks = tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').slice(0, 20);
      return `
        <div style="font-size:13px; font-weight:600; margin-bottom:6px;">What are the 3 priorities for next week?</div>
        <textarea name="next_week_focus" rows="4" style="width:100%; margin-bottom:12px;" placeholder="- Finish auth flow&#10;- Block mornings for deep work">${escapeHtml(fd.next_week_focus)}</textarea>
        ${todoTasks.length ? `
          <div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Pin up to 3 tasks as focus items (optional)</div>
          <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius); padding:6px;">
            ${todoTasks.map((t) => `
              <label style="display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--border); cursor:pointer; text-transform:none; font-size:12px; letter-spacing:0;">
                <input type="checkbox" class="focus-task-cb" value="${t.id}" style="width:auto;" ${selectedTaskIds.has(t.id) ? 'checked' : ''}>
                <span style="flex:1;">${escapeHtml(t.title)}</span>
                <span class="muted" style="font-size:10px;">${escapeHtml(t.project_title || '')}</span>
              </label>
            `).join('')}
          </div>
        ` : ''}
      `;
    }
    if (s === 5) return `
      <div style="font-size:13px; font-weight:600; margin-bottom:12px;">How did this week feel overall?</div>
      <div class="mood-selector" id="mood-selector">
        ${MOOD_OPTIONS.map((m) => `
          <button class="mood-btn${fd.mood === m.value ? ' selected' : ''}" data-value="${m.value}" type="button">${m.label}</button>
        `).join('')}
      </div>
    `;
    return '';
  }

  function save() {
    const body = container.querySelector('#review-step-body');
    if (!body) return;
    if (step === 2) fd.wins            = body.querySelector('[name="wins"]')?.value || '';
    if (step === 3) fd.struggles       = body.querySelector('[name="struggles"]')?.value || '';
    if (step === 4) fd.next_week_focus = body.querySelector('[name="next_week_focus"]')?.value || '';
  }

  function wireMoodButtons() {
    container.querySelectorAll('.mood-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        fd.mood = parseInt(btn.dataset.value);
        container.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  }

  function wireTaskCheckboxes() {
    container.querySelectorAll('.focus-task-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked && selectedTaskIds.size < 3) selectedTaskIds.add(cb.value);
        else { selectedTaskIds.delete(cb.value); cb.checked = false; }
        fd.focus_task_ids = [...selectedTaskIds].join(',');
      });
    });
  }

  async function submit() {
    const btn = container.querySelector('#rv-next');
    if (btn) btn.disabled = true;
    try {
      const saved = await API.saveReview(review.id, fd);
      container.innerHTML = `
        <div style="text-align:center; padding:24px 0;">
          <div style="font-family:var(--font-display); font-size:16px; margin-bottom:8px;">Review saved.</div>
          <div class="muted" style="font-size:12px;">You're set for next week.</div>
          <button id="rv-done-btn" style="margin-top:12px;">Close</button>
        </div>
      `;
      container.querySelector('#rv-done-btn').addEventListener('click', () => {
        review.completed_at = saved.completed_at || new Date().toISOString();
        review.wins = fd.wins;
        review.next_week_focus = fd.next_week_focus;
        review.mood = fd.mood;
        _renderReviewDone(container, review);
      });
    } catch (err) {
      if (btn) btn.disabled = false;
      container.insertAdjacentHTML('beforeend',
        `<div style="color:var(--danger); font-size:12px; margin-top:8px;">Error: ${escapeHtml(err.message)}</div>`);
    }
  }

  render();
}
