// Point-cloud companion: on wide screens, a cloud of points in the right-hand column
// reshapes into each project as you scroll through Selected work, then into one shape per later section.
// On a project page (aside[data-project]) it just forms that project's shape.
// Loads three.js only when the column is visible and the visitor allows motion.

const WIDE = '(min-width: 1200px)';
const aside = document.querySelector('.companion');
const work = document.getElementById('work');
const cards = Array.from(document.querySelectorAll('#work a.project'));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fixed = aside && aside.dataset.project;

if (aside && (fixed || (work && cards.length)) && !reduced) {
  if (matchMedia(WIDE).matches) start();
  else matchMedia(WIDE).addEventListener('change', function once(e) { if (e.matches) { start(); this.removeEventListener('change', once); } });
}

async function start() {
  const THREE = await import('/assets/vendor/three.module.min.js');
  const N = 5200;

  // ---------- sampling helpers (seeded, so every visit looks the same) ----------
  let seed = 7;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const randDir = () => v(gauss(), gauss(), gauss()).normalize();
  function basis(d) {
    const a = Math.abs(d.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(d, a).normalize();
    return [u, new THREE.Vector3().crossVectors(d, u)];
  }
  // Each primitive is { area, sample() } in local space.
  const P = {
    sphere: (c, r) => ({ area: 4 * Math.PI * r * r, sample: () => randDir().multiplyScalar(r).add(c) }),
    box: (c, s) => ({ area: 2 * (s[0] * s[1] + s[1] * s[2] + s[0] * s[2]), sample: () => {
      const f = rnd() * 3 | 0, sign = rnd() < 0.5 ? -0.5 : 0.5, p = [(rnd() - 0.5) * s[0], (rnd() - 0.5) * s[1], (rnd() - 0.5) * s[2]];
      p[f] = sign * s[f]; return v(p[0], p[1], p[2]).add(c); } }),
    capsule: (a, b, r) => {
      const d = b.clone().sub(a), L = d.length(); d.normalize(); const [u, w] = basis(d);
      return { area: 2 * Math.PI * r * L + 4 * Math.PI * r * r, sample: () => {
        if (rnd() < L / (L + 2 * r)) { const th = rnd() * 2 * Math.PI; return a.clone().addScaledVector(d, rnd() * L).addScaledVector(u, Math.cos(th) * r).addScaledVector(w, Math.sin(th) * r); }
        const end = rnd() < 0.5, dir = randDir(); if (dir.dot(d) * (end ? 1 : -1) < 0) dir.negate();
        return (end ? b : a).clone().addScaledVector(dir, r); } };
    },
    torus: (c, R, r, tilt) => ({ area: 4 * Math.PI * Math.PI * R * r, sample: () => {
      const a = rnd() * 2 * Math.PI, b = rnd() * 2 * Math.PI;
      const p = v((R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a));
      return p.applyAxisAngle(v(1, 0, 0), tilt || 0).add(c); } }),
    helix: (a, b, R, turns, tr) => {
      const d = b.clone().sub(a), L = d.length(); d.normalize(); const [u, w] = basis(d);
      return { area: 2 * Math.PI * tr * Math.hypot(L, 2 * Math.PI * R * turns), sample: () => {
        const s = rnd(), th = s * turns * 2 * Math.PI;
        return a.clone().addScaledVector(d, s * L).addScaledVector(u, Math.cos(th) * R).addScaledVector(w, Math.sin(th) * R).add(randDir().multiplyScalar(tr)); } };
    },
    ring: (c, R, axis, thick) => ({ area: 2 * Math.PI * R * (thick || 0.02) * 6, sample: () => {
      const th = rnd() * 2 * Math.PI, j = (rnd() - 0.5) * (thick || 0.02);
      const p = axis === 'y' ? v(Math.cos(th) * (R + j), 0, Math.sin(th) * (R + j)) : v(Math.cos(th) * (R + j), Math.sin(th) * (R + j), 0);
      return p.add(c); } }),
    // Surface of revolution around the y axis: r(t) for t in 0..1 between heights y0 and y1.
    lathe: (c, y0, y1, r) => ({ area: 2 * Math.PI * (r(0) + r(0.5) + r(1)) / 3 * (y1 - y0), sample: () => {
      const t = rnd(), th = rnd() * 2 * Math.PI, R = r(t);
      return v(Math.cos(th) * R, y0 + t * (y1 - y0), Math.sin(th) * R).add(c); } }),
    frame: (c, w, h, t) => ({ area: 2 * (w + h) * t * 4, sample: () => {
      const side = rnd(), s = rnd() - 0.5, j = (rnd() - 0.5) * t;
      if (side < w / (w + h)) return v(s * w, (rnd() < 0.5 ? -1 : 1) * h / 2 + j, (rnd() - 0.5) * t).add(c);
      return v((rnd() < 0.5 ? -1 : 1) * w / 2 + j, s * h, (rnd() - 0.5) * t).add(c); } })
  };
  // Group primitives with a transform: position, rotation (radians) and scale.
  function group(parts, o = {}) {
    const m = new THREE.Matrix4().compose(o.pos || v(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)), v(o.s || 1, o.s || 1, o.s || 1));
    const flat = parts.flat(Infinity);
    const sc = (o.s || 1) ** 2;
    return flat.map((p) => ({ area: p.area * sc * (p.weight || 1), sample: () => p.sample().applyMatrix4(m) }));
  }
  // Keep only points inside an axis-aligned box (used to crop the 2D video figure to its frame).
  function clip(parts, lo, hi) {
    return parts.flat(Infinity).map((p) => ({ area: p.area * 0.6, sample: () => {
      for (let k = 0; k < 40; k++) { const q = p.sample(); if (q.x >= lo.x && q.x <= hi.x && q.y >= lo.y && q.y <= hi.y) return q; }
      return v(lo.x + rnd() * (hi.x - lo.x), lo.y, lo.z); } }));
  }
  // Horizontal scan bands, so a body reads as a hologram.
  function holo(parts, bands, duty, axis = 'y') {
    return parts.flat(Infinity).map((p) => ({ area: p.area * duty, sample: () => {
      for (let k = 0; k < 40; k++) { const q = p.sample(); if (((q[axis] + 10) * bands) % 1 < duty) return q; }
      return p.sample(); } }));
  }
  function flatten(parts, z) { return parts.flat(Infinity).map((p) => ({ area: p.area, sample: () => { const q = p.sample(); q.z = z + (rnd() - 0.5) * 0.01; return q; } })); }
  const arc = (c, R, a0, a1, t) => ({ area: R * (a1 - a0) * t * 6, sample: () => { const a = a0 + rnd() * (a1 - a0), j = (rnd() - 0.5) * t; return v(Math.cos(a) * (R + j), Math.sin(a) * (R + j), (rnd() - 0.5) * t).add(c); } });
  function weight(parts, w) { return parts.flat(Infinity).map((p) => ({ area: p.area * w, sample: p.sample })); }
  function build(parts) {
    const flat = parts.flat(Infinity), total = flat.reduce((s, p) => s + p.area, 0), out = new Float32Array(N * 3);
    const cum = []; let acc = 0; for (const p of flat) { acc += p.area / total; cum.push(acc); }
    for (let i = 0; i < N; i++) {
      const r = rnd(); let k = cum.findIndex((c) => r <= c); if (k < 0) k = flat.length - 1;
      const p = flat[k].sample(); out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z;
    }
    return out;
  }

  // ---------- reusable bodies ----------
  function hand(o) {
    const palm = P.box(v(0, 0, 0), [0.5, 0.56, 0.13]);
    const fingers = [[-0.18, 0.4, 0.06], [-0.06, 0.47, 0.02], [0.06, 0.45, -0.02], [0.18, 0.36, -0.06]].map(([x, len, ang]) =>
      P.capsule(v(x, 0.3, 0), v(x + Math.sin(ang) * len, 0.3 + Math.cos(ang) * len, 0.03), 0.06));
    const thumb = P.capsule(v(-0.24, -0.06, 0.02), v(-0.48, 0.2, 0.08), 0.068);
    const wrist = P.capsule(v(0, -0.3, 0), v(0, -0.62, 0), 0.17);
    return group([palm, fingers, thumb, wrist], o);
  }
  function person(o) {
    return group([
      P.sphere(v(0, 1.55, 0), 0.17),
      P.capsule(v(0, 0.95, 0), v(0, 1.3, 0), 0.2),
      P.capsule(v(-0.22, 1.25, 0), v(-0.32, 0.8, 0.05), 0.07), P.capsule(v(0.22, 1.25, 0), v(0.32, 0.8, 0.05), 0.07),
      P.capsule(v(-0.1, 0.8, 0), v(-0.12, 0.05, 0), 0.08), P.capsule(v(0.1, 0.8, 0), v(0.12, 0.05, 0), 0.08)
    ], o);
  }
  function bust(o) {
    return group([P.sphere(v(0, 0.42, 0), 0.24), P.capsule(v(0, 0.05, 0), v(0, 0.18, 0), 0.09), P.capsule(v(-0.3, -0.08, 0), v(0.3, -0.08, 0), 0.13)], o);
  }
  // A HoloLens: curved visor over the eyes plus the head band.
  function hololens() {
    const visor = { area: 0.3, sample: () => { const a = (rnd() - 0.5) * 2.2, y = 0.38 + rnd() * 0.12; return v(Math.sin(a) * 0.27, y, Math.cos(a) * 0.27); } };
    return [weight([visor], 3.0), weight([P.torus(v(0, 0.52, -0.02), 0.255, 0.025, -0.2)], 1.2)];
  }
  function seated(px, dir, hands) {
    return [
      P.sphere(v(px, 0.6, 0), 0.16), P.capsule(v(px, 0.38, 0), v(px, 0.46, 0), 0.07),
      P.capsule(v(px, -0.3, 0), v(px, 0.22, 0), 0.19), P.capsule(v(px, 0.28, -0.2), v(px, 0.28, 0.2), 0.09),
      hands.map((h, i) => { const z = i ? -0.2 : 0.2, e = v(px + dir * 0.2, 0.0, z); return weight([P.capsule(v(px, 0.28, z), e, 0.07), P.capsule(e, h, 0.06), P.sphere(h, 0.075)], 1.6); })
    ];
  }
  const pose = () => [
    P.sphere(v(0, 1.55, 0), 0.15), P.capsule(v(0, 1.0, 0), v(0, 1.35, 0), 0.17),
    P.capsule(v(-0.18, 1.3, 0), v(-0.55, 1.75, 0), 0.06), P.capsule(v(0.18, 1.3, 0), v(0.55, 1.75, 0), 0.06),
    P.capsule(v(-0.08, 0.95, 0), v(-0.08, 0.05, 0), 0.07), P.capsule(v(0.08, 0.95, 0), v(0.5, 0.45, 0.05), 0.07)
  ];
  // Background: outlines of Japan and Canada (Natural Earth 110m, [lon, lat] pairs), each drawn at its own scale.
  const CANADA = [[-122.8,49.0,-123.0,49.0,-124.9,50.0,-125.6,50.4,-127.4,50.8,-128.0,51.7,-127.8,52.3,-129.1,52.8,-129.3,53.6,-130.5,54.3,-130.5,54.8,-130.0,55.3,-130.0,55.9,-131.7,56.5,-132.7,57.7,-133.3,58.4,-134.3,58.9,-134.9,59.3,-135.5,59.8,-136.5,59.5,-137.4,58.9,-138.3,59.6,-139.0,60.0,-140.0,60.3,-141.0,60.3,-141.0,66.0,-141.0,69.7,-139.1,69.5,-137.5,69.0,-136.5,68.9,-135.6,69.3,-134.4,69.6,-132.9,69.5,-131.4,69.9,-129.8,70.2,-129.1,69.8,-128.4,70.0,-128.1,70.5,-127.5,70.4,-125.8,69.5,-124.4,70.2,-124.3,69.4,-123.1,69.6,-122.7,69.9,-121.5,69.8,-119.9,69.4,-117.6,69.0,-116.2,68.8,-115.2,68.9,-113.9,68.4,-115.3,67.9,-113.5,67.7,-110.8,67.8,-110.0,68.0,-108.9,67.4,-107.8,67.9,-108.8,68.3,-108.2,68.7,-107.0,68.7,-106.2,68.8,-105.3,68.6,-104.3,68.0,-103.2,68.1,-101.5,67.7,-99.9,67.8,-98.4,67.8,-98.6,68.4,-97.7,68.6,-96.1,68.2,-96.1,67.3,-95.5,68.1,-94.7,68.1,-94.2,69.1,-95.3,69.7,-96.5,70.1,-96.4,71.2,-95.2,71.9,-93.9,71.8,-92.9,71.3,-91.5,70.2,-92.4,69.7,-90.5,69.5,-90.5,68.5,-89.2,69.3,-88.0,68.6,-88.3,67.9,-87.3,67.2,-86.3,67.9,-85.6,68.8,-85.5,69.9,-84.1,69.8,-82.6,69.7,-81.3,69.2,-81.2,68.7,-82.0,68.1,-81.3,67.6,-81.4,67.1,-83.3,66.4,-84.7,66.3,-85.8,66.6,-86.1,66.1,-87.0,65.2,-87.3,64.8,-88.5,64.1,-89.9,64.0,-90.7,63.6,-90.8,63.0,-91.9,62.8,-93.2,62.0,-94.2,60.9,-94.6,60.1,-94.7,59.0,-93.2,58.8,-92.8,57.9,-92.3,57.1,-90.9,57.3,-89.0,56.9,-88.0,56.5,-87.3,56.0,-86.1,55.7,-85.0,55.3,-83.4,55.2,-82.3,55.1,-82.4,54.3,-82.1,53.3,-81.4,52.2,-79.9,51.2,-79.1,51.5,-78.6,52.6,-79.1,54.1,-79.8,54.7,-78.2,55.1,-77.1,55.8,-76.5,56.5,-76.6,57.2,-77.3,58.0,-78.5,58.8,-77.3,59.9,-77.8,60.8,-78.1,62.3,-77.4,62.5,-75.7,62.3,-74.7,62.2,-73.8,62.4,-72.9,62.1,-71.7,61.5,-71.4,61.1,-69.6,61.1,-69.6,60.2,-69.3,59.0,-68.4,58.8,-67.7,58.2,-66.2,58.8,-65.2,59.9,-64.6,60.3,-63.8,59.4,-62.5,58.2,-61.4,57.0,-61.8,56.3,-60.5,55.8,-59.6,55.2,-58.0,55.0,-57.3,54.6,-56.9,53.8,-56.2,53.6,-55.8,53.3,-55.7,52.1,-56.4,51.8,-57.1,51.4,-58.8,51.1,-60.0,50.2,-61.7,50.1,-63.9,50.3,-65.4,50.3,-66.4,50.2,-67.2,49.5,-68.5,49.1,-70.0,47.7,-71.1,46.8,-70.3,47.0,-68.7,48.3,-66.5,49.1,-65.1,49.2,-64.2,48.7,-65.1,48.1,-64.8,47.0,-64.5,46.2,-63.2,45.7,-61.5,45.9,-60.5,47.0,-60.5,46.3,-59.8,45.9,-61.0,45.3,-63.2,44.7,-64.2,44.3,-65.4,43.5,-66.1,43.6,-66.2,44.5,-64.4,45.3,-66.0,45.3,-67.1,45.1,-67.8,45.7,-67.8,47.1,-68.2,47.4,-68.9,47.2,-69.2,47.5,-70.0,46.7,-70.3,45.9,-70.7,45.5,-71.1,45.3,-71.4,45.2,-71.5,45.0,-73.3,45.0,-74.9,45.0,-75.3,44.8,-76.4,44.1,-76.5,44.0,-76.8,43.6,-77.7,43.6,-78.7,43.6,-79.2,43.5,-79.0,43.3,-78.9,43.0,-78.9,42.9,-80.2,42.4,-81.3,42.2,-82.4,41.7,-82.7,41.7,-83.0,41.8,-83.1,42.0,-83.1,42.1,-82.9,42.4,-82.4,43.0,-82.1,43.6,-82.3,44.4,-82.5,45.4,-83.6,45.8,-83.5,46.0,-83.6,46.1,-83.9,46.1,-84.1,46.3,-84.1,46.5,-84.3,46.4,-84.6,46.4,-84.5,46.5,-84.8,46.6,-84.9,46.9,-85.7,47.2,-86.5,47.5,-87.4,47.9,-88.4,48.3,-89.3,48.0,-89.6,48.0,-90.8,48.3,-91.6,48.1,-92.6,48.5,-93.6,48.6,-94.3,48.7,-94.6,48.8,-94.8,49.4,-95.2,49.4,-95.2,49.0,-97.2,49.0,-100.7,49.0,-104.0,49.0,-107.0,49.0,-110.0,49.0,-113.0,49.0,-116.0,49.0,-117.0,49.0,-120.0,49.0,-122.8,49.0],[-88.2,74.4,-89.8,74.5,-92.4,74.8,-92.8,75.4,-92.9,75.9,-93.9,76.3,-96.0,76.4,-97.1,76.8,-96.8,77.2,-94.7,77.1,-93.6,76.8,-91.6,76.8,-90.7,76.5,-91.0,76.1,-89.8,75.8,-89.2,75.6,-87.8,75.6,-86.4,75.5,-84.8,75.7,-82.8,75.8,-81.1,75.7,-80.1,75.3,-79.8,74.9,-80.5,74.7,-82.0,74.4,-83.2,74.6,-86.1,74.4,-88.2,74.4],[-55.6,51.3,-56.1,50.7,-56.8,49.8,-56.1,50.1,-55.5,49.9,-55.8,49.6,-54.9,49.3,-54.5,49.6,-53.5,49.2,-53.8,48.5,-53.1,48.7,-53.0,48.2,-52.6,47.5,-53.1,46.7,-53.5,46.6,-54.2,46.8,-54.0,47.6,-54.2,47.8,-55.4,46.9,-56.0,46.9,-55.3,47.4,-56.2,47.6,-57.3,47.6,-59.3,47.6,-59.4,47.9,-58.8,48.2,-59.2,48.5,-58.4,49.1,-57.4,50.7,-56.7,51.3,-55.9,51.6,-55.4,51.6,-55.6,51.3],[-83.9,65.1,-82.8,64.8,-81.6,64.5,-81.5,64.0,-80.8,64.1,-80.1,63.7,-81.0,63.4,-82.5,63.6,-83.1,64.1,-84.1,63.6,-85.5,63.0,-85.9,63.6,-87.2,63.5,-86.3,64.0,-86.2,64.8,-85.9,65.7,-85.2,65.7,-85.0,65.2,-84.5,65.4,-83.9,65.1],[-78.8,72.3,-77.8,72.8,-75.6,72.2,-74.2,71.8,-74.1,71.3,-72.2,71.6,-71.2,70.9,-68.8,70.5,-67.9,70.1,-67.0,69.2,-68.8,68.7,-66.5,68.1,-64.9,67.8,-63.4,66.9,-61.9,66.9,-62.2,66.2,-63.9,65.0,-65.2,65.4,-66.7,66.4,-68.0,66.3,-68.1,65.7,-67.1,65.1,-65.7,64.7,-65.3,64.4,-64.7,63.4,-65.0,62.7,-66.3,63.0,-68.8,63.8,-67.4,62.9,-66.3,62.3,-66.2,61.9,-68.9,62.3,-71.0,62.9,-72.2,63.4,-71.9,63.7,-73.4,64.2,-74.8,64.7,-74.8,64.4,-77.7,64.2,-78.5,64.6,-77.9,65.3,-76.0,65.3,-74.0,65.5,-74.3,65.8,-74.0,66.3,-72.7,67.3,-72.9,67.7,-73.3,68.1,-74.8,68.5,-76.9,68.9,-76.2,69.2,-77.3,69.8,-78.2,69.8,-79.0,70.2,-79.5,69.9,-81.3,69.7,-84.9,70.0,-87.1,70.3,-88.7,70.4,-89.5,70.8,-88.5,71.2,-89.9,71.2,-90.2,72.2,-89.4,73.1,-88.4,73.5,-85.8,73.8,-86.6,73.2,-85.8,72.5,-84.8,73.3,-82.3,73.8,-80.6,72.7,-80.8,72.1,-78.8,72.3],[-123.5,48.5,-124.0,48.4,-125.7,48.8,-126.0,49.2,-126.8,49.5,-127.0,49.8,-128.1,50.0,-128.4,50.5,-128.4,50.8,-127.3,50.5,-126.7,50.4,-125.8,50.3,-125.4,50.0,-124.9,49.5,-123.9,49.1,-123.5,48.5],[-121.5,74.5,-120.1,74.2,-117.6,74.2,-116.6,73.9,-115.5,73.5,-116.8,73.2,-119.2,72.5,-120.5,71.8,-120.5,71.4,-123.1,70.9,-123.6,71.3,-125.9,71.9,-125.5,72.3,-124.8,73.0,-123.9,73.7,-124.9,74.3,-121.5,74.5],[-107.8,75.8,-106.9,76.0,-105.9,76.0,-105.7,75.5,-106.3,75.0,-109.7,74.8,-112.2,74.4,-113.7,74.4,-113.9,74.7,-111.8,75.2,-116.3,75.0,-117.7,75.2,-116.3,76.2,-115.4,76.5,-112.6,76.1,-110.8,75.5,-109.1,75.5,-110.5,76.4,-109.6,76.8,-108.5,76.7,-108.2,76.2,-107.8,75.8],[-106.5,73.1,-105.4,72.7,-104.8,71.7,-104.5,71.0,-102.8,70.5,-101.0,70.0,-101.1,69.6,-102.7,69.5,-102.1,69.1,-102.4,68.8,-104.2,68.9,-106.0,69.2,-107.1,69.1,-109.0,68.8,-111.5,68.6,-113.3,68.5,-113.9,69.0,-115.2,69.3,-116.1,69.2,-117.3,70.0,-116.7,70.1,-115.1,70.2,-113.7,70.2,-112.4,70.4,-114.3,70.6,-116.5,70.5,-117.9,70.5,-118.4,70.9,-116.1,71.3,-117.7,71.3,-119.4,71.6,-118.6,72.3,-117.9,72.7,-115.2,73.3,-114.2,73.1,-114.7,72.7,-112.4,73.0,-111.0,72.5,-109.9,73.0,-109.0,72.6,-108.2,71.7,-107.7,72.1,-108.4,73.1,-107.5,73.2,-106.5,73.1],[-96.0,80.6,-95.3,80.9,-94.3,81.0,-94.7,81.2,-92.4,81.3,-91.1,80.7,-89.5,80.5,-87.8,80.3,-87.0,79.7,-85.8,79.3,-87.2,79.0,-89.0,78.3,-90.8,78.2,-92.9,78.3,-94.0,78.8,-93.9,79.1,-93.2,79.4,-95.0,79.4,-96.1,79.7,-96.7,80.2,-96.0,80.6],[-91.6,81.9,-90.1,82.1,-88.9,82.1,-87.0,82.3,-85.5,82.7,-84.3,82.6,-83.2,82.3,-82.4,82.9,-81.1,83.0,-79.3,83.1,-76.2,83.2,-75.7,83.1,-72.8,83.2,-70.7,83.2,-68.5,83.1,-65.8,83.0,-63.7,82.9,-61.9,82.6,-61.9,82.4,-64.3,81.9,-66.8,81.7,-67.7,81.5,-65.5,81.5,-67.8,80.9,-69.5,80.6,-71.2,79.8,-73.2,79.6,-73.9,79.4,-76.9,79.3,-75.5,79.2,-76.2,79.0,-75.4,78.5,-76.3,78.2,-77.9,77.9,-78.4,77.5,-79.8,77.2,-79.6,77.0,-77.9,77.0,-77.9,76.8,-80.6,76.2,-83.2,76.5,-86.1,76.3,-87.6,76.4,-89.5,76.5,-89.6,77.0,-87.8,77.2,-88.3,77.9,-87.7,78.0,-85.0,77.5,-86.3,78.2,-88.0,78.4,-87.2,78.8,-85.4,79.0,-85.1,79.3,-86.5,79.7,-86.9,80.2,-84.2,80.2,-83.4,80.1,-81.8,80.5,-84.1,80.6,-87.6,80.5,-89.4,80.9,-90.2,81.3,-91.4,81.5,-91.6,81.9]];
  const JAPAN = [[141.9,39.2,141.0,38.2,141.0,37.1,140.6,36.3,140.8,35.8,140.2,35.1,139.0,34.7,137.2,34.6,135.8,33.5,135.1,33.9,135.1,34.6,133.3,34.4,132.2,33.9,131.0,33.9,132.0,33.1,131.3,31.4,130.7,31.0,130.2,31.4,130.4,32.3,129.8,32.6,129.4,33.3,130.4,33.6,130.9,34.2,131.9,34.8,132.6,35.4,134.6,35.7,135.7,35.5,136.7,37.3,137.4,36.8,138.9,37.8,139.4,38.2,140.1,39.4,139.9,40.6,140.3,41.2,141.4,41.4,141.9,40.0,141.9,39.2],[144.6,44.0,145.3,44.4,145.5,43.3,144.1,43.0,143.2,42.0,141.6,42.7,141.1,41.6,140.0,41.6,139.8,42.6,140.3,43.3,141.4,43.4,141.7,44.8,142.0,45.5,143.1,44.5,143.9,44.2,144.6,44.0],[132.4,33.5,132.9,34.1,133.5,33.9,133.9,34.4,134.6,34.1,134.8,33.8,134.2,33.2,133.8,33.5,133.3,33.3,133.0,32.7,132.4,33.0,132.4,33.5]];
  const where = { jp: { lon: 137.5, lat: 38, cx: -0.78, cy: -0.5, s: 0.052 }, ca: { lon: -97, lat: 62, cx: 0.52, cy: 0.42, s: 0.024 } };
  const proj = (b, lon, lat) => v(b.cx + (lon - b.lon) * Math.cos(b.lat * Math.PI / 180) * b.s, b.cy + (lat - b.lat) * b.s, 0);
  const tokyo = proj(where.jp, 139.69, 35.68), calgary = proj(where.ca, -114.07, 51.05);
  // Points spread evenly along a set of rings.
  function outline(rings, b) {
    const segs = rings.flatMap((r) => { const pts = []; for (let k = 0; k < r.length; k += 2) pts.push(proj(b, r[k], r[k + 1])); return pts.map((p, k) => [p, pts[(k + 1) % pts.length]]); });
    const len = segs.map(([a, c]) => a.distanceTo(c)), total = len.reduce((x, y) => x + y, 0);
    return { area: total * 0.06, sample: () => { let r = rnd() * total, k = 0; while (r > len[k] && k < segs.length - 1) r -= len[k++];
      return segs[k][0].clone().lerp(segs[k][1], rnd()).add(v((rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.02)); } };
  }
  const toio = (x, z, s = 1) => P.box(v(x, 0.06 * s, z), [0.2 * s, 0.12 * s, 0.2 * s]);

  // ---------- the eight projects (keys match the card ids) ----------
  const shapes = {
    idle: build([P.sphere(v(0, 0, 0), 1.05), weight([P.sphere(v(0, 0, 0), 0.6)], 0.4)]),
    chameleoncontrol: build([group([
      weight([P.sphere(v(0, 0, 0), 0.42)], 0.55),
      weight([P.capsule(v(0, -0.45, 0), v(0, -0.72, 0), 0.16), P.capsule(v(-0.55, -0.82, -0.02), v(0.55, -0.82, -0.02), 0.13)], 0.5),
      P.box(v(0, 0.05, 0.38), [0.72, 0.4, 0.26]),
      weight([P.torus(v(0, 0.06, 0), 0.44, 0.03)], 0.8),
      // the iPad, mounted upright on the front, showing the remote instructor
      P.box(v(0, 0.05, 0.56), [0.5, 0.8, 0.035]),
      weight([
        P.ring(v(0, 0.14, 0.59), 0.12, 'z', 0.02),
        arc(v(0, 0.15, 0.59), 0.135, Math.PI * 0.08, Math.PI * 0.92, 0.04),
        P.sphere(v(-0.045, 0.16, 0.59), 0.018), P.sphere(v(0.045, 0.16, 0.59), 0.018),
        arc(v(0, 0.12, 0.59), 0.05, Math.PI * 1.25, Math.PI * 1.75, 0.015),
        P.capsule(v(0, 0.0, 0.59), v(0, -0.05, 0.59), 0.025),
        arc(v(0, -0.3, 0.59), 0.2, Math.PI * 0.12, Math.PI * 0.88, 0.025)
      ], 3.0),
      P.box(v(0, 0.52, 0.5), [0.32, 0.08, 0.09]),
      weight([P.sphere(v(-0.09, 0.52, 0.55), 0.028), P.sphere(v(0.09, 0.52, 0.55), 0.028)], 2.0)
    ], { pos: v(0, 0.1, 0), ry: -0.6, s: 1.3 })]),
    'scalable-academy': build([0, 1, 2].flatMap((cx) => [0, 1].flatMap((cz) => group([
      P.sphere(v(0, 0.78, -0.02), 0.09),
      P.capsule(v(0, 0.45, -0.1), v(0, 0.68, -0.04), 0.1),
      P.capsule(v(-0.08, 0.62, -0.05), v(-0.08, 0.36, 0.14), 0.035), P.capsule(v(0.08, 0.62, -0.05), v(0.08, 0.36, 0.14), 0.035),
      P.capsule(v(-0.05, 0.45, -0.1), v(-0.05, 0.0, -0.12), 0.04), P.capsule(v(0.05, 0.45, -0.1), v(0.05, 0.0, -0.12), 0.04),
      weight([P.box(v(0, 0.3, 0.22), [0.28, 0.05, 0.5])], 0.8),
      P.capsule(v(0, 0.36, 0.1), v(0, 0.36, 0.38), 0.045)
    ], { pos: v(-0.85 + cx * 0.85, -0.6, -0.45 + cz * 0.9), s: 1.15 })))),
    // A real hand reaches for a remote person's hologram hand, which a robot underneath makes physical.
    // A remote person's hologram sits across the table; its hand rests on a robot, so the local person can touch it.
    holobots: build([
      P.box(v(0, -0.11, 0), [1.1, 0.04, 0.9]),
      weight([P.capsule(v(-0.48, -0.13, 0), v(-0.48, -0.65, 0), 0.025), P.capsule(v(0.48, -0.13, 0), v(0.48, -0.65, 0), 0.025)], 0.6),
      seated(-1.0, 1, [v(-0.13, 0.02, 0.08), v(-0.42, -0.04, -0.2)]),
      holo(seated(1.0, -1, [v(0.14, 0.2, 0.06), v(0.42, -0.03, -0.2)]), 8, 0.32),
      weight([group([toio(0, 0)], { pos: v(0.12, -0.09, 0.05), s: 1.8 })], 1.4)
    ]),
    video2mr: build([
      weight([P.frame(v(-0.75, 0.2, -0.45), 0.9, 0.8, 0.03)], 1.3),
      weight(clip(flatten(group(pose(), { pos: v(-0.75, -0.55, 0), s: 0.62 }), -0.45), v(-1.18, -0.18, -1), v(-0.32, 0.58, 1)), 0.9),
      group(pose(), { pos: v(0.12, -0.95, 0.25), s: 0.8 }),
      [0, 1, 2].map((i) => { const a = i / 3 * Math.PI * 2 + 0.4; return P.capsule(v(0.98, -0.05, 0.78), v(0.98 + Math.cos(a) * 0.28, -0.95, 0.78 + Math.sin(a) * 0.28), 0.013); }),
      group([P.box(v(0, 0.08, 0), [0.34, 0.09, 0.12]), P.sphere(v(0.07, 0.08, 0.065), 0.025), P.capsule(v(0, 0.0, 0), v(0, 0.04, 0), 0.03)], { pos: v(0.98, -0.05, 0.78), ry: -2.1, s: 1.6 }),
      weight([P.capsule(v(0.9299999999999999, 0.03, 0.73), v(0.12, 0.45, 0.25), 0.004), P.capsule(v(0.9299999999999999, 0.03, 0.73), v(0.15, -0.9, 0.25), 0.004)], 0.5)
    ]),
    'sketched-reality': build([
      P.box(v(-1.05, -0.2, 0), [0.06, 0.9, 0.9]),
      P.helix(v(-1.0, -0.35, 0), v(0.05, -0.35, 0), 0.13, 7, 0.012),
      group([toio(0, 0)], { pos: v(0.2, -0.53, 0), s: 1.8 }),
      P.capsule(v(0.5, 0.75, 0), v(0.75, 0.05, 0.1), 0.012),
      P.sphere(v(0.77, 0.0, 0.1), 0.13),
      P.box(v(0, -0.66, 0), [2.2, 0.03, 1.0])
    ]),
    'augmented-conversation': build([
      bust({ pos: v(-0.7, -0.35, 0), ry: 0.5 }), group(hololens(), { pos: v(-0.7, -0.35, 0), ry: 0.5 }),
      bust({ pos: v(0.7, -0.35, 0), ry: -0.5 }), group(hololens(), { pos: v(0.7, -0.35, 0), ry: -0.5 }),
      [v(-0.15, 0.55, 0.1), v(0.2, 0.75, -0.1), v(0.05, 0.3, 0.25)].map((c, i) => weight([P.frame(c, 0.38 - i * 0.06, 0.16, 0.02), P.box(c, [0.36 - i * 0.06, 0.14, 0.005])], 1.2))
    ]),
    ultrabots: build([
      weight([P.box(v(0, -0.82, 0), [0.55, 0.22, 0.55])], 0.8),
      weight([P.box(v(0, -0.68, 0), [1.15, 0.05, 1.15])], 0.6),
      [...Array(36)].map((_, i) => P.sphere(v(-0.5 + (i % 6) * 0.2, -0.62, -0.5 + Math.floor(i / 6) * 0.2), 0.06)),
      [0.12, 0.26, 0.4].map((r, i) => weight([P.ring(v(0, -0.15 + i * 0.12, 0), r * 0.7, 'y', 0.012)], 0.35)),
      hand({ pos: v(0.05, 0.45, 0), rz: -1.35, s: 0.95 })
    ]),
    // ---------- the later sections ----------
    // Background: Japan and Canada, with Tokyo and Calgary joined by a plain arc.
    background: (() => {
      const mid = tokyo.clone().lerp(calgary, 0.5).add(v(0.28, -0.26, 0.15));
      const line = { area: 0.4, sample: () => { const t = rnd(), u = 1 - t; return tokyo.clone().multiplyScalar(u * u).addScaledVector(mid, 2 * u * t).addScaledVector(calgary, t * t).add(randDir().multiplyScalar(0.005)); } };
      return build([outline(JAPAN, where.jp), outline(CANADA, where.ca), weight([line], 0.7), weight([P.sphere(tokyo, 0.035), P.sphere(calgary, 0.035)], 1.6)]);
    })(),
    // Publications: a fanned stack of papers, the top one in two columns.
    publications: build([
      [0, 1].map((i) => group([weight([P.frame(v(0, 0, 0), 0.85, 1.1, 0.02)], 0.6), weight([P.box(v(0, 0, 0), [0.85, 1.1, 0.004])], 0.06)], { pos: v(-0.32 + i * 0.16, 0.06 - i * 0.04, -0.3 + i * 0.15), rz: 0.24 - i * 0.12 })),
      group([
        weight([P.frame(v(0, 0, 0), 0.85, 1.1, 0.02)], 1.2), weight([P.box(v(0, 0, 0), [0.85, 1.1, 0.004])], 0.05),
        weight([P.box(v(0, 0.42, 0.01), [0.6, 0.05, 0.01]), P.box(v(0, 0.33, 0.01), [0.4, 0.025, 0.01])], 2.5),
        [-1, 1].map((c) => [...Array(8)].map((_, k) => weight([P.box(v(c * 0.2, 0.2 - k * 0.08, 0.01), [0.32, 0.02, 0.01])], 2.5)))
      ], { pos: v(0.15, -0.08, 0.15), rz: -0.06 })
    ]),
    // Awards: a trophy cup with handles on a two-step base.
    awards: build([
      P.lathe(v(0, 0, 0), 0.05, 0.75, (t) => 0.1 + 0.4 * Math.sqrt(t)),
      weight([P.ring(v(0, 0.75, 0), 0.5, 'y', 0.03)], 1.5),
      [-1, 1].map((sd) => weight([arc(v(sd * 0.52, 0.45, 0), 0.17, sd > 0 ? -Math.PI / 2 : Math.PI / 2, sd > 0 ? Math.PI / 2 : Math.PI * 1.5, 0.05)], 1.4)),
      P.capsule(v(0, -0.35, 0), v(0, 0.05, 0), 0.07),
      P.box(v(0, -0.42, 0), [0.42, 0.1, 0.42]), P.box(v(0, -0.58, 0), [0.62, 0.22, 0.62])
    ]),
    // Skills: a VR headset with its strap and two controllers.
    skills: build([
      group([
        P.box(v(0, 0, 0.22), [0.9, 0.48, 0.32]),
        weight([P.box(v(0, 0, 0.03), [0.8, 0.4, 0.06])], 0.6),
        weight([P.torus(v(0, 0, -0.25), 0.43, 0.03)], 1.6)
      ], { pos: v(0, 0.3, 0), ry: -0.55 }),
      [-1, 1].map((sd) => group([P.torus(v(0, 0, 0), 0.17, 0.025, 0.9), P.capsule(v(0, -0.06, 0.02), v(0, -0.48, 0.12), 0.06)], { pos: v(sd * 0.55, -0.32, 0.25), rz: sd * -0.25 }))
    ]),
    phinix: build([
      [...Array(9)].map((_, i) => { const a = i / 9 * Math.PI * 2; return P.box(v(Math.cos(a) * 0.62, -0.2, Math.sin(a) * 0.62), [0.2, 0.22, 0.2]); }),
      weight([P.torus(v(0, -0.2, 0), 0.62, 0.05)], 0.6),
      P.box(v(0, 0.75, 0), [0.9, 0.22, 0.2]),
      P.sphere(v(-0.27, 0.75, 0.12), 0.07), P.sphere(v(0.27, 0.75, 0.12), 0.07), P.sphere(v(0, 0.75, 0.12), 0.05)
    ])
  };
  const tilt = { idle: 0.15, chameleoncontrol: 0.05, 'scalable-academy': 0.62, holobots: 0.22, video2mr: 0.12, 'sketched-reality': 0.32, 'augmented-conversation': 0.12, ultrabots: 0.35, phinix: 0.5, background: 0.05, publications: 0.05, awards: 0.15, skills: 0.3 };
  // ---------- annotations: [text, point] in the cloud's space, with the same transforms as the shapes ----------
  const at = (x, y, z, o = {}) => v(x, y, z).applyMatrix4(new THREE.Matrix4().compose(o.pos || v(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)), v(o.s || 1, o.s || 1, o.s || 1)));
  const headset = { pos: v(0, 0.1, 0), ry: -0.6, s: 1.3 };
  const notes = {
    chameleoncontrol: [['ZED Mini stereo camera', at(0, 0.52, 0.55, headset), [0, -1, 45]], ['Meta Quest 2', at(0.36, 0.05, 0.38, headset), [1, -0.3, 45]], ['iPad Air showing the instructor', at(0, -0.25, 0.58, headset), [-1, 0.4, 60]]],
    'scalable-academy': [['Each student as a live 3D pointcloud', at(0.85, 0.3, -0.47), [0.2, -1, 50]], ['Massage table', at(-0.85, -0.25, 0.7), [-0.3, 1, 55]]],
    holobots: [['Remote person’s hologram', at(1.0, 0.2, 0), [0.3, -1, 90]], ['Local person', at(-1.0, 0.6, 0), [-0.3, -1, 45]], ['Sony Toio robot', at(0.12, 0.13, 0.05), [0.25, 1, 75]]],
    video2mr: [['2D tutorial video', at(-0.75, 0.62, -0.45), [-0.2, -1, 40]], ['3D avatar from the video', at(0.12, 0.29, 0.25), [0, -1, 70]], ['Azure Kinect', at(0.98, 0.1, 0.78), [0.1, -1, 45]]],
    'sketched-reality': [['Sketched spring', at(-0.5, -0.22, 0), [-0.4, -1, 60]], ['Sony Toio robot', at(0.2, -0.32, 0), [0.2, 1, 75]], ['Sketched pendulum', at(0.77, 0.14, 0.1), [0.5, -1, 50]]],
    'augmented-conversation': [['HoloLens 2', at(0, 0.44, 0.27, { pos: v(-0.7, -0.35, 0), ry: 0.5 }), [-0.3, -1, 55]], ['Keyword tags', at(0.2, 0.84, -0.1), [0, -1, 45]]],
    ultrabots: [['Mid-air touch', at(0.25, 0.05, 0), [1, -0.2, 45]], ['Ultrasound array', at(0.5, -0.62, 0.3), [0.5, 1, 85]], ['Sony Toio robot', at(-0.15, -0.9, 0.28), [0, 1, 50]]],
    background: [['Tokyo', tokyo, [0.3, 1, 40]], ['Calgary', calgary, [-0.2, -1, 45]]],
    phinix: [['AI cameras', at(0.27, 0.86, 0.12), [0.2, -1, 45]], ['Haptic bracelet', at(0.62, -0.2, 0), [0.4, 1, 60]]]
  };

  const keys = fixed ? [fixed] : cards.map((c) => c.id.replace(/^w-/, ''));
  const names = Object.fromEntries(cards.map((c) => [c.id.replace(/^w-/, ''), (c.querySelector('h3') || c).childNodes[0].textContent.trim()]));
  // Sections after Selected work, each with its own shape (keys match the section ids).
  const sections = fixed ? [] : ['background', 'publications', 'awards', 'skills'].map((id) => document.getElementById(id)).filter(Boolean);
  for (const el of sections) names[el.id] = el.querySelector('h2').textContent.trim();

  // ---------- renderer ----------
  const canvas = aside.querySelector('canvas');
  const label = aside.querySelector('.companion-label');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const geo = new THREE.BufferGeometry();
  const from = new Float32Array(shapes.idle), to = new Float32Array(shapes.idle), jitter = new Float32Array(N);
  for (let i = 0; i < N; i++) jitter[i] = rnd();
  geo.setAttribute('position', new THREE.BufferAttribute(from, 3));
  geo.setAttribute('target', new THREE.BufferAttribute(to, 3));
  geo.setAttribute('jitter', new THREE.BufferAttribute(jitter, 1));
  const uniforms = { uMix: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uSize: { value: 2.9 }, uAlpha: { value: 0.85 }, uScale: { value: renderer.getPixelRatio() } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec3 target; attribute float jitter;
      uniform float uMix, uTime, uSize, uScale;
      varying float vFade;
      void main() {
        float m = smoothstep(0.0, 1.0, clamp(uMix * 1.3 - jitter * 0.3, 0.0, 1.0));
        vec3 p = mix(position, target, m);
        p += normalize(vec3(sin(jitter * 91.0), cos(jitter * 57.0), sin(jitter * 33.0))) * sin(3.14159 * m) * 0.35;
        p += 0.008 * vec3(sin(uTime * 1.3 + jitter * 50.0), cos(uTime * 1.1 + jitter * 40.0), 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uScale * (5.0 / -mv.z);
        vFade = clamp(1.25 - (-mv.z - 4.2) * 0.35, 0.35, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uAlpha; varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(uColor, uAlpha * vFade * smoothstep(0.5, 0.2, d));
      }`
  });
  const cloud = new THREE.Points(geo, mat);
  scene.add(cloud);

  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    uniforms.uColor.value.set(css.getPropertyValue('--accent').trim() || '#0e6b66');
    const dark = (document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    mat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    uniforms.uAlpha.value = dark ? 0.75 : 0.95;
    mat.needsUpdate = true;
  }
  readTheme();
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  let camDist = 6;
  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    const half = Math.min(camera.fov / 2, THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)));
    camDist = 1.45 / Math.sin(THREE.MathUtils.degToRad(half));
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- the headline word decides the shape; scrolling only fades the column in and out ----------
  let segA = 'idle', segB = 'idle', mix = 0, mixTarget = 0, visible = 0, visibleTarget = 0;
  const speed = 0.06;
  function setSegment(a, b) {
    from.set(shapes[a]); to.set(shapes[b]);
    geo.attributes.position.needsUpdate = true; geo.attributes.target.needsUpdate = true;
    segA = a; segB = b;
  }
  function morphTo(k) {
    const cur = mix > 0.5 ? segB : segA;
    if (cur === k) return;
    setSegment(cur, k); mix = 0; mixTarget = 1;
    if (label && !fixed) label.textContent = names[k] || '';
  }
  // In Selected work the headline word picks the project; past it, the section in view picks the shape.
  let project = fixed || (document.querySelector('#work .project.is-on') || cards[0]).id.replace(/^w-/, ''), section = null;
  document.addEventListener('verbchange', (e) => { project = e.detail.id.replace(/^w-/, ''); if (!section) morphTo(project); });
  morphTo(project);
  function onScroll() {
    if (fixed) { visibleTarget = 1; return; }
    visibleTarget = work.getBoundingClientRect().top < innerHeight * 0.9 ? 1 : 0;
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 4;
    let s = null;
    for (const el of sections) if (el.getBoundingClientRect().top < innerHeight * (atEnd ? 0.95 : 0.5)) s = el.id;
    if (s !== section) { section = s; morphTo(s || project); }
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  // ---------- render loop: gentle sway, follows the pointer slightly ----------
  const pointer = new THREE.Vector2();
  addEventListener('pointermove', (e) => pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5), { passive: true });
  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) requestAnimationFrame(loop); });
  const t0 = performance.now();
  function frame(time) {
    mix += (mixTarget - mix) * speed; visible += (visibleTarget - visible) * 0.08;
    uniforms.uMix.value = mix; uniforms.uTime.value = time;
    cloud.rotation.y = Math.sin(time * 0.25) * 0.5 + pointer.x * 0.6;
    const tx = (tilt[segA] ?? 0.2) * (1 - mix) + (tilt[segB] ?? 0.2) * mix;
    cloud.rotation.x = tx + pointer.y * 0.25;
    camera.position.set(0, 0.12, camDist); camera.lookAt(0, -0.05, 0);
    aside.style.opacity = visible.toFixed(3);
    renderer.render(scene, camera);
    placeNotes();
  }
  // Labels sit just outside each point (pushed away from the centre unless a note gives its own direction and distance),
  // then nudge each other apart so none overlap, with a thin leader line back to the point.
  const layer = document.createElement('div'); layer.className = 'companion-notes';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.appendChild(svg); aside.appendChild(layer);
  let shown = null, els = [];
  const tmp = new THREE.Vector3();
  function placeNotes() {
    const k = mix > 0.5 ? segB : segA;
    if (k !== shown) {
      shown = k; svg.innerHTML = ''; layer.querySelectorAll('span').forEach((n) => n.remove());
      els = (notes[k] || []).map(([text, p, dir]) => {
        const span = document.createElement('span'); span.textContent = text; layer.appendChild(span);
        const ns = 'http://www.w3.org/2000/svg', halo = document.createElementNS(ns, 'line'), line = document.createElementNS(ns, 'line'), dot = document.createElementNS(ns, 'circle');
        halo.setAttribute('class', 'halo'); dot.setAttribute('r', 3.5); svg.append(halo, line, dot);
        return { p, dir, span, halo, line, dot, w: 0, h: 0 };
      });
      for (const e of els) { e.w = e.span.offsetWidth; e.h = e.span.offsetHeight; }
    }
    const settled = segA === segB ? 1 : THREE.MathUtils.smoothstep(mix, 0.85, 1);
    layer.style.opacity = settled.toFixed(3);
    if (!settled || !els.length) return;
    const W = aside.clientWidth, H = aside.clientHeight, cw = canvas.clientWidth, ch = canvas.clientHeight, ox = canvas.offsetLeft, oy = canvas.offsetTop;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    cloud.updateMatrixWorld();
    for (const e of els) {
      tmp.copy(e.p).applyMatrix4(cloud.matrixWorld).project(camera);
      e.x = ox + (tmp.x + 1) / 2 * cw; e.y = oy + (1 - tmp.y) / 2 * ch;
      let [dx, dy] = e.dir || [e.x - (ox + cw / 2), e.y - (oy + ch / 2)];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const d = (e.dir && e.dir[2]) || 26, ax = e.x + dx * d, ay = e.y + dy * d;
      // Mostly vertical: centre the label over or under the point; otherwise hang it off to the side.
      if (Math.abs(dy) > 0.8) { e.lx = ax - e.w / 2; e.ly = dy < 0 ? ay - e.h : ay; }
      else { e.lx = dx < 0 ? ax - e.w : ax; e.ly = ay - e.h / 2; }
      e.lx = Math.min(Math.max(e.lx, 0), W - e.w);
    }
    for (let it = 0; it < 12; it++) {
      for (const a of els) for (const b of els) {
        if (a === b || a.lx > b.lx + b.w + 6 || b.lx > a.lx + a.w + 6) continue;
        const over = Math.min(a.ly + a.h, b.ly + b.h) + 4 - Math.max(a.ly, b.ly);
        if (over > 0) { const s = a.ly < b.ly || (a.ly === b.ly && a.lx < b.lx) ? -1 : 1; a.ly += s * over / 2; }
      }
      for (const e of els) e.ly = Math.min(Math.max(e.ly, 0), H - e.h);
    }
    for (const e of els) {
      e.span.style.transform = `translate(${e.lx.toFixed(1)}px, ${e.ly.toFixed(1)}px)`;
      // The leader ends at the nearest point on the label's box.
      const ex = Math.min(Math.max(e.x, e.lx), e.lx + e.w), ey = Math.min(Math.max(e.y, e.ly + 2), e.ly + e.h - 2);
      e.dot.setAttribute('cx', e.x); e.dot.setAttribute('cy', e.y);
      for (const l of [e.halo, e.line]) { l.setAttribute('x1', e.x); l.setAttribute('y1', e.y); l.setAttribute('x2', ex); l.setAttribute('y2', ey); }
    }
  }
  function loop() { if (!running) return; frame((performance.now() - t0) / 1000); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  // For checking stills: show one project fully formed.
  window.__companion = { show(k) { setSegment(k, k); mix = mixTarget = 0; visible = visibleTarget = 1; frame(2); }, keys, state: () => ({ segA, segB, mix: +mix.toFixed(2) }) };
}
