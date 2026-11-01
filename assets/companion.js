// Point-cloud companion: on wide screens, a cloud of points in the right-hand column
// reshapes into each project as you scroll through Selected work.
// Loads three.js only when the column is visible and the visitor allows motion.

const WIDE = '(min-width: 1200px)';
const aside = document.querySelector('.companion');
const work = document.getElementById('work');
const cards = Array.from(document.querySelectorAll('#work a.project'));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (aside && work && cards.length && !reduced) {
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
  const toio = (x, z, s = 1) => P.box(v(x, 0.06 * s, z), [0.2 * s, 0.12 * s, 0.2 * s]);

  // ---------- the eight projects (keys match the card ids) ----------
  const shapes = {
    idle: build([P.sphere(v(0, 0, 0), 1.05), weight([P.sphere(v(0, 0, 0), 0.6)], 0.4)]),
    chameleoncontrol: build([
      hand({ pos: v(-0.32, -0.15, 0.15), rz: 0.18, s: 1.1 }),
      weight(hand({ pos: v(0.32, 0.05, -0.25), rz: -0.12, ry: 0.15, s: 1.1 }), 0.55)
    ]),
    'scalable-academy': build([0, 1, 2].flatMap((cx) => [0, 1].flatMap((cz) => group([
      P.sphere(v(0, 0.78, -0.02), 0.09),
      P.capsule(v(0, 0.45, -0.1), v(0, 0.68, -0.04), 0.1),
      P.capsule(v(-0.08, 0.62, -0.05), v(-0.08, 0.36, 0.14), 0.035), P.capsule(v(0.08, 0.62, -0.05), v(0.08, 0.36, 0.14), 0.035),
      P.capsule(v(-0.05, 0.45, -0.1), v(-0.05, 0.0, -0.12), 0.04), P.capsule(v(0.05, 0.45, -0.1), v(0.05, 0.0, -0.12), 0.04),
      weight([P.box(v(0, 0.3, 0.22), [0.28, 0.05, 0.5])], 0.8),
      P.capsule(v(0, 0.36, 0.1), v(0, 0.36, 0.38), 0.045)
    ], { pos: v(-0.85 + cx * 0.85, -0.6, -0.45 + cz * 0.9), s: 1.15 })))),
    holobots: build([
      weight(person({ pos: v(-0.55, -1.0, -0.2), s: 0.85, ry: 0.4 }), 0.75),
      weight([P.box(v(0.25, -0.62, 0), [1.3, 0.04, 0.9])], 0.45),
      group([toio(0, 0), toio(0.45, 0.25), toio(-0.05, 0.4)], { pos: v(0.2, -0.6, -0.15), s: 2.0 }),
      P.box(v(0.65, -0.4, 0.15), [0.32, 0.4, 0.32])
    ]),
    video2mr: build([
      weight([P.frame(v(-0.55, 0.1, -0.4), 1.0, 0.75, 0.03)], 1.3),
      weight([P.box(v(-0.55, 0.1, -0.42), [0.96, 0.71, 0.005])], 0.25),
      group([
        P.sphere(v(0, 1.55, 0), 0.15), P.capsule(v(0, 1.0, 0), v(0, 1.35, 0), 0.17),
        P.capsule(v(-0.18, 1.3, 0), v(-0.55, 1.75, 0), 0.06), P.capsule(v(0.18, 1.3, 0), v(0.55, 1.75, 0), 0.06),
        P.capsule(v(-0.08, 0.95, 0), v(-0.08, 0.05, 0), 0.07), P.capsule(v(0.08, 0.95, 0), v(0.5, 0.45, 0.05), 0.07)
      ], { pos: v(0.45, -0.95, 0.35), s: 0.8 })
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
      bust({ pos: v(-0.7, -0.35, 0), ry: 0.5 }),
      bust({ pos: v(0.7, -0.35, 0), ry: -0.5 }),
      [v(-0.15, 0.55, 0.1), v(0.2, 0.75, -0.1), v(0.05, 0.3, 0.25)].map((c, i) => weight([P.frame(c, 0.38 - i * 0.06, 0.16, 0.02), P.box(c, [0.36 - i * 0.06, 0.14, 0.005])], 1.2))
    ]),
    ultrabots: build([
      weight([P.box(v(0, -0.82, 0), [0.55, 0.22, 0.55])], 0.8),
      weight([P.box(v(0, -0.68, 0), [1.15, 0.05, 1.15])], 0.6),
      [...Array(36)].map((_, i) => P.sphere(v(-0.5 + (i % 6) * 0.2, -0.62, -0.5 + Math.floor(i / 6) * 0.2), 0.06)),
      [0.12, 0.26, 0.4].map((r, i) => weight([P.ring(v(0, -0.15 + i * 0.12, 0), r * 0.7, 'y', 0.012)], 0.35)),
      hand({ pos: v(0.05, 0.45, 0), rz: -1.35, s: 0.95 })
    ]),
    phinix: build([
      [...Array(9)].map((_, i) => { const a = i / 9 * Math.PI * 2; return P.box(v(Math.cos(a) * 0.62, -0.2, Math.sin(a) * 0.62), [0.2, 0.22, 0.2]); }),
      weight([P.torus(v(0, -0.2, 0), 0.62, 0.05)], 0.6),
      P.box(v(0, 0.75, 0), [0.9, 0.22, 0.2]),
      P.sphere(v(-0.27, 0.75, 0.12), 0.07), P.sphere(v(0.27, 0.75, 0.12), 0.07), P.sphere(v(0, 0.75, 0.12), 0.05)
    ])
  };
  const tilt = { idle: 0.15, chameleoncontrol: 0.1, 'scalable-academy': 0.62, holobots: 0.38, video2mr: 0.12, 'sketched-reality': 0.32, 'augmented-conversation': 0.12, ultrabots: 0.35, phinix: 0.5 };
  const keys = cards.map((c) => c.id.replace(/^w-/, ''));
  const names = Object.fromEntries(cards.map((c) => [c.id.replace(/^w-/, ''), (c.querySelector('h3') || c).childNodes[0].textContent.trim()]));

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
    if (label) label.textContent = names[k] || '';
  }
  document.addEventListener('verbchange', (e) => morphTo(e.detail.id.replace(/^w-/, '')));
  morphTo((document.querySelector('#work .project.is-on') || cards[0]).id.replace(/^w-/, ''));
  function onScroll() {
    const wr = work.getBoundingClientRect();
    visibleTarget = wr.top < innerHeight * 0.9 && wr.bottom > innerHeight * 0.25 ? 1 : 0;
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
  }
  function loop() { if (!running) return; frame((performance.now() - t0) / 1000); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  // For checking stills: show one project fully formed.
  window.__companion = { show(k) { setSegment(k, k); mix = mixTarget = 0; visible = visibleTarget = 1; frame(2); }, keys, state: () => ({ segA, segB, mix: +mix.toFixed(2) }) };
}
