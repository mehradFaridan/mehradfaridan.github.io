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
    return { top: top, bottom: top + el.offsetHeight, dot: top + 9 };
  }
  function curve(x1, y1, x2, y2) {
    var m = (y1 + y2) / 2;
    return 'M' + x1 + ' ' + y1 + 'C' + x1 + ' ' + m + ' ' + x2 + ' ' + m + ' ' + x2 + ' ' + y2;
  }
  function line(x, y1, y2) { return 'M' + x + ' ' + y1 + 'V' + y2; }

  function draw() {
    var mk = row('makami'), ut = row('utokyo'), xi = row('ximira'), uc = row('ucalgary');
    var gap = ut.top - mk.bottom, a = LANE[0], b = LANE[1];
    var join = uc.top - gap / 2;
    var paths = [
      // MaKami: the main line, growing out of the UCalgary research
      line(a, mk.dot, join),
      curve(b, uc.dot, a, join),
      // UTokyo and Ximira: separate roles alongside MaKami
      line(b, ut.dot, ut.bottom - 4),
      line(b, xi.dot, xi.bottom - 4)
    ];
    var dots = [[a, mk.dot], [b, ut.dot], [b, ut.bottom - 4], [b, xi.dot], [b, xi.bottom - 4], [b, uc.dot]];
    var h = list.offsetHeight;
    svg.setAttribute('width', 48);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 48 ' + h);
    svg.innerHTML = '';
    paths.forEach(function (d) {
      var el = document.createElementNS(NS, 'path');
      el.setAttribute('d', d);
      svg.appendChild(el);
    });
    dots.forEach(function (d) {
      var el = document.createElementNS(NS, 'circle');
      el.setAttribute('cx', d[0]);
      el.setAttribute('cy', d[1]);
      el.setAttribute('r', 5);
      svg.appendChild(el);
    });
  }

  draw();
  if (window.ResizeObserver) new ResizeObserver(draw).observe(list);
  else window.addEventListener('resize', draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
})();
