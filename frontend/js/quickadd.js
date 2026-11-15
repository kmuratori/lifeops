// quickadd.js -- global [+] / 'n' shortcut

function openQuickAdd() {
  showModal(`
    <h2>Quick Add</h2>
    <form id="quickadd-form">
      <div class="field">
        <input type="text" name="cmd" id="quickadd-input" autocomplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded="false"
          aria-controls="quickadd-suggestions"
          placeholder='add task "write README" to MemSnap due friday' />
        <div id="quickadd-suggestions" class="quickadd-suggestions" role="listbox" aria-label="Suggestions" hidden></div>
        <div id="quickadd-suggestion-status" class="muted quickadd-suggestion-status" aria-live="polite"></div>
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
  const input = document.getElementById('quickadd-input');
  const suggestionsEl = document.getElementById('quickadd-suggestions');
  let suggestions = [];
  let activeIndex = -1;
  let selectedEntity = null;
  let debounceTimer;
  let requestId = 0;
  let statusText = '';
  let running = false;
  const suggestionStatus = document.getElementById('quickadd-suggestion-status');
  function drawSuggestions() {
    suggestionsEl.hidden = !suggestions.length;
    input.setAttribute('aria-expanded', String(suggestions.length > 0));
    suggestionStatus.textContent = statusText;
    suggestionsEl.innerHTML = suggestions.map((item, i) => `
      <button type="button" role="option" id="quickadd-suggestion-${i}" aria-selected="${i === activeIndex}" class="quickadd-suggestion ${i === activeIndex ? 'is-active' : ''}" data-index="${i}">
        <span class="quickadd-suggestion-title">${escapeHtml(item.title)}</span>
        <span class="muted">${escapeHtml(item.detail || item.kind)}</span>
      </button>`).join('');
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      input.setAttribute('aria-activedescendant', `quickadd-suggestion-${activeIndex}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
    suggestionsEl.querySelectorAll('[data-index]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => chooseSuggestion(Number(button.dataset.index)));
    });
  }
  function chooseSuggestion(index) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const current = input.value.trim();
    selectedEntity = null;
    let cursorPosition = null;
    if (suggestion.kind === 'command') {
      input.value = suggestion.insert_text;
    } else if (suggestion.kind === 'task' && current.match(/^done\s+task\b/i)) {
      input.value = `done task "${suggestion.title}"`;
      selectedEntity = { kind: suggestion.kind, id: suggestion.id, title: suggestion.title };
    } else if (suggestion.kind === 'habit' && current.match(/^done\s+habit\b/i)) {
      input.value = `done habit "${suggestion.title}"`;
      selectedEntity = { kind: suggestion.kind, id: suggestion.id, title: suggestion.title };
    } else if (suggestion.kind === 'project' && current.match(/^add\s+task\b/i)) {
      const due = current.match(/\s+due\s+(.+)$/i);
      const taskTitle = current.match(/^add\s+task\s+"([^"]*)"/i)?.[1];
      if (taskTitle === undefined) {
        input.value = `add task "" to "${suggestion.title}"${due ? ` due ${due[1]}` : ''}`;
        cursorPosition = 'add task "'.length;
      } else {
        input.value = `add task "${taskTitle}" to "${suggestion.title}"${due ? ` due ${due[1]}` : ''}`;
      }
      selectedEntity = { kind: suggestion.kind, id: suggestion.id, title: suggestion.title };
    } else if (suggestion.kind === 'area' && current.match(/^add\s+project\b/i)) {
      const projectTitle = current.match(/^add\s+project\s+"([^"]*)"/i)?.[1];
      if (projectTitle === undefined) {
        input.value = `add project "" under "${suggestion.title}"`;
        cursorPosition = 'add project "'.length;
      } else {
        input.value = `add project "${projectTitle}" under "${suggestion.title}"`;
      }
      selectedEntity = { kind: suggestion.kind, id: suggestion.id, title: suggestion.title };
    } else {
      input.value = current ? `${current} ${suggestion.title}` : suggestion.title;
    }
    suggestions = [];
    activeIndex = -1;
    statusText = '';
    drawSuggestions();
    input.focus();
    const cursor = cursorPosition ?? input.value.length;
    input.setSelectionRange(cursor, cursor);
  }
  async function loadSuggestions(query, id) {
    try {
      const result = await API.taskSuggestions(query);
      if (id !== requestId) return;
      suggestions = result.suggestions || [];
      activeIndex = -1;
      statusText = suggestions.length
        ? ''
        : query ? 'No matches. You can still enter a new name or run a command.' : 'No command suggestions are available.';
    } catch {
      if (id !== requestId) return;
      suggestions = [];
      statusText = 'Suggestions are unavailable. You can still run the command.';
    }
    drawSuggestions();
  }
  function selectionStillMatches() {
    if (!selectedEntity) return false;
    const patterns = {
      task: /^done\s+task\s+"([^"]+)"$/i,
      habit: /^done\s+habit\s+"([^"]+)"$/i,
      project: /^add\s+task\s+"[^"]*"\s+to\s+"([^"]+)"(?:\s+due\s+.+)?$/i,
      area: /^add\s+project\s+"[^"]+"\s+under\s+"([^"]+)"$/i,
    };
    const match = input.value.trim().match(patterns[selectedEntity.kind]);
    return Boolean(match && match[1].toLocaleLowerCase() === selectedEntity.title.toLocaleLowerCase());
  }
  input.addEventListener('input', () => {
    if (selectedEntity && !selectionStillMatches()) selectedEntity = null;
    clearTimeout(debounceTimer);
    const id = ++requestId;
    const query = input.value.trim();
    suggestions = [];
    activeIndex = -1;
    statusText = query ? 'Searching…' : 'Loading commands…';
    drawSuggestions();
    debounceTimer = setTimeout(() => loadSuggestions(query, id), query ? 160 : 0);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && suggestions.length) {
      event.stopPropagation();
      suggestions = [];
      activeIndex = -1;
      statusText = '';
      drawSuggestions();
    } else if (suggestions.length && event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % suggestions.length;
      drawSuggestions();
    } else if (suggestions.length && event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1;
      drawSuggestions();
    } else if (suggestions.length && event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(activeIndex);
    }
  });

  document.getElementById('quickadd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (running) return;
    if (suggestions.length && activeIndex >= 0) {
      chooseSuggestion(activeIndex);
      return;
    }
    const resultEl = document.getElementById('quickadd-result');
    const text = input.value.trim();
    if (!text) return;
    running = true;
    const submitButton = e.currentTarget.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const res = await API.quickAdd(text, selectedEntity);
      if (!res.parsed) {
        running = false;
        submitButton.disabled = false;
        const command = text.match(/^add\s+(task|project|habit)\b/i)?.[1]?.toLowerCase();
        const label = command ? `Open ${command} form` : '';
        resultEl.innerHTML = `<span class="muted">Could not parse that command. Check the syntax above or use the matching form.</span>${command ? ` <button type="button" id="quickadd-open-form">${label}</button>` : ''}`;
        document.getElementById('quickadd-open-form')?.addEventListener('click', async () => {
          closeModal();
          try {
            if (command === 'task') {
              const projects = await API.listProjects();
              openTaskModal(null, projects);
            } else {
              const areas = await API.listAreas();
              if (command === 'project') openProjectModal(null, areas);
              if (command === 'habit') openHabitModal(null, areas);
            }
          } catch (error) {
            appAlert(error.message, { title: `Could not open ${command} form` });
          }
        });
        return;
      }
      if (!res.ok) {
        running = false;
        submitButton.disabled = false;
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
      running = false;
      submitButton.disabled = false;
    }
  });
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('.app-dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
  if (document.getElementById('modal-overlay')?.classList.contains('open') && e.key !== 'Escape') return;
  if (e.key === 'n') { e.preventDefault(); openQuickAdd(); }
  if (e.key === 'f') { e.preventDefault(); FocusMode.toggle(); }
  if (e.key === 'Escape' && FocusMode.active()) FocusMode.exit();
});
