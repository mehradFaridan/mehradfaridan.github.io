// Background section: draws the branch lines beside the list of roles.
// Without this script the roles show as a plain list.
(function () {
  var list = document.querySelector('.tl');
  if (!list) return;
  var NS = 'http://www.w3.org/2000/svg';
  var LANE = [8, 36]; // x of the main line and the side line
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  list.insertBefore(svg, list.firstChild);
  list.classList.add('drawn');

  function row(name) {
    var el = list.querySelector('[data-tl="' + name + '"]');
    var top = el.offsetTop;
    return { top: top, bottom: top + el.offsetHeight, dot: top + 11 };
  }
  function curve(x1, y1, x2, y2) {
    var m = (y1 + y2) / 2;
    return 'M' + x1 + ' ' + y1 + 'C' + x1 + ' ' + m + ' ' + x2 + ' ' + m + ' ' + x2 + ' ' + y2;
  }
  function line(x, y1, y2) { return 'M' + x + ' ' + y1 + 'V' + y2; }

  function draw() {
    var mk = row('makami'), ut = row('utokyo'), xi = row('ximira'), uc = row('ucalgary');
    var gap = ut.top - mk.bottom, a = LANE[0], b = LANE[1];
    var paths = [
      // MaKami: the main line, growing out of the UCalgary research
      ['main', line(a, mk.dot, uc.top - gap / 2)],
      ['main', curve(b, uc.dot, a, uc.top - gap / 2)],
      // UTokyo: branches off MaKami and merges back in
      ['main', curve(a, ut.top - gap / 2, b, ut.dot) + line(b, ut.dot, ut.bottom - 6) + curve(b, ut.bottom - 6, a, ut.bottom + gap / 2)],
      // Ximira: a separate job at the same time
      ['side', line(b, xi.dot, xi.bottom - 4)]
    ];
    var dots = [['main', a, mk.dot], ['main', b, ut.dot], ['side', b, xi.dot], ['side', b, xi.bottom - 4], ['main', b, uc.dot]];
    var h = list.offsetHeight;
    svg.setAttribute('width', 48);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 48 ' + h);
    svg.innerHTML = '';
    paths.forEach(function (p) {
      var el = document.createElementNS(NS, 'path');
      el.setAttribute('class', p[0]);
      el.setAttribute('d', p[1]);
      svg.appendChild(el);
    });
    dots.forEach(function (d) {
      var el = document.createElementNS(NS, 'circle');
      el.setAttribute('class', d[0]);
      el.setAttribute('cx', d[1]);
      el.setAttribute('cy', d[2]);
      el.setAttribute('r', 5);
      svg.appendChild(el);
    });
  }

  draw();
  if (window.ResizeObserver) new ResizeObserver(draw).observe(list);
  else window.addEventListener('resize', draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
})();
