
const icons = {
  dashboard: '<path d="M3 3h7v7H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 14h7v7H3z"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M3 10h18"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  alert: '<path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2z"/><path d="M12 9v4M12 17h.01"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4V9.6h.1A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 10 2.5V2.4h4v.1a1.7 1.7 0 0 0 1 1.7 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7L20 14"/><path d="M20 7v4h-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  git: '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12M8 6c6 0 4 0 8 0M18 8c0 8-12 4-12 10"/>',
  file: '<path d="M5 2h9l5 5v15H5z"/><path d="M14 2v6h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  zap: '<path d="m13 2-9 12h8l-1 8 9-12h-8z"/>',
  cloud: '<path d="M7 18h11a4 4 0 0 0 .6-8A6 6 0 0 0 7.2 8.2 5 5 0 0 0 7 18"/>',
  laptop: '<rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
  server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2 2M14 9l2 2"/>',
  webhook: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12"/><circle cx="12" cy="12" r="2.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
};

document.querySelectorAll('[data-icon]').forEach(el => {
  const name = el.dataset.icon;
  if (!icons[name]) return;
  el.classList.add('icon');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.8');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.innerHTML = icons[name];
});

const current = location.pathname.split('/').pop() || 'dashboard.html';
document.querySelectorAll('.nav-link').forEach(link => {
  const href = link.getAttribute('href');
  const active = href === current || (current === 'project-detail.html' && href === 'projects.html') || (current === 'profile.html' && href === 'settings.html');
  if (active) link.classList.add('active');
});

const menu = document.querySelector('.mobile-menu');
if (menu) menu.addEventListener('click', e => {
  e.stopPropagation();
  document.body.classList.toggle('sidebar-open');
});
document.addEventListener('click', e => {
  if (document.body.classList.contains('sidebar-open') && !e.target.closest('.sidebar') && !e.target.closest('.mobile-menu')) {
    document.body.classList.remove('sidebar-open');
  }
});

function toast(message = 'Changes saved successfully') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<svg data-icon="check"></svg><span></span>';
    document.body.appendChild(el);
    const iconEl = el.querySelector('[data-icon]');
    iconEl.classList.add('icon');
    iconEl.setAttribute('viewBox', '0 0 24 24');
    iconEl.setAttribute('fill', 'none');
    iconEl.setAttribute('stroke', 'currentColor');
    iconEl.setAttribute('stroke-width', '1.8');
    iconEl.innerHTML = icons.check;
  }
  el.querySelector('span').textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

document.querySelectorAll('[data-toast]').forEach(btn => btn.addEventListener('click', e => {
  e.preventDefault();
  toast(btn.dataset.toast || 'Done');
}));

document.querySelectorAll('.toggle').forEach(toggle => toggle.addEventListener('click', () => toggle.classList.toggle('on')));

document.querySelectorAll('[data-password-toggle]').forEach(btn => btn.addEventListener('click', () => {
  const input = document.getElementById(btn.dataset.passwordToggle);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}));

document.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
  const target = document.querySelector(btn.dataset.copy);
  if (!target) return;
  try { await navigator.clipboard.writeText(target.value || target.textContent); toast('Copied to clipboard'); }
  catch { toast('Copy unavailable in this browser'); }
}));
