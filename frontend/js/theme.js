// theme.js — dark / light / system mode
// data-theme on <html> is set pre-paint by an inline script in index.html;
// this file wires up the toggle button and keeps it in sync with the OS.

const Theme = {
  MODES: ['dark', 'light', 'system'],
  ICONS: { dark: 'Dark', light: 'Light', system: 'System' },

  get() {
    return localStorage.getItem('lifeops-theme') || 'system';
  },

  set(mode) {
    localStorage.setItem('lifeops-theme', mode);
    document.documentElement.dataset.theme = mode;
  },

  cycle() {
    const next = this.MODES[(this.MODES.indexOf(this.get()) + 1) % this.MODES.length];
    this.set(next);
    return next;
  },

  initToggleButton(btn) {
    if (!btn) return;
    const paint = () => { btn.textContent = this.ICONS[this.get()]; };
    paint();
    btn.addEventListener('click', () => { this.cycle(); paint(); });
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (this.get() === 'system') paint();
    });
  },
};
