// views/dreams.js -- Feature 5: Markdown rendering for dream descriptions

async function renderDreams(main) {
  const [dreams, areas] = await Promise.all([API.listDreams(), API.listAreas()]);

  main.innerHTML = `
    <div class="view-header">
      <h1>Dreams</h1>
      <button class="primary" id="new-dream-btn">+ New Dream</button>
    </div>
    <div id="dreams-list"></div>
  `;

  const list = document.getElementById('dreams-list');
  if (!dreams.length) {
    list.innerHTML = `<div class="empty-state">No dreams yet. A dream is a life direction, not a deliverable -- "Live in Japan", "Be unrejectable in tech". Tag it to the Areas it touches.</div>`;
  } else {
    list.innerHTML = dreams.map((dr) => `
      <div class="card" style="margin-bottom:10px; cursor:pointer;" data-dream-id="${dr.id}">
        <div class="dc-head">
          <span class="dc-icon">${dr.icon || '*'}</span>
          <span class="dc-title">${escapeHtml(dr.title)}</span>
          <span class="badge status-${dr.status}" style="margin-left:auto;">${dr.status}</span>
        </div>
        ${dr.description ? `<div class="dream-md-desc markdown-body" style="margin-bottom:8px;">${renderMd(dr.description)}</div>` : ''}
        ${dr.areas.length ? `
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
            ${dr.areas.map((a) => `
              <span class="dream-tag">${a.icon || ''} ${escapeHtml(a.title)} / ${(a.progress * 100).toFixed(0)}%</span>
            `).join('')}
          </div>
        ` : `<div class="muted" style="font-size:11px;">Not tagged to any area yet.</div>`}
      </div>
    `).join('');

    list.querySelectorAll('[data-dream-id]').forEach((el) => {
      el.addEventListener('click', () => openDreamModal(dreams.find((d) => d.id === el.dataset.dreamId), areas));
    });
  }

  document.getElementById('new-dream-btn').addEventListener('click', () => openDreamModal(null, areas));
}

function openDreamModal(dream, areas) {
  const isEdit    = !!dream;
  const linkedIds = new Set((dream?.areas || []).map((a) => a.id));
  showModal(`
    <h2>${isEdit ? 'Edit Dream' : 'New Dream'}</h2>
    <form id="dream-form">
      <div class="field"><label>Title</label>
        <input name="title" required value="${dream ? escapeHtml(dream.title) : ''}" placeholder="Live in Japan">
      </div>
      <div class="field"><label>Description (markdown supported)</label>
        <textarea name="description" rows="3">${dream ? escapeHtml(dream.description || '') : ''}</textarea>
      </div>
      <div class="field"><label>Icon (emoji, optional)</label>
        <input name="icon" value="${dream ? escapeHtml(dream.icon || '') : ''}">
      </div>
      <div class="field"><label>Status</label>
        <select name="status">
          <option value="active"   ${dream?.status === 'active'   ? 'selected' : ''}>Active</option>
          <option value="achieved" ${dream?.status === 'achieved' ? 'selected' : ''}>Achieved</option>
          <option value="dropped"  ${dream?.status === 'dropped'  ? 'selected' : ''}>Dropped</option>
        </select>
      </div>
      <div class="field"><label>Touches these areas</label>
        ${areas.map((a) => `
          <label style="display:flex; align-items:center; gap:6px; text-transform:none; font-size:13px; margin-bottom:4px;">
            <input type="checkbox" style="width:auto;" name="area_${a.id}" ${linkedIds.has(a.id) ? 'checked' : ''}>
            ${a.icon || ''} ${escapeHtml(a.title)}
          </label>
        `).join('') || '<div class="muted" style="font-size:12px;">No areas yet -- create one first.</div>'}
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:16px;">
        <div>${isEdit ? `<button type="button" id="delete-dream" class="danger-btn">Delete</button>` : ''}</div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="cancel-modal">Cancel</button>
          <button type="submit" class="primary">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('cancel-modal').addEventListener('click', closeModal);
  if (isEdit) {
    document.getElementById('delete-dream').addEventListener('click', async () => {
      if (confirm(`Delete "${dream.title}"?`)) {
        await API.deleteDream(dream.id);
        closeModal();
        Router.resolve();
      }
    });
  }
  document.getElementById('dream-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd       = new FormData(e.target);
    const area_ids = areas.filter((a) => fd.get(`area_${a.id}`)).map((a) => a.id);
    const payload  = {
      title:       fd.get('title'),
      description: fd.get('description') || null,
      icon:        fd.get('icon') || null,
      status:      fd.get('status'),
      area_ids,
    };
    if (isEdit) await API.updateDream(dream.id, payload);
    else        await API.createDream(payload);
    closeModal();
    Router.resolve();
  });
}

Router.register('/dreams', renderDreams);
