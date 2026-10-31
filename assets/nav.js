// Site navigation: the slide-in menu on narrow screens, and highlighting the
// current section in the sidebar while scrolling the home page.
(function () {
  var sidebar = document.getElementById('sidebar');
  var openBtn = document.querySelector('.menu-btn');
  var closeBtn = document.querySelector('.menu-close');
  var scrim = document.querySelector('.scrim');
  if (!sidebar || !openBtn) return;

  function isDrawer() { return window.matchMedia('(max-width: 999px)').matches; }

  function open() {
    sidebar.classList.add('open');
    scrim.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    (closeBtn || sidebar).focus();
  }
  function close(returnFocus) {
    if (!sidebar.classList.contains('open')) return;
    sidebar.classList.remove('open');
    scrim.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (returnFocus) openBtn.focus();
  }

  openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', function () { close(true); });
  scrim.addEventListener('click', function () { close(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
  // Following a link closes the menu (same-page links would otherwise leave it covering the page).
  sidebar.addEventListener('click', function (e) { if (e.target.closest('a') && isDrawer()) close(false); });
  window.addEventListener('resize', function () { if (!isDrawer()) close(false); });

  // Highlight the section in view (home page only).
  var path = location.pathname.replace(/index\.html$/, '');
  if (path !== '/') return;
  var ids = ['work', 'publications', 'awards', 'background'];
  var sections = ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
  var links = Array.prototype.slice.call(sidebar.querySelectorAll('.side-nav a[data-section]'));
  var queued = false;
  function update() {
    queued = false;
    var current = 'top';
    sections.forEach(function (s) { if (s.getBoundingClientRect().top <= 140) current = s.id; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && sections.length) current = sections[sections.length - 1].id;
    links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-section') === current); });
  }
  window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
})();
