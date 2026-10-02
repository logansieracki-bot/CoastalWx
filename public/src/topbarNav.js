// Mobile collapse for the shared .topbar nav (see styles.css's .topbar
// rules) -- identical on all 3 public pages, called once from each of
// main.js/history.js/past.js's own init. Desktop never calls the toggle
// at all (the button itself is hidden above the mobile breakpoint via
// CSS), so this has no effect there beyond the no-op listeners.
export function initTopbarNav() {
  const toggle = document.querySelector('.topbar__menu-toggle');
  const links = document.getElementById('topbar-links');
  if (!toggle || !links) return;

  function setOpen(open) {
    links.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setOpen(!links.classList.contains('is-open')));

  // A link click always navigates away, but closing first avoids a flash
  // of the open panel on pages that restore scroll/layout from history
  // cache on back-navigation.
  for (const link of links.querySelectorAll('.topbar__link')) {
    link.addEventListener('click', () => setOpen(false));
  }

  document.addEventListener('click', (event) => {
    if (!links.classList.contains('is-open')) return;
    if (links.contains(event.target) || toggle.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && links.classList.contains('is-open')) setOpen(false);
  });
}
