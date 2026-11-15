// views/settings.js — Feature 7: Data Export and Backup UI

async function renderSettings(main) {
  const projects = await API.listProjects().catch(() => []);
  main.innerHTML = `
    <div class="view-header"><h1>Settings</h1></div>

    <div class="card" style="max-width:600px; margin-bottom:16px;">
      <h2>Backup &amp; Restore</h2>
      <p class="muted" style="font-size:12px; margin-bottom:16px;">Download a complete backup or choose exactly which records to export. Imports are validated and previewed before changing your data.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
        <button id="btn-backup" class="primary">Complete backup (.json)</button>
        <button id="btn-csv">Export CSV (.zip)</button>
      </div>
      <fieldset class="export-controls">
        <legend>Selective JSON export</legend>
        <div class="export-entity-options">
          ${['areas', 'dreams', 'projects', 'tasks', 'habits'].map((entity) => `<label><input type="checkbox" name="export-entity" value="${entity}" ${['projects', 'tasks', 'habits'].includes(entity) ? 'checked' : ''}> ${entity[0].toUpperCase() + entity.slice(1)}</label>`).join('')}
        </div>
        <div class="field">
          <label for="export-project-scope">Project scope</label>
          <select id="export-project-scope">
            <option value="all">All projects</option>
            <option value="active">Active projects only</option>
            <option value="selected">Manually selected projects</option>
          </select>
        </div>
        <select id="export-project-ids" multiple aria-label="Select projects to export" hidden>
          ${projects.map((p) => `<option value="${p.id}">${escapeHtml(p.title)} (${p.status})</option>`).join('')}
        </select>
        <label class="export-related-tasks"><input type="checkbox" id="export-include-tasks"> Also include linked tasks when Tasks is unchecked</label>
        <label class="export-related-tasks"><input type="checkbox" id="export-include-snapshots"> Include progress snapshots</label>
        <p class="muted" style="font-size:11px; margin:8px 0 12px;">
          Standalone tasks are included whenever Tasks is selected. Project scope filters linked tasks and snapshots; habit exports include logs.
        </p>
        <button id="btn-selective-export" type="button">Export selected data</button>
      </fieldset>
      <div class="field" style="margin-top:16px;">
        <label for="import-file-input">Import a LifeOps JSON backup</label>
        <input type="file" id="import-file-input" accept=".json,application/json">
      </div>
      <div id="import-preview" class="import-preview" aria-live="polite" hidden></div>
      <div id="import-actions" class="import-actions" hidden>
        <label for="import-policy">Existing IDs</label>
        <select id="import-policy">
          <option value="skip">Keep existing records</option>
          <option value="replace">Update matching IDs</option>
          <option value="replace_all" disabled>Replace all current data (complete backup only)</option>
        </select>
        <button id="commit-import" type="button" class="danger-btn" disabled>Import validated data</button>
      </div>
      <div id="import-status" style="font-size:12px; margin-top:8px;" aria-live="polite"></div>
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
  let importToken = null;
  const previewEl = document.getElementById('import-preview');
  const importActions = document.getElementById('import-actions');
  const importPolicy = document.getElementById('import-policy');
  const commitImport = document.getElementById('commit-import');
  const exportEntities = [...document.querySelectorAll('[name="export-entity"]')];
  const projectScope = document.getElementById('export-project-scope');
  const projectIds = document.getElementById('export-project-ids');
  const includeProjectTasks = document.getElementById('export-include-tasks');
  const includeProjectSnapshots = document.getElementById('export-include-snapshots');
  function syncExportControls() {
    const selected = new Set(exportEntities.filter((el) => el.checked).map((el) => el.value));
    const canScope = selected.has('projects') || selected.has('tasks');
    projectScope.disabled = !canScope;
    projectIds.hidden = projectScope.value !== 'selected';
    projectIds.disabled = !selected.has('projects') && !selected.has('tasks');
    includeProjectTasks.disabled = !selected.has('projects') || selected.has('tasks');
    includeProjectSnapshots.disabled = !selected.has('projects');
  }
  exportEntities.forEach((checkbox) => checkbox.addEventListener('change', syncExportControls));
  projectScope.addEventListener('change', syncExportControls);
  syncExportControls();
  document.getElementById('btn-selective-export').addEventListener('click', () => {
    const entities = exportEntities.filter((el) => el.checked).map((el) => el.value);
    if (!entities.length) return appAlert('Choose at least one entity type to export.');
    const scope = projectScope.value;
    const ids = [...projectIds.selectedOptions].map((option) => option.value);
    if (scope === 'selected' && entities.includes('projects') && !ids.length) {
      return appAlert('Select at least one project.');
    }
    API.exportData({
      entities: entities.join(','),
      project_mode: scope,
      project_ids: ids.join(','),
      include_project_tasks: includeProjectTasks.checked,
      include_project_snapshots: includeProjectSnapshots.checked,
    });
  });
  let activeImportPreview = null;
  function renderImportPreview() {
    if (!activeImportPreview) return;
    const result = activeImportPreview;
    const policy = importPolicy.value;
    const rows = Object.entries(result.counts)
      .filter(([, count]) => count.create || count.update)
      .map(([name, count]) => {
        if (policy === 'replace_all') {
          return `<li>${escapeHtml(name)}: ${count.create + count.update} records to restore</li>`;
        }
        if (policy === 'skip') {
          return `<li>${escapeHtml(name)}: ${count.create} to add, ${count.update} matching IDs to keep unchanged</li>`;
        }
        return `<li>${escapeHtml(name)}: ${count.create} to create, ${count.update} matching IDs to update</li>`;
      }).join('');
    const issues = result.issues.length
      ? `<div class="import-errors"><strong>Fix these issues before importing</strong><ul>${result.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul></div>`
      : '<p class="import-valid">Backup is valid. Review the record counts and conflict behavior before continuing.</p>';
    const replaceWarning = policy === 'replace_all'
      ? '<p class="import-errors"><strong>This removes all current LifeOps data before restoring this complete backup.</strong></p>'
      : '';
    previewEl.innerHTML = `<h3>Import preview · schema ${result.schema_version}</h3>${replaceWarning}<ul>${rows || '<li>No records found.</li>'}</ul>${issues}`;
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importPolicy.value = 'skip';
    commitImport.textContent = 'Import validated data';
    importPolicy.querySelector('[value="replace_all"]').disabled = true;
    importStatus.textContent = 'Validating backup…';
    previewEl.hidden = false;
    importActions.hidden = true;
    commitImport.disabled = true;
    importToken = null;
    activeImportPreview = null;
    try {
      const result = await API.previewImport(file);
      importToken = result.token;
      activeImportPreview = result;
      importActions.hidden = false;
      importPolicy.querySelector('[value="replace_all"]').disabled = !result.complete_backup;
      commitImport.disabled = !result.valid;
      renderImportPreview();
      importStatus.textContent = result.valid ? 'Nothing has been changed yet.' : 'Import blocked until validation issues are fixed.';
    } catch (err) {
      activeImportPreview = null;
      previewEl.textContent = err.message;
      importStatus.textContent = 'Import preview could not be created.';
    }
    fileInput.value = '';
  });
  importPolicy.addEventListener('change', () => {
    commitImport.textContent = importPolicy.value === 'replace_all' ? 'Replace all data' : 'Import validated data';
    renderImportPreview();
  });
  commitImport.addEventListener('click', async () => {
    if (!importToken) return;
    const policy = importPolicy.value;
    if (policy === 'replace_all' && !(await appConfirm('This will replace all current LifeOps data with the uploaded complete backup. Download a current backup first if you may need to undo this.', { title: 'Replace all current data', confirmText: 'Replace all', danger: true }))) return;
    commitImport.disabled = true;
    importStatus.textContent = 'Importing…';
    try {
      const result = await API.commitImport(importToken, policy);
      const totals = Object.values(result.applied || {}).reduce((sum, item) => {
        sum.created += item.create || 0;
        sum.updated += item.update || 0;
        sum.skipped += item.skip || 0;
        sum.restored += item.restore || 0;
        return sum;
      }, { created: 0, updated: 0, skipped: 0, restored: 0 });
      const summary = policy === 'replace_all'
        ? ` ${totals.restored} records restored.`
        : ` ${totals.created} created, ${totals.updated} updated, ${totals.skipped} kept unchanged.`;
      importStatus.textContent = `${result.message}.${summary}`;
      previewEl.hidden = true;
      importActions.hidden = true;
    } catch (err) {
      importStatus.textContent = err.message;
      commitImport.disabled = false;
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
