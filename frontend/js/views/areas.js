// views/areas.js -- Feature 6: Area Health Indicator

const HEALTH_COLOR = {
  thriving:  'var(--success)',
  active:    'var(--accent)',
  slowing:   'var(--warning)',
  neglected: 'var(--danger)',
};

// 20 visually distinct, muted-but-readable colors for areas
const AREA_PALETTE = [
  '#5e8fd6', // blue
  '#5db88a', // green
  '#c47f3a', // amber
  '#b55c5c', // red
  '#8b6bbf', // purple
  '#4aacb8', // teal
  '#b8874a', // orange
  '#6a9e6a', // sage
  '#7e72b8', // violet
  '#c45c8a', // rose
  '#4a8aaa', // steel blue
  '#a8b840', // olive
  '#d4875a', // terracotta
  '#5aaa9e', // seafoam
  '#9e6a9e', // mauve
  '#7aaa5a', // lime green
  '#b85a6e', // raspberry
  '#4a6eb8', // indigo
  '#b8a040', // gold
  '#6ab8b8', // cyan
];

function pickUnusedColor(usedColors) {
  const used = new Set((usedColors || []).map((c) => (c || '').toLowerCase()));
  return AREA_PALETTE.find((c) => !used.has(c.toLowerCase())) || AREA_PALETTE[0];
}

