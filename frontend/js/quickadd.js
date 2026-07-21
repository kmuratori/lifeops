// quickadd.js -- global [+] / 'n' shortcut

function openQuickAdd() {
  showModal(`
    <h2>Quick Add</h2>
    <form id="quickadd-form">
      <div class="field">
        <input type="text" name="cmd" id="quickadd-input" autocomplete="off"
          placeholder='add task "write README" to MemSnap due friday' />
      </div>
      <div class="muted" style="font-size:11px; line-height:2.0; font-family:var(--font-data);">
        <div>add task "title" to &lt;project&gt; due &lt;date&gt;</div>
        <div>add project "title" under "&lt;area&gt;"</div>
        <div>done task "title"</div>
        <div>add habit "title" daily</div>
        <div>add habit "title" every monday wednesday friday</div>
        <div>done habit "title"</div>
      </div>
      <div id="quickadd-result" style="margin-top:10px; font-size:12px;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
        <button type="button" id="cancel-modal">Close</button>
        <button type="submit" class="primary">Run</button>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  setTimeout(() => document.getElementById('quickadd-input')?.focus(), 50);

  document.getElementById('quickadd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('quickadd-input');
    const resultEl = document.getElementById('quickadd-result');
    const text = input.value.trim();
    if (!text) return;
    try {
      const res = await API.quickAdd(text);
      if (!res.parsed) {
        resultEl.innerHTML = `<span class="muted">Could not parse -- use the form below.</span>`;
        setTimeout(() => {
          closeModal();
          API.listProjects().then((projects) => openTaskModal(null, projects));
        }, 400);
        return;
      }
      resultEl.innerHTML = res.ok
        ? `<span style="color:var(--success);">[ok] ${escapeHtml(res.message)}</span>`
        : `<span style="color:var(--danger);">[err] ${escapeHtml(res.message)}</span>`;
      if (res.ok) {
        input.value = '';
        Router.resolve();
        setTimeout(closeModal, 700);
      }
    } catch (err) {
      resultEl.innerHTML = `<span style="color:var(--danger);">Error: ${escapeHtml(err.message)}</span>`;
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'n') { e.preventDefault(); openQuickAdd(); }
  if (e.key === 'f') { e.preventDefault(); FocusMode.toggle(); }
  if (e.key === 'Escape' && FocusMode.active()) FocusMode.exit();
});
