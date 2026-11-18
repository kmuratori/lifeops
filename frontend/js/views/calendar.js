// views/calendar.js — unified calendar for scheduled events, task occurrences, and project spans.

const CALENDAR_TYPES = [
  { key: 'event', label: 'Events' },
  { key: 'task', label: 'Tasks' },
  { key: 'project', label: 'Projects' },
];

let _calendarDate = new Date();
let _calendarView = 'month';
let _calendarFilters = { event: true, task: true, project: true, query: '' };
let _calendarDateFilter = { preset: 'all', start: '', end: '' };

function isoLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addCalendarDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function calendarRange(date, view) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (view === 'day') return [day, day];
  if (view === 'week') {
    const start = addCalendarDays(day, -((day.getDay() + 6) % 7));
    return [start, addCalendarDays(start, 6)];
  }
  if (view === 'agenda') return [day, addCalendarDays(day, 29)];
  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  const start = addCalendarDays(first, -((first.getDay() + 6) % 7));
  const last = new Date(day.getFullYear(), day.getMonth() + 1, 0);
  const end = addCalendarDays(last, 6 - ((last.getDay() + 6) % 7));
  return [start, end];
}

function filterCalendarItems(items, filters) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return items.filter((item) => filters[item.type] && (!query || [item.title, item.category, item.location, item.project_title, item.area_title].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
}

function calendarDateFilterMatches(item, date, filter) {
  const day = isoLocalDate(date);
  const today = isoLocalDate(new Date());
  if (filter.preset === 'today') return day === today;
  if (filter.preset === 'tomorrow') return day === isoLocalDate(addCalendarDays(new Date(), 1));
  if (filter.preset === 'next7') return day >= today && day <= isoLocalDate(addCalendarDays(new Date(), 6));
  if (filter.preset === 'custom') return (!filter.start || day >= filter.start) && (!filter.end || day <= filter.end);
  if (filter.preset === 'overdue') return item.type === 'task' && item.date === item.due_date && item.due_date < today && item.status !== 'done';
  return true;
}

function calendarTitle(date, view) {
  if (view === 'day') return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'week') {
    const [start, end] = calendarRange(date, view);
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (view === 'agenda') return `Next 30 days · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

async function renderCalendar(main) {
  main.innerHTML = `
    <div class="view-header calendar-heading">
      <div><p class="calendar-eyebrow">PLAN / REVIEW</p><h1>Calendar</h1></div>
      <button class="primary" id="new-event-btn">+ New event</button>
    </div>
    <section class="calendar-shell" aria-label="Calendar">
      <div class="calendar-toolbar">
        <div class="calendar-navigation" aria-label="Calendar date navigation">
          <button id="calendar-prev" aria-label="Previous period">←</button>
          <button id="calendar-today">Today</button>
          <button id="calendar-next" aria-label="Next period">→</button>
          <h2 id="calendar-title" aria-live="polite"></h2>
        </div>
        <div class="calendar-view-switch" role="group" aria-label="Calendar view">
          ${['month', 'week', 'day', 'agenda'].map((view) => `<button type="button" data-calendar-view="${view}" aria-pressed="${_calendarView === view}">${view}</button>`).join('')}
        </div>
      </div>
      <div class="calendar-filters">
        <div class="calendar-type-filters" role="group" aria-label="Show calendar item types">
          ${CALENDAR_TYPES.map(({ key, label }) => `<label class="calendar-filter calendar-filter-${key}"><input type="checkbox" data-calendar-type="${key}" ${_calendarFilters[key] ? 'checked' : ''}><span class="calendar-filter-dot" aria-hidden="true"></span>${label}</label>`).join('')}
        </div>
        <label class="calendar-search"><span class="sr-only">Search calendar</span><input id="calendar-search" type="search" placeholder="Search events, tasks, projects" value="${escapeHtml(_calendarFilters.query)}"></label>
      </div>
      <div class="calendar-date-filter-row">
        <div class="calendar-date-filter-buttons" role="group" aria-label="Filter dates within the current view">
          ${[['all', 'All dates'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['next7', 'Next 7 days'], ['overdue', 'Overdue'], ['custom', 'Custom range']].map(([preset, label]) => `<button type="button" class="calendar-date-filter-button" data-date-filter="${preset}" aria-pressed="${_calendarDateFilter.preset === preset}">${label}</button>`).join('')}
        </div>
        <div class="calendar-custom-range" ${_calendarDateFilter.preset === 'custom' ? '' : 'hidden'}>
          <label>From <input type="date" id="calendar-filter-start" value="${escapeHtml(_calendarDateFilter.start)}"></label>
          <label>To <input type="date" id="calendar-filter-end" value="${escapeHtml(_calendarDateFilter.end)}"></label>
        </div>
        <p class="calendar-filter-hint">Date filters narrow results inside the selected view. Overdue shows open due items on visible dates.</p>
      </div>
      <div id="calendar-count" class="calendar-count" aria-live="polite"></div>
      <div id="calendar-content" aria-live="polite"></div>
    </section>`;

  const content = document.getElementById('calendar-content');
  const title = document.getElementById('calendar-title');
  const checkedTypes = () => CALENDAR_TYPES.filter(({ key }) => _calendarFilters[key]).map(({ key }) => key);

  function renderItem(item, date) {
    const rawColor = item.color || item.area_color || '';
    const color = /^#[\da-f]{6}$/i.test(rawColor) ? rawColor : 'var(--accent)';
    const timing = item.type === 'event' ? eventTimeLabel(item, date) : item.type === 'task' ? (item.occurrence === 'planning' ? 'PLANNED' : item.occurrence === 'due' ? 'DUE' : 'PLAN + DUE') : item.status || '';
    return `<button type="button" class="calendar-item calendar-item-${item.type}" data-calendar-item="${escapeHtml(item.type)}" data-item-id="${escapeHtml(item.id)}" title="${escapeHtml(`${item.title}${timing ? ` · ${timing}` : ''}`)}" style="--item-color:${escapeHtml(color)}"><span class="calendar-item-time">${escapeHtml(timing)}</span><span class="calendar-item-title">${escapeHtml(item.title)}</span></button>`;
  }

  function itemsForDate(items, date) {
    const key = isoLocalDate(date);
    return items.filter((item) => {
      if (!calendarDateFilterMatches(item, date, _calendarDateFilter)) return false;
      if (item.type === 'task') return item.date === key;
      if (item.type === 'project') return (!item.start_date || item.start_date <= key) && (!item.target_date || item.target_date >= key);
      if (item.is_all_day) return item.start_date <= key && item.end_date > key;
      const start = (item.start_at || '').slice(0, 10);
      const end = (item.end_at || '').slice(0, 10);
      return start <= key && end >= key;
    }).sort((a, b) => {
      const order = { event: 0, task: 1, project: 2 };
      return order[a.type] - order[b.type] || (a.start_at || '').localeCompare(b.start_at || '') || a.title.localeCompare(b.title);
    });
  }

  function renderMonth(items, start, end) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dates = [];
    for (let date = start; date <= end; date = addCalendarDays(date, 1)) dates.push(date);
    return `<div class="calendar-weekdays">${weekdays.map((day) => `<div>${day}</div>`).join('')}</div><div class="calendar-month-grid">${dates.map((date) => {
      const key = isoLocalDate(date);
      const daily = itemsForDate(items, date);
      const inMonth = date.getMonth() === _calendarDate.getMonth();
      return `<section class="calendar-day-cell ${inMonth ? '' : 'is-outside-month'} ${key === isoLocalDate(new Date()) ? 'is-today' : ''}" aria-label="${escapeHtml(date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}"><button type="button" class="calendar-day-number" data-calendar-date="${key}" aria-label="Open ${key}">${date.getDate()}</button><div class="calendar-day-items">${daily.slice(0, 4).map((item) => renderItem(item, date)).join('')}${daily.length > 4 ? `<span class="calendar-overflow">+${daily.length - 4} more</span>` : ''}</div></section>`;
    }).join('')}</div>`;
  }

  function renderWeek(items, start, end) {
    const dates = [];
    for (let date = start; date <= end; date = addCalendarDays(date, 1)) dates.push(date);
    return `<div class="calendar-week-grid">${dates.map((date) => {
      const key = isoLocalDate(date);
      const daily = itemsForDate(items, date);
      return `<section class="calendar-week-column ${key === isoLocalDate(new Date()) ? 'is-today' : ''}"><button class="calendar-week-heading" type="button" data-calendar-date="${key}"><span>${date.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>${date.getDate()}</strong></button><div class="calendar-week-items">${daily.length ? daily.map((item) => renderItem(item, date)).join('') : '<span class="calendar-no-items">Nothing scheduled</span>'}</div></section>`;
    }).join('')}</div>`;
  }

  function renderDay(items, date) {
    const daily = itemsForDate(items, date);
    const allDay = daily.filter((item) => item.type !== 'event' || item.is_all_day);
    const timed = daily.filter((item) => item.type === 'event' && !item.is_all_day);
    return `<div class="calendar-day-view">${allDay.length ? `<section class="calendar-day-block"><h3>All day</h3>${allDay.map((item) => renderItem(item, date)).join('')}</section>` : ''}${timed.length ? `<section class="calendar-day-block"><h3>Schedule</h3>${timed.map((item) => renderItem(item, date)).join('')}</section>` : ''}${!daily.length ? '<div class="calendar-empty"><span>NO PLANS YET</span><p>A clear day is still a plan.</p><button class="primary" id="empty-new-event">Add an event</button></div>' : ''}</div>`;
  }

  function renderAgenda(items, start, end) {
    const days = [];
    for (let date = start; date <= end; date = addCalendarDays(date, 1)) {
      const daily = itemsForDate(items, date);
      if (daily.length || _calendarFilters.query) days.push({ date, daily });
    }
    if (!days.length) return '<div class="calendar-empty"><span>NO PLANS FOUND</span><p>Nothing scheduled in this range.</p></div>';
    return `<div class="calendar-agenda">${days.map(({ date, daily }) => `<section class="calendar-agenda-day ${isoLocalDate(date) === isoLocalDate(new Date()) ? 'is-today' : ''}"><h3><span>${date.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong></h3><div>${daily.map((item) => renderItem(item, date)).join('') || '<p class="calendar-no-items">No matching items</p>'}</div></section>`).join('')}</div>`;
  }

  async function draw() {
    const [start, end] = calendarRange(_calendarDate, _calendarView);
    title.textContent = calendarTitle(_calendarDate, _calendarView);
    document.querySelectorAll('[data-calendar-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.calendarView === _calendarView)));
    const types = checkedTypes();
    content.innerHTML = '<div class="calendar-loading">Loading schedule…</div>';
    if (!types.length) {
      content.innerHTML = '<div class="calendar-empty"><span>NOTHING SELECTED</span><p>Choose at least one type above.</p></div>';
      document.getElementById('calendar-count').textContent = '';
      return;
    }
    try {
      const result = await API.getCalendarItems(isoLocalDate(start), isoLocalDate(end), types);
      const items = filterCalendarItems(result.items || [], _calendarFilters);
      const matchingItems = new Set();
      for (let date = start; date <= end; date = addCalendarDays(date, 1)) {
        itemsForDate(items, date).forEach((item) => matchingItems.add(`${item.type}:${item.id}`));
      }
      const filterLabel = { today: 'Today', tomorrow: 'Tomorrow', next7: 'Next 7 days', overdue: 'Overdue', custom: 'Custom range' }[_calendarDateFilter.preset];
      document.getElementById('calendar-count').textContent = `${matchingItems.size} item${matchingItems.size === 1 ? '' : 's'} · ${types.length} type${types.length === 1 ? '' : 's'} shown${filterLabel ? ` · ${filterLabel}` : ''}`;
      if (_calendarView === 'month') content.innerHTML = renderMonth(items, start, end);
      else if (_calendarView === 'week') content.innerHTML = renderWeek(items, start, end);
      else if (_calendarView === 'day') content.innerHTML = renderDay(items, start);
      else content.innerHTML = renderAgenda(items, start, end);
      content.querySelectorAll('[data-calendar-date]').forEach((button) => button.addEventListener('click', () => {
        _calendarDate = new Date(`${button.dataset.calendarDate}T12:00:00`);
        _calendarView = 'day';
        draw();
      }));
      content.querySelectorAll('[data-calendar-item]').forEach((button) => button.addEventListener('click', () => openCalendarItem(button.dataset.calendarItem, button.dataset.itemId, items)));
      document.getElementById('empty-new-event')?.addEventListener('click', () => openEventModal(null, isoLocalDate(_calendarDate)));
    } catch (error) {
      content.innerHTML = `<div class="calendar-empty" role="alert"><span>CALENDAR UNAVAILABLE</span><p>${escapeHtml(error.message)}</p><button id="calendar-retry">Try again</button></div>`;
      document.getElementById('calendar-retry').addEventListener('click', draw);
    }
  }

  document.getElementById('calendar-prev').addEventListener('click', () => moveCalendar(-1));
  document.getElementById('calendar-next').addEventListener('click', () => moveCalendar(1));
  document.getElementById('calendar-today').addEventListener('click', () => { _calendarDate = new Date(); draw(); });
  document.getElementById('new-event-btn').addEventListener('click', () => openEventModal(null, isoLocalDate(_calendarDate)));
  document.querySelectorAll('[data-calendar-view]').forEach((button) => button.addEventListener('click', () => { _calendarView = button.dataset.calendarView; draw(); }));
  document.querySelectorAll('[data-calendar-type]').forEach((input) => input.addEventListener('change', () => { _calendarFilters[input.dataset.calendarType] = input.checked; draw(); }));
  document.getElementById('calendar-search').addEventListener('input', (event) => { _calendarFilters.query = event.target.value; draw(); });
  document.querySelectorAll('[data-date-filter]').forEach((button) => button.addEventListener('click', () => {
    _calendarDateFilter.preset = button.dataset.dateFilter;
    if (_calendarDateFilter.preset !== 'custom') {
      _calendarDateFilter.start = '';
      _calendarDateFilter.end = '';
      document.getElementById('calendar-filter-start').value = '';
      document.getElementById('calendar-filter-end').value = '';
    }
    document.querySelectorAll('[data-date-filter]').forEach((filterButton) => filterButton.setAttribute('aria-pressed', String(filterButton.dataset.dateFilter === _calendarDateFilter.preset)));
    document.querySelector('.calendar-custom-range').hidden = _calendarDateFilter.preset !== 'custom';
    draw();
  }));
  document.getElementById('calendar-filter-start').addEventListener('change', (event) => { _calendarDateFilter.start = event.target.value; draw(); });
  document.getElementById('calendar-filter-end').addEventListener('change', (event) => { _calendarDateFilter.end = event.target.value; draw(); });

  function moveCalendar(direction) {
    const step = _calendarView === 'month' ? 'month' : _calendarView === 'week' ? 'week' : 'day';
    if (step === 'month') _calendarDate = new Date(_calendarDate.getFullYear(), _calendarDate.getMonth() + direction, 1);
    else _calendarDate = addCalendarDays(_calendarDate, direction * (step === 'week' ? 7 : _calendarView === 'agenda' ? 30 : 1));
    draw();
  }

  await draw();
}

function eventTimeLabel(item, date) {
  if (item.type === 'event') {
    if (item.is_all_day) return 'ALL DAY';
    const start = new Date(item.start_at);
    const end = new Date(item.end_at);
    if (isoLocalDate(start) !== isoLocalDate(date)) return 'CONTINUES';
    const format = (value) => value.toLocaleTimeString(undefined, { hour: 'numeric', minute: value.getMinutes() ? '2-digit' : undefined });
    return `${format(start)}${isoLocalDate(end) === isoLocalDate(start) ? `–${format(end)}` : ''}`;
  }
  return item.type === 'task' ? (item.occurrence === 'planning' ? 'PLANNED' : item.occurrence === 'due' ? 'DUE' : 'PLAN + DUE') : item.status || '';
}

function openCalendarItem(type, id, items) {
  const item = items.find((candidate) => candidate.type === type && candidate.id === id);
  if (!item) return;
  if (type === 'event') return openEventModal(item);
  window._pendingDetailOpen = { type, id };
  window.location.hash = type === 'task' ? '/tasks' : '/projects';
}

function openEventModal(event = null, defaultDate = isoLocalDate(_calendarDate)) {
  const editing = Boolean(event);
  const allDay = event ? event.is_all_day : true;
  const startDate = event?.start_date || event?.start_at?.slice(0, 10) || defaultDate;
  const endDate = event?.end_date ? addCalendarDays(new Date(`${event.end_date}T12:00:00`), -1) : event?.end_at ? new Date(event.end_at) : new Date(`${defaultDate}T12:00:00`);
  const localInputValue = (iso) => {
    const date = new Date(iso);
    return `${isoLocalDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  showModal(`
    <h2>${editing ? 'Edit event' : 'New event'}</h2>
    <form id="calendar-event-form" class="calendar-event-form">
      <div class="field"><label for="event-title">Title</label><input id="event-title" name="title" required maxlength="200" value="${escapeHtml(event?.title || '')}" placeholder="Focus time, appointment…"></div>
      <div class="field"><label for="event-description">Description</label><textarea id="event-description" name="description" rows="2">${escapeHtml(event?.description || '')}</textarea></div>
      <label class="calendar-all-day"><input type="checkbox" name="is_all_day" ${allDay ? 'checked' : ''}><span>All-day event</span></label>
      <div class="grid grid-2 calendar-timed-fields" ${allDay ? 'hidden' : ''}>
        <div class="field"><label for="event-start-at">Starts</label><input id="event-start-at" name="start_at" type="datetime-local" value="${event?.start_at ? escapeHtml(localInputValue(event.start_at)) : `${defaultDate}T09:00`}"></div>
        <div class="field"><label for="event-end-at">Ends</label><input id="event-end-at" name="end_at" type="datetime-local" value="${event?.end_at ? escapeHtml(localInputValue(event.end_at)) : `${defaultDate}T10:00`}"></div>
      </div>
      <div class="grid grid-2 calendar-date-fields" ${allDay ? '' : 'hidden'}>
        <div class="field"><label for="event-start-date">First day</label><input id="event-start-date" name="start_date" type="date" value="${escapeHtml(startDate)}" required></div>
        <div class="field"><label for="event-end-date-display">Last day</label><input id="event-end-date-display" name="end_date_display" type="date" value="${escapeHtml(isoLocalDate(endDate))}" required></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label for="event-location">Location</label><input id="event-location" name="location" value="${escapeHtml(event?.location || '')}" maxlength="200"></div>
        <div class="field"><label for="event-category">Category</label><input id="event-category" name="category" value="${escapeHtml(event?.category || '')}" maxlength="80" placeholder="Personal, work…"></div>
      </div>
      <div class="field calendar-color-field"><label for="event-color">Color</label><input id="event-color" name="color" type="color" value="${escapeHtml(event?.color || '#5e9cf5')}"></div>
      <div class="calendar-form-error" id="event-form-error" role="alert" aria-live="polite"></div>
      <div class="calendar-modal-actions">
        ${editing ? '<button type="button" id="delete-calendar-event" class="danger-btn">Delete</button>' : '<span></span>'}
        <div><button type="button" id="cancel-calendar-event">Cancel</button><button type="submit" class="primary">${editing ? 'Save event' : 'Create event'}</button></div>
      </div>
    </form>`);

  const form = document.getElementById('calendar-event-form');
  const allDayInput = form.elements.is_all_day;
  const syncTimingFields = () => {
    const dateFields = form.querySelector('.calendar-date-fields');
    const timedFields = form.querySelector('.calendar-timed-fields');
    dateFields.hidden = !allDayInput.checked;
    timedFields.hidden = allDayInput.checked;
    dateFields.querySelectorAll('input').forEach((input) => {
      input.disabled = !allDayInput.checked;
      input.required = allDayInput.checked;
    });
    timedFields.querySelectorAll('input').forEach((input) => {
      input.disabled = allDayInput.checked;
      input.required = !allDayInput.checked;
    });
  };
  allDayInput.addEventListener('change', syncTimingFields);
  syncTimingFields();
  document.getElementById('cancel-calendar-event').addEventListener('click', closeModal);
  if (editing) document.getElementById('delete-calendar-event').addEventListener('click', async () => {
    if (!(await appConfirm(`Delete “${event.title}”?`, { title: 'Delete event', confirmText: 'Delete', danger: true }))) return;
    try {
      await API.deleteEvent(event.id);
      closeModal();
      Router.resolve();
    } catch (error) {
      appAlert(error.message, { title: 'Could not delete event' });
    }
  });
  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    const finish = beginFormSubmission(form);
    if (!finish) return;
    const error = document.getElementById('event-form-error');
    const values = new FormData(form);
    const payload = {
      title: values.get('title').trim(),
      description: values.get('description').trim() || null,
      is_all_day: allDayInput.checked,
      location: values.get('location').trim() || null,
      category: values.get('category').trim() || null,
      color: values.get('color') || null,
    };
    if (payload.is_all_day) {
      const first = values.get('start_date');
      const last = values.get('end_date_display');
      if (!first || !last || last < first) {
        error.textContent = 'Choose a last day on or after the first day.';
        finish();
        return;
      }
      payload.start_at = null;
      payload.end_at = null;
      payload.start_date = first;
      payload.end_date = isoLocalDate(addCalendarDays(new Date(`${last}T12:00:00`), 1));
    } else {
      const start = values.get('start_at');
      const end = values.get('end_at');
      if (!start || !end || new Date(end) <= new Date(start)) {
        error.textContent = 'The end time must be later than the start time.';
        finish();
        return;
      }
      payload.start_date = null;
      payload.end_date = null;
      payload.start_at = new Date(start).toISOString();
      payload.end_at = new Date(end).toISOString();
    }
    try {
      if (editing) await API.updateEvent(event.id, payload);
      else await API.createEvent(payload);
      closeModal();
      Router.resolve();
    } catch (saveError) {
      error.textContent = saveError.message;
    } finally {
      finish();
    }
  });
}

Router.register('/calendar', renderCalendar);
