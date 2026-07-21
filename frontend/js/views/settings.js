// views/settings.js — Feature 7: Data Export and Backup UI

async function renderSettings(main) {
  main.innerHTML = `
    <div class="view-header"><h1>Settings</h1></div>

    <div class="card" style="max-width:600px; margin-bottom:16px;">
      <h2>Backup &amp; Restore</h2>
      <p class="muted" style="font-size:12px; margin-bottom:16px;">All data lives locally. Download a backup before making changes.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
        <button id="btn-backup" class="primary">Download backup (.json)</button>
        <button id="btn-csv">Export CSV (.zip)</button>
        <button id="btn-import">Import backup...</button>
      </div>
      <input type="file" id="import-file-input" accept=".json" style="display:none;">
      <div id="import-status" style="font-size:12px; margin-top:8px;"></div>
    </div>

    <div class="card" style="max-width:600px; margin-bottom:16px;">
      <h2>Database</h2>
      <div id="db-stats"><span class="muted">Loading...</span></div>
    </div>

    <div class="card" style="max-width:600px;">
      <h2>Appearance</h2>
      <div class="field">
        <label>Theme</label>
        <select id="theme-select">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </div>
    </div>
  `;

  // Theme
  const themeSelect = document.getElementById('theme-select');
  themeSelect.value = Theme.get();
  themeSelect.addEventListener('change', () => {
    Theme.set(themeSelect.value);
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) toggleBtn.textContent = Theme.ICONS[Theme.get()];
  });

  // Backup
  document.getElementById('btn-backup').addEventListener('click', () => API.downloadBackup());
  document.getElementById('btn-csv').addEventListener('click', () => API.downloadCsv());

  // Import
  const fileInput    = document.getElementById('import-file-input');
  const importStatus = document.getElementById('import-status');
  document.getElementById('btn-import').addEventListener('click', () => {
    if (confirm('Import will replace ALL current data. Are you sure?')) {
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importStatus.innerHTML = '<span class="muted">Importing...</span>';
    try {
      const result = await API.importBackup(file);
      if (result.ok) {
        importStatus.innerHTML = `<span style="color:var(--success);">Imported: ${escapeHtml(result.message)}</span>`;
      } else {
        importStatus.innerHTML = `<span style="color:var(--danger);">Failed: ${escapeHtml(result.message || 'Import failed')}</span>`;
      }
    } catch (err) {
      importStatus.innerHTML = `<span style="color:var(--danger);">Error: ${escapeHtml(err.message)}</span>`;
    }
  });

  // DB Stats — show only the counts users care about
  try {
    const stats = await API.getSettings();
    const c     = stats.counts;
    document.getElementById('db-stats').innerHTML = `
      <table class="data-table" style="max-width:320px;">
        <tbody>
          <tr><td>Areas</td>         <td class="num mono">${c.areas}</td></tr>
          <tr><td>Projects</td>      <td class="num mono">${c.projects}</td></tr>
          <tr><td>Tasks</td>         <td class="num mono">${c.tasks}</td></tr>
          <tr><td>Habits (active)</td><td class="num mono">${c.habits}</td></tr>
          <tr><td>Weekly reviews</td><td class="num mono">${c.reviews}</td></tr>
          ${stats.db_size    ? `<tr><td>Database size</td> <td class="num mono">${escapeHtml(stats.db_size)}</td></tr>` : ''}
          ${stats.first_entry ? `<tr><td>First entry</td>  <td class="num mono">${stats.first_entry.slice(0,10)}</td></tr>` : ''}
        </tbody>
      </table>
    `;
  } catch (e) {
    document.getElementById('db-stats').innerHTML = `<span class="muted">Could not load stats.</span>`;
  }
}

Router.register('/settings', renderSettings);
