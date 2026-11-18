// modal.js — shared modal overlay used by Quick Add and entity edit forms

let modalReturnFocus = null;

function showModal(innerHtml) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('open')) modalReturnFocus = document.activeElement;
  const modal = overlay.querySelector('.modal');
  modal.innerHTML = innerHtml;
  modal.tabIndex = -1;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const heading = modal.querySelector('h1, h2');
  if (heading) {
    heading.id = 'app-modal-title';
    overlay.setAttribute('aria-labelledby', heading.id);
  } else {
    overlay.setAttribute('aria-label', 'Application dialog');
  }
  overlay.onkeydown = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll(
      'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden);
    if (!focusable.length) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  overlay.classList.add('open');
  const initialFocus = modal.querySelector('input:not([type="hidden"]), textarea, select, button:not([disabled])');
  if (initialFocus) setTimeout(() => initialFocus.focus(), 30);
  else modal.focus();
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  const previous = modalReturnFocus;
  modalReturnFocus = null;
  if (previous?.isConnected) previous.focus();
}

function beginFormSubmission(form) {
  if (!form || form.dataset.submitting === 'true') return null;
  form.dataset.submitting = 'true';
  const submitButton = form.querySelector('[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  return () => {
    delete form.dataset.submitting;
    if (submitButton?.isConnected) submitButton.disabled = false;
  };
}

function openAppDialog({ title, message, confirmText = 'Continue', cancelText = 'Cancel', danger = false, input = false, options = null, validate = null }) {
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  dialog.setAttribute('aria-labelledby', 'app-dialog-title');
  const field = input
    ? `<label class="dialog-field-label" for="app-dialog-input">${escapeHtml(input.label || 'Value')}</label><input id="app-dialog-input" class="dialog-input" type="text" value="${escapeHtml(input.value || '')}" ${input.required ? 'required' : ''}>`
    : options
      ? `<label class="dialog-field-label" for="app-dialog-select">${escapeHtml(options.label || 'Choose an option')}</label><select id="app-dialog-select" class="dialog-input">${options.items.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('')}</select>`
      : '';
  dialog.innerHTML = `
    <form class="app-dialog-form">
      <h2 id="app-dialog-title">${escapeHtml(title)}</h2>
      <p class="app-dialog-message">${escapeHtml(message)}</p>
      ${field}<div class="app-dialog-error" role="alert" aria-live="polite"></div>
      <div class="app-dialog-actions">
        <button type="button" data-cancel>${escapeHtml(cancelText)}</button>
        <button type="submit" class="${danger ? 'danger-btn' : 'primary'}">${escapeHtml(confirmText)}</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      previous?.focus?.();
      resolve(value);
    };
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.addEventListener('close', () => finish(null));
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input
        ? dialog.querySelector('#app-dialog-input').value
        : options
          ? dialog.querySelector('#app-dialog-select').value
          : true;
      if (input?.required && !value.trim()) {
        dialog.querySelector('.app-dialog-error').textContent = 'This field is required.';
        dialog.querySelector('#app-dialog-input').focus();
        return;
      }
      const error = validate?.(value);
      if (error) {
        dialog.querySelector('.app-dialog-error').textContent = error;
        (dialog.querySelector('.dialog-input') || dialog.querySelector('[type="submit"]')).focus();
        return;
      }
      finish(value);
    });
    dialog.showModal();
    dialog.querySelector('.dialog-input')?.focus();
    if (!input && !options) dialog.querySelector('[type="submit"]').focus();
  });
}

function appConfirm(message, options = {}) {
  return openAppDialog({ title: options.title || 'Confirm action', message, ...options });
}

function appAlert(message, options = {}) {
  return openAppDialog({ title: options.title || 'Notice', message, confirmText: 'OK', cancelText: 'Close', ...options })
    .then(() => undefined);
}

function appPrompt(message, options = {}) {
  return openAppDialog({ title: options.title || 'Enter a value', message, input: options.input || { label: options.label, value: options.value, required: options.required }, ...options });
}

function appSelect(message, items, options = {}) {
  return openAppDialog({ title: options.title || 'Choose an item', message, options: { label: options.label, items }, ...options });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('.app-dialog[open]')) closeModal();
});