async function renderAreas(main) {
  const areas = await API.listAreas();

  main.innerHTML = `
    <div class="view-header">
      <h1>Areas</h1>
      <button class="primary" id="new-area-btn">+ New Area</button>
    </div>
    <div id="areas-grid" class="grid grid-cards"></div>
  `;

  const grid = document.getElementById('areas-grid');
  if (!areas.length) {
    grid.innerHTML = `<div class="empty-state">No areas yet. An area is a life dimension that exists indefinitely -- Career, Learning, Health. Add your first one.</div>`;
  } else {
    grid.innerHTML = areas.map((a) => {
      const hColor = HEALTH_COLOR[a.health_status] || 'var(--border)';
      return `
        <div class="card dream-card dream-stripe" style="border-left-color:${a.color || 'var(--border)'}" data-area-id="${a.id}">
          <div class="dc-head">
            <span class="dc-icon">${a.icon || ''}</span>
            <span class="dc-title">${escapeHtml(a.title)}</span>
            <span class="health-dot" title="${a.health_status}"
              style="background:${hColor}; width:6px; height:6px; opacity:0.8; margin-left:4px;"></span>
            <span class="badge status-${a.status}" style="margin-left:auto;">${a.status}</span>
          </div>
          <div class="health-label" style="font-size:10px; color:${hColor}; opacity:0.8; margin-bottom:4px;">${escapeHtml(a.health_label)}</div>
          <div class="dc-desc">${escapeHtml(a.description || 'No description yet.')}</div>
          <div class="progress-bar" style="margin:8px 0 4px;">
            <div style="width:${(a.progress * 100).toFixed(0)}%; background:${a.color || 'var(--accent)'};"></div>
          </div>
          <div class="muted mono" style="font-size:10px; display:flex; justify-content:space-between;">
            <span>${(a.progress * 100).toFixed(0)}% avg progress</span>
            <span>${a.active_project_count} active project${a.active_project_count === 1 ? '' : 's'}</span>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.dream-card').forEach((el) => {
      el.addEventListener('click', () => openAreaModal(areas.find((a) => a.id === el.dataset.areaId), areas));
    });
  }

  document.getElementById('new-area-btn').addEventListener('click', () => openAreaModal(null, areas));
}

function openAreaModal(area, allAreas) {
  const isEdit = !!area;

  // Colors taken by OTHER areas (own color is available to keep)
  const takenColors = new Set(
    (allAreas || [])
      .filter((a) => !area || a.id !== area.id)
      .map((a) => (a.color || '').toLowerCase())
      .filter(Boolean)
  );

  // Starting color: keep own, or pick unused
  const initialColor = area?.color || pickUnusedColor([...takenColors]);

  showModal(`
    <h2>${isEdit ? 'Edit Area' : 'New Area'}</h2>
    <form id="area-form">
      <div class="field"><label>Title</label>
        <input name="title" required value="${area ? escapeHtml(area.title) : ''}" placeholder="Career">
      </div>
      <div class="field"><label>Description</label>
        <textarea name="description" rows="3">${area ? escapeHtml(area.description || '') : ''}</textarea>
      </div>
      <div class="field"><label>Icon (emoji, optional)</label>
        <input name="icon" value="${area ? escapeHtml(area.icon || '') : ''}">
      </div>

      <div class="field">
        <label>Color</label>
        <div id="color-swatches" style="
          display: grid;
          grid-template-columns: repeat(10, 24px);
          gap: 5px;
          margin-bottom: 8px;
        ">
          ${AREA_PALETTE.map((c) => {
            const isTaken    = takenColors.has(c.toLowerCase());
            const isSelected = c.toLowerCase() === initialColor.toLowerCase();
            return `
              <div class="area-color-swatch${isSelected ? ' selected' : ''}${isTaken ? ' taken' : ''}"
                data-color="${c}"
                title="${isTaken ? 'Used by another area' : c}"
                style="
                  width: 24px; height: 24px;
                  border-radius: 4px;
                  background: ${c};
                  cursor: ${isTaken ? 'not-allowed' : 'pointer'};
                  opacity: ${isTaken ? '0.25' : '1'};
                  box-sizing: border-box;
                  border: 2px solid ${isSelected ? '#fff' : 'transparent'};
                  outline: ${isSelected ? '2px solid ' + c : 'none'};
                  transition: border 0.1s, outline 0.1s, opacity 0.1s;
                ">
              </div>
            `;
          }).join('')}
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="color" id="custom-color-input" value="${initialColor}" style="width:32px; height:28px; padding:2px; cursor:pointer; border-radius:4px; flex-shrink:0;">
          <span class="muted" style="font-size:11px;">Custom color</span>
          <span id="color-taken-warning" style="font-size:11px; color:var(--warning); display:none;">Another area uses this color.</span>
        </div>
        <input type="hidden" name="color" id="color-value" value="${initialColor}">
      </div>

      <div class="field"><label>Status</label>
        <select name="status">
          <option value="active" ${area?.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="paused" ${area?.status === 'paused' ? 'selected' : ''}>Paused</option>
        </select>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:16px;">
        <div>${isEdit ? `<button type="button" id="delete-area" class="danger-btn">Delete</button>` : ''}</div>
        <div style="display:flex; gap:8px;">
          <button type="button" id="cancel-modal">Cancel</button>
          <button type="submit" class="primary">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </form>
  `);

  // Wire swatch clicks
  const colorValue   = document.getElementById('color-value');
  const customInput  = document.getElementById('custom-color-input');
  const takenWarning = document.getElementById('color-taken-warning');

  function selectColor(hex) {
    colorValue.value = hex;
    customInput.value = hex;
    const isTaken = takenColors.has(hex.toLowerCase());
    takenWarning.style.display = isTaken ? 'inline' : 'none';

    // Update swatch borders
    document.querySelectorAll('.area-color-swatch').forEach((sw) => {
      const match = sw.dataset.color.toLowerCase() === hex.toLowerCase();
      sw.style.border  = match ? '2px solid #fff' : '2px solid transparent';
      sw.style.outline = match ? `2px solid ${sw.dataset.color}` : 'none';
    });
  }

  document.querySelectorAll('.area-color-swatch').forEach((sw) => {
    if (sw.classList.contains('taken')) return; // taken by another area — not clickable
    sw.addEventListener('click', () => selectColor(sw.dataset.color));
  });

  customInput.addEventListener('input', () => selectColor(customInput.value));

  document.getElementById('cancel-modal').addEventListener('click', closeModal);

  if (isEdit) {
    document.getElementById('delete-area').addEventListener('click', async () => {
      if (confirm(`Delete "${area.title}"? This also deletes its projects and tasks.`)) {
        await API.deleteArea(area.id);
        closeModal();
        Router.resolve();
      }
    });
  }

  document.getElementById('area-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      title:       fd.get('title'),
      description: fd.get('description') || null,
      icon:        fd.get('icon') || null,
      color:       fd.get('color') || initialColor,
      status:      fd.get('status'),
    };
    if (isEdit) await API.updateArea(area.id, payload);
    else        await API.createArea(payload);
    closeModal();
    Router.resolve();
  });
}

Router.register('/areas', renderAreas);
