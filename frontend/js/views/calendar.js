// views/calendar.js -- Feature 2: Calendar View

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed

function calendarLocalDateIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function renderCalendar(main) {
  const today    = new Date();
  const monthStr = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}`;
  const calData  = await API.getCalendar(monthStr);

  const monthName = new Date(_calYear, _calMonth, 1)
    .toLocaleString('default', { month: 'long' });
  const isNarrow  = window.innerWidth < 600;

  main.innerHTML = `
    <div class="view-header">
      <h1>Calendar</h1>
      <div style="display:flex; gap:8px; align-items:center;">
        <button id="cal-prev">&lt;</button>
        <span style="font-family:var(--font-display); font-size:13px; min-width:130px; text-align:center;">${monthName} ${_calYear}</span>
        <button id="cal-next">&gt;</button>
        <button id="cal-today">Today</button>
      </div>
    </div>
    <div id="cal-body"></div>
  `;

  document.getElementById('cal-prev').addEventListener('click', () => {
    _calMonth--;
    if (_calMonth < 0) { _calMonth = 11; _calYear--; }
    renderCalendar(main);
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    _calMonth++;
    if (_calMonth > 11) { _calMonth = 0; _calYear++; }
    renderCalendar(main);
  });
  document.getElementById('cal-today').addEventListener('click', () => {
    _calYear  = today.getFullYear();
    _calMonth = today.getMonth();
    renderCalendar(main);
  });

  const calBody = document.getElementById('cal-body');
  if (isNarrow) {
    renderAgenda(calBody, calData, today);
  } else {
    renderGrid(calBody, calData, today);
  }
}

function renderGrid(container, calData, today) {
  const todayStr = calendarLocalDateIso(today);
  const days     = Object.keys(calData).sort();
  if (!days.length) return;

  const firstDate = new Date(days[0] + 'T00:00:00');
  const startDow  = (firstDate.getDay() + 6) % 7; // 0=Mon

  const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Header row is separate so it doesn't participate in grid-auto-rows
  container.innerHTML = `
    <div class="cal-header-row">
      ${dayHeaders.map((d) => `<div class="cal-header-cell">${d}</div>`).join('')}
    </div>
    <div class="cal-grid">
      ${Array(startDow).fill('<div class="cal-cell cal-empty"></div>').join('')}
      ${days.map((dateStr) => {
        const items   = calData[dateStr];
        const dayNum  = parseInt(dateStr.slice(8));
        const isToday = dateStr === todayStr;
        const isPast  = dateStr < todayStr;

        const allItems = [
          ...items.tasks.map((t)   => ({ ...t, _type: 'task'    })),
          ...items.projects.map((p) => ({ ...p, _type: 'project' })),
          ...items.habits.map((h)  => ({ ...h, _type: 'habit'   })),
        ];
        const shown = allItems.slice(0, 3);
        const extra = allItems.length - 3;

        return `
          <div class="cal-cell${isToday ? ' cal-today' : ''}" data-date="${dateStr}" data-has-items="${allItems.length > 0}">
            <div class="cal-day-num">${dayNum}</div>
            <div class="cal-items">
              ${shown.map((item) => calPill(item, isPast)).join('')}
              ${extra > 0 ? `<div class="cal-more" data-date="${dateStr}">+${extra} more</div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Click on any cell -> modal with all items for that day
  container.querySelectorAll('.cal-cell:not(.cal-empty)').forEach((cell) => {
    cell.addEventListener('click', (e) => {
      // Let the +N more button handle its own propagation
      if (e.target.classList.contains('cal-more')) return;
      const dateStr  = cell.dataset.date;
      const items    = calData[dateStr];
      const isPast   = dateStr < todayStr;
      const allItems = [
        ...items.tasks.map((t)   => ({ ...t, _type: 'task'    })),
        ...items.projects.map((p) => ({ ...p, _type: 'project' })),
        ...items.habits.map((h)  => ({ ...h, _type: 'habit'   })),
      ];
      openDayModal(dateStr, allItems, isPast);
    });
  });

  // +N more button also opens the same modal
  container.querySelectorAll('.cal-more').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dateStr  = el.dataset.date;
      const items    = calData[dateStr];
      const isPast   = dateStr < todayStr;
      const allItems = [
        ...items.tasks.map((t)   => ({ ...t, _type: 'task'    })),
        ...items.projects.map((p) => ({ ...p, _type: 'project' })),
        ...items.habits.map((h)  => ({ ...h, _type: 'habit'   })),
      ];
      openDayModal(dateStr, allItems, isPast);
    });
  });
}

