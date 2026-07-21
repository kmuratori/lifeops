// modal.js — shared modal overlay used by Quick Add and entity edit forms

function showModal(innerHtml) {
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('.modal').innerHTML = innerHtml;
  overlay.classList.add('open');
  const firstInput = overlay.querySelector('input, textarea, select');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
