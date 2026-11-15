const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/views/habits.js'), 'utf8');

function makeRuntime() {
  const document = {
    activeElement: null,
    addEventListener() {},
    getElementById() { return null; },
  };
  const context = vm.createContext({
    document,
    window: {},
    Router: { register() {} },
    API: {},
    localStorage: { getItem() { return 'list'; }, setItem() {} },
    escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'); },
    formatTooltipDate(value) { return value; },
    appAlert() {},
  });
  vm.runInContext(source, context, { filename: 'habits.js' });
  context.showUndoSnackbar = () => {};
  return { context, document };
}

class FakeToggle {
  constructor() {
    this.listeners = {};
    this.dataset = { habitId: 'h1', kind: 'bool' };
    this.clicks = 0;
    this.disabled = false;
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { this.clicks += 1; }
}

class FakeCell {
  constructor(row, index, document, { disabled = false, tabIndex = -1 } = {}) {
    this.row = row;
    this.index = index;
    this.document = document;
    this.disabled = disabled;
    this.tabIndex = tabIndex;
    this.listeners = {};
    this.classNames = new Set();
    this.classList = { contains: (name) => this.classNames.has(name) };
    this.dataset = {
      date: `2026-10-${String(20 + index).padStart(2, '0')}`,
      done: 'false',
      value: '',
      scheduled: 'true',
      missed: 'false',
    };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  closest(selector) {
    if (selector === '.habit-week-cell') return this;
    if (selector === '.habit-row') return this.row;
    return null;
  }
  focus() { this.document.activeElement = this; }
}

class FakeRow {
  constructor(id) {
    this.dataset = { habitId: id };
    this.listeners = {};
    this.cells = [];
    this.toggle = new FakeToggle();
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelectorAll(selector) {
    if (selector.startsWith('.habit-week-cell:not(:disabled)')) return this.cells.filter((cell) => !cell.disabled);
    if (selector === '.habit-week-cell') return this.cells;
    return [];
  }
  querySelector(selector) {
    if (selector === '.habit-toggle') return this.toggle;
    return null;
  }
  closest(selector) { return selector === '.habit-row' ? this : null; }
}

class FakeList {
  constructor(rows) {
    this.rows = rows;
    this.listeners = {};
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelectorAll(selector) {
    if (selector === '.habit-row') return this.rows;
    const cells = this.rows.flatMap((row) => row.cells);
    if (selector === '.habit-week-cell[tabindex="0"]') return cells.filter((cell) => cell.tabIndex === 0);
    if (selector === '.habit-week-cell') return cells;
    return [];
  }
}

function makeGrid(document, rowCount = 2, dayCount = 3) {
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => new FakeRow(`h${rowIndex + 1}`));
  rows.forEach((row) => {
    row.cells = Array.from({ length: dayCount }, (_, dayIndex) => new FakeCell(row, dayIndex, document, {
      tabIndex: row === rows[0] && dayIndex === 0 ? 0 : -1,
    }));
  });
  return { rows, list: new FakeList(rows) };
}

function emitKey(list, key, target, document) {
  let prevented = false;
  list.listeners.keydown({
    key,
    target,
    preventDefault() { prevented = true; },
  });
  return prevented;
}

test('arrow keys move focus across days and habit rows with a single tab stop', () => {
  const { context, document } = makeRuntime();
  const { rows, list } = makeGrid(document);
  vm.runInContext('wireKeyboardNav', context)(list, rows.map((row) => ({ id: row.dataset.habitId })), []);
  rows[0].cells[0].focus();

  assert.equal(emitKey(list, 'ArrowRight', rows[0].cells[0], document), true);
  assert.equal(document.activeElement, rows[0].cells[1]);
  assert.equal(rows[0].cells[0].tabIndex, -1);
  assert.equal(rows[0].cells[1].tabIndex, 0);

  assert.equal(emitKey(list, 'ArrowDown', rows[0].cells[1], document), true);
  assert.equal(document.activeElement, rows[1].cells[1]);
  assert.equal(rows[0].cells[1].tabIndex, -1);
  assert.equal(rows[1].cells[1].tabIndex, 0);
});

test('Enter and Space activate the habit row control when the row, not a day button, has focus', () => {
  const { context, document } = makeRuntime();
  const { rows, list } = makeGrid(document, 1, 1);
  vm.runInContext('wireKeyboardNav', context)(list, [{ id: 'h1' }], []);
  document.activeElement = rows[0];

  assert.equal(emitKey(list, 'Enter', rows[0], document), true);
  assert.equal(rows[0].toggle.clicks, 1);
  assert.equal(emitKey(list, ' ', rows[0], document), true);
  assert.equal(rows[0].toggle.clicks, 2);
});

test('editable controls inside the list do not activate a habit control when typing Space or Enter', () => {
  const { context, document } = makeRuntime();
  const { rows, list } = makeGrid(document, 1, 1);
  vm.runInContext('wireKeyboardNav', context)(list, [{ id: 'h1' }], []);
  const input = { closest() { return null; } };
  document.activeElement = input;

  assert.equal(emitKey(list, ' ', input, document), false);
  assert.equal(emitKey(list, 'Enter', input, document), false);
  assert.equal(rows[0].toggle.clicks, 0);
});

test('weekly buttons distinguish completed, missed, today, and unscheduled states accessibly', () => {
  const { context } = makeRuntime();
  const today = vm.runInContext('getTodayIso()', context);
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const missedDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  const habit = { title: 'Walk', habit_type: 'yes_no' };
  const render = (day) => vm.runInContext(
    `habitWeekCellHtml(${JSON.stringify(habit)}, ${JSON.stringify(day)}, false)`,
    context,
  );

  const missed = render({ date: missedDate, scheduled: true, done: false, value: null });
  const unscheduled = render({ date: missedDate, scheduled: false, done: false, value: null });
  const completed = render({ date: missedDate, scheduled: true, done: true, value: null });
  const todayHtml = render({ date: today, scheduled: true, done: false, value: null });

  assert.match(missed, /is-missed/);
  assert.match(missed, /missed/);
  assert.match(unscheduled, /not-scheduled/);
  assert.doesNotMatch(unscheduled, /is-missed/);
  assert.match(completed, /is-complete/);
  assert.match(completed, /aria-pressed="true"/);
  assert.match(todayHtml, /is-today/);
  assert.match(todayHtml, /aria-pressed="false"/);
  assert.match(todayHtml, /^<button/);

  const styles = fs.readFileSync(path.join(__dirname, '../frontend/css/components.css'), 'utf8');
  assert.match(styles, /\.habit-week-cell:focus-visible/);
});

test('habit completion failures report an error and refresh the rendered state', async () => {
  const { context, document } = makeRuntime();
  const { rows, list } = makeGrid(document, 1, 1);
  const row = rows[0];
  const cell = row.cells[0];
  cell.dataset.date = '2026-10-21';
  let refreshes = 0;
  let reported = '';
  context.API.logHabit = async () => { throw new Error('offline'); };
  context.appAlert = (message) => { reported = message; };
  vm.runInContext('wireHabitRows', context)(
    list,
    [{ id: 'h1', title: 'Walk', habit_type: 'yes_no', done_today: false }],
    [],
    () => { refreshes += 1; },
  );

  await cell.listeners.click({ stopPropagation() {} });
  assert.equal(reported, 'offline');
  assert.equal(refreshes, 1);
});
