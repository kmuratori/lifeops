const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/views/calendar.js'), 'utf8');
const context = vm.createContext({
  Router: { register() {} },
  Date,
  URLSearchParams,
  console,
});
vm.runInContext(source, context);

function evaluate(expression) {
  return vm.runInContext(expression, context);
}

test('month range includes complete Monday-first weeks', () => {
  assert.deepEqual(Array.from(evaluate("calendarRange(new Date(2025, 1, 12), 'month').map(isoLocalDate)")), ['2025-01-27', '2025-03-02']);
});

test('week range starts Monday and includes Sunday', () => {
  assert.deepEqual(Array.from(evaluate("calendarRange(new Date(2025, 10, 16), 'week').map(isoLocalDate)")), ['2025-11-10', '2025-11-16']);
});

test('day and agenda ranges respect the selected date', () => {
  assert.deepEqual(Array.from(evaluate("calendarRange(new Date(2025, 4, 8), 'day').map(isoLocalDate)")), ['2025-05-08', '2025-05-08']);
  assert.deepEqual(Array.from(evaluate("calendarRange(new Date(2025, 4, 8), 'agenda').map(isoLocalDate)")), ['2025-05-08', '2025-06-06']);
});

test('type toggles and search filter independently', () => {
  const items = [
    { type: 'event', title: 'Planning session', category: 'work' },
    { type: 'task', title: 'Write report' },
    { type: 'project', title: 'Garden renovation', area_title: 'Home' },
  ];
  const filters = { event: false, task: true, project: true, query: 'home' };
  assert.deepEqual(Array.from(evaluate(`filterCalendarItems(${JSON.stringify(items)}, ${JSON.stringify(filters)})`).map((item) => item.title)), ['Garden renovation']);
});

test('date quick filters constrain the active view without changing its range', () => {
  const today = evaluate('isoLocalDate(new Date())');
  const tomorrow = evaluate('isoLocalDate(addCalendarDays(new Date(), 1))');
  const todayDate = `new Date('${today}T12:00:00')`;
  const tomorrowDate = `new Date('${tomorrow}T12:00:00')`;
  const event = { type: 'event', date: today };
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(event)}, ${todayDate}, { preset: 'today' })`), true);
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(event)}, ${todayDate}, { preset: 'tomorrow' })`), false);
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(event)}, ${tomorrowDate}, { preset: 'tomorrow' })`), true);
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(event)}, ${tomorrowDate}, { preset: 'next7' })`), true);
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(event)}, ${todayDate}, { preset: 'custom', start: '${today}', end: '${today}' })`), true);
});

test('overdue filter includes open due occurrences and excludes completed tasks', () => {
  const yesterday = evaluate('isoLocalDate(addCalendarDays(new Date(), -1))');
  const date = `new Date('${yesterday}T12:00:00')`;
  const overdue = { type: 'task', date: yesterday, due_date: yesterday, status: 'todo' };
  const completed = { ...overdue, status: 'done' };
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(overdue)}, ${date}, { preset: 'overdue' })`), true);
  assert.equal(evaluate(`calendarDateFilterMatches(${JSON.stringify(completed)}, ${date}, { preset: 'overdue' })`), false);
});

test('event time labels distinguish all-day, continuing, and timed items', () => {
  const allDay = { type: 'event', is_all_day: true };
  const timed = { type: 'event', is_all_day: false, start_at: '2025-05-08T14:00:00Z', end_at: '2025-05-08T15:30:00Z' };
  const continuing = { ...timed, start_at: '2025-05-07T14:00:00Z', end_at: '2025-05-09T15:30:00Z' };
  assert.equal(evaluate(`eventTimeLabel(${JSON.stringify(allDay)}, new Date('2025-05-08T12:00:00Z'))`), 'ALL DAY');
  assert.match(evaluate(`eventTimeLabel(${JSON.stringify(timed)}, new Date('2025-05-08T12:00:00Z'))`), /2 PM–3:30 PM/);
  assert.equal(evaluate(`eventTimeLabel(${JSON.stringify(continuing)}, new Date('2025-05-08T12:00:00Z'))`), 'CONTINUES');
});
