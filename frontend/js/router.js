// router.js — minimal hash-based client routing

const Router = {
  routes: {},
  register(path, renderFn) {
    this.routes[path] = renderFn;
  },
  async start() {
    window.addEventListener('hashchange', () => this.resolve());
    await this.resolve();
  },
  async resolve() {
    let hash = window.location.hash.replace(/^#/, '') || '/home';
    let [path, param] = hash.split('/').filter(Boolean).reduce(
      (acc, seg, i) => (i === 0 ? [`/${seg}`, acc[1]] : [acc[0], seg]),
      ['/', null]
    );
    const fn = this.routes[path] || this.routes['/home'];
    document.querySelectorAll('.nav-link').forEach((el) => {
      el.classList.toggle('active', el.dataset.route === path);
    });
    const main = document.getElementById('main-panel');
    main.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      await fn(main, param);
    } catch (err) {
      console.error(err);
      main.innerHTML = `<div class="empty-state">Something broke: ${escapeHtml(err.message)}</div>`;
    }
  },
};

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = String(s ?? '');
  return div.innerHTML;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}