function openDayModal(dateStr, allItems, isPast) {
  const d = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  showModal(`
    <h2 style="margin-bottom:4px;">${label}</h2>
    ${!allItems.length
      ? `<div class="muted" style="font-size:12px; padding:16px 0;">Nothing scheduled for this day.</div>`
      : `<div style="display:flex; flex-direction:column; gap:4px; margin-top:12px;">
          ${allItems.map((item) => calPillFull(item, isPast)).join('')}
        </div>`}
    <div style="display:flex; justify-content:flex-end; margin-top:16px;">
      <button id="cancel-modal">Close</button>
    </div>
  `);
  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  // Wire up deep-link navigation for each pill
  document.querySelectorAll('.cal-pill-full-link').forEach((el) => {
    el.addEventListener('mouseenter', () => { el.style.opacity = '0.75'; });
    el.addEventListener('mouseleave', () => { el.style.opacity = el.dataset.done === 'true' ? '0.5' : '1'; });
    el.addEventListener('click', () => {
      _navigateToItem(el.dataset.itemType, el.dataset.itemId);
    });
  });
}

// Compact pill -- title clips to one line, never breaks cell width
function calPill(item, isPast) {
  const color   = item.area_color || item.color || 'var(--border)';
  const done    = (item._type === 'task'  && item.status === 'done') ||
                  (item._type === 'habit' && item.done);
  const overdue = item._type === 'task' && isPast && item.status !== 'done';

  return `<div class="cal-pill" style="border-left-color:${overdue ? 'var(--danger)' : color}; opacity:${done ? 0.45 : 1};">
    <div class="cal-pill-dot" style="background:${color};"></div>
    <span class="cal-pill-title">${escapeHtml(item.title)}</span>
  </div>`;
}

// Full-width pill used inside the day modal — clickable, navigates to the item's page
function calPillFull(item, isPast) {
  const color   = item.area_color || item.color || 'var(--border)';
  const done    = (item._type === 'task'  && item.status === 'done') ||
                  (item._type === 'habit' && item.done);
  const overdue = item._type === 'task' && isPast && item.status !== 'done';
  const typeTag = item._type === 'task'
    ? `<span class="badge priority-${item.priority}" style="margin-left:auto;">${item.priority}</span>`
    : item._type === 'habit'
      ? `<span class="muted" style="margin-left:auto; font-size:10px;">${done ? 'done' : 'habit'}</span>`
      : `<span class="muted" style="margin-left:auto; font-size:10px;">project</span>`;

  return `<div class="cal-pill-full-link" data-item-id="${item.id}" data-item-type="${item._type}"
    style="display:flex; align-items:center; gap:6px; padding:5px 8px;
    border-left:2px solid ${overdue ? 'var(--danger)' : color};
    background:var(--surface-raised); border-radius:var(--radius);
    opacity:${done ? 0.5 : 1}; cursor:pointer; transition:opacity 0.1s;"
    title="Open ${item._type}">
    <span style="flex:1; font-size:12px;">${escapeHtml(item.title)}</span>
    ${typeTag}
    <span class="muted" style="font-size:10px;">Open</span>
  </div>`;
}

function _navigateToItem(type, id) {
  const route = type === 'task' ? 'tasks' : type === 'habit' ? 'habits' : 'projects';
  window._pendingDetailOpen = { type, id };
  closeModal();
  window.location.hash = '#/' + route;
}

function renderAgenda(container, calData, today) {
  const todayStr = calendarLocalDateIso(today);
  const days = Object.keys(calData).sort().filter((d) => {
    const items = calData[d];
    return items.tasks.length || items.projects.length || items.habits.length;
  });

  if (!days.length) {
    container.innerHTML = `<div class="empty-state">No events this month.</div>`;
    return;
  }

  container.innerHTML = days.map((dateStr) => {
    const items    = calData[dateStr];
    const isToday  = dateStr === todayStr;
    const isPast   = dateStr < todayStr;
    const d        = new Date(dateStr + 'T00:00:00');
    const label    = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const allItems = [
      ...items.tasks.map((t)   => ({ ...t, _type: 'task'    })),
      ...items.projects.map((p) => ({ ...p, _type: 'project' })),
      ...items.habits.map((h)  => ({ ...h, _type: 'habit'   })),
    ];
    return `
      <details class="agenda-day${isToday ? ' agenda-today' : ''}" ${isToday ? 'open' : ''}>
        <summary>${label} <span class="muted">(${allItems.length})</span></summary>
        <div style="padding:6px 0; display:flex; flex-direction:column; gap:4px;">
          ${allItems.map((item) => calPillFull(item, isPast)).join('')}
        </div>
      </details>
    `;
  }).join('');
}

Router.register('/calendar', renderCalendar);
