import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);
gsap.ticker.lagSmoothing(0);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const N = 8;
const SEG = 150;                                   // vh of scroll per scene
const THEMES = ['light', 'dark', 'light', 'light', 'dark', 'light', 'dark', 'light'];
const HOLD = .6;                                   // local progress where text is fully readable

const body = document.body;
const scenes = $$('.scene');
const spacer = $('#spacer');
spacer.style.height = `${N * SEG}vh`;
$('#yr').textContent = new Date().getFullYear();

/* ---------- text splitting ---------- */
function split(el) {
  const label = el.textContent.trim();
  el.setAttribute('aria-label', label);
  // keep <em> accents: collect words with their style, then rebuild as masked words of characters
  const words = [];
  el.childNodes.forEach(n => {
    const ital = n.nodeName === 'EM';
    n.textContent.split(/\s+/).filter(Boolean).forEach(w => words.push({ w, ital }));
  });
  el.textContent = '';
  words.forEach(({ w: word, ital }, wi) => {
    const w = document.createElement('span');
    w.className = 'w' + (ital ? ' ital' : ''); w.setAttribute('aria-hidden', 'true');
    [...word].forEach(ch => { const c = document.createElement('span'); c.className = 'c'; c.textContent = ch; w.appendChild(c); });
    el.appendChild(w);
    if (wi < words.length - 1) el.appendChild(document.createTextNode(' '));
  });
}
$$('.split').forEach(split);
const wm = $('.wordmark');
wm.textContent = ''; [...'THE MERKI'].forEach(ch => { const c = document.createElement('span'); c.className = 'c'; c.innerHTML = ch === ' ' ? '&nbsp;' : ch; wm.appendChild(c); });

/* ---------- layered artwork: plate + separate cut-out subjects (built by tools/layers.py) ---------- */
const ART = await fetch('/art/layers.json').then(r => r.json());
const depthOf = a => clamp(.38 + .55 * Math.sqrt(a), .38, .95);      // bigger subject = closer = more parallax
const div = cls => { const d = document.createElement('div'); d.className = cls; return d; };
const bgVideos = [];
const mkLayer = (src, box, depth, kind, idx, cx, videoSrc) => {
  const L = div('layer ' + kind), sp = div('sp'), mx = div('mx');
  Object.assign(L.style, { left: box.x + '%', top: box.y + '%', width: box.w + '%', height: box.h + '%' });
  L.dataset.depth = depth; L.dataset.cx = cx ?? .5;
  let img;
  if (videoSrc) {   // live background: subject-free video loop, still plate shown until it starts
    img = document.createElement('video');
    img.src = videoSrc; img.poster = '/art/' + src; img.muted = true; img.loop = true; img.playsInline = true; img.preload = 'auto';
    img.setAttribute('aria-hidden', 'true'); img.className = 'bgvid';
  } else { img = new Image(); img.src = '/art/' + src; img.alt = ''; img.draggable = false; img.decoding = 'async'; }
  img.style.setProperty('--dur', (7 + idx * 1.9) + 's'); img.style.setProperty('--del', (-idx * 2.7) + 's');
  mx.appendChild(img); sp.appendChild(mx); L.appendChild(sp);
  return L;
};
scenes.forEach((sc, i) => {
  sc.dataset.theme = THEMES[i];
  const back = div('art art-back'), fore = div('art art-fore');
  back.appendChild(mkLayer(ART[i].plate, { x: -4, y: -4, w: 108, h: 108 }, .12, 'plate', 0, .5, `/bg/${i}.mp4`));
  bgVideos[i] = $('video', back);
  ART[i].layers.forEach((l, k) => fore.appendChild(mkLayer(l.file, l, depthOf(l.area), 'subject', k, l.cx)));
  sc.prepend(fore); sc.prepend(back);
});
const mxSetters = scenes.map(sc => $$('.mx', sc).map(el => ({
  d: +el.closest('.layer').dataset.depth,
  x: gsap.quickSetter(el, 'x', 'px'), y: gsap.quickSetter(el, 'y', 'px'),
})));

/* shared state */
const S = { p: 0, sm: 0, mx: .5, my: .5, tmx: .5, tmy: .5, theme: 0, dark: 0 };

/* ---------- ambient dust (2D canvas) ---------- */
const dust = $('#dust'), dctx = dust.getContext('2d');
let DW = 0, DH = 0, DDPR = 1;
const sizeDust = () => { DDPR = Math.min(devicePixelRatio || 1, 2); DW = dust.width = innerWidth * DDPR; DH = dust.height = innerHeight * DDPR; };
sizeDust(); addEventListener('resize', () => { sizeDust(); ScrollTrigger.refresh(); });
const motes = Array.from({ length: coarse ? 34 : 80 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * .8 + .2, s: Math.random() * 1.7 + .6, ph: Math.random() * 6.28 }));
let lastT = 0;
function drawDust(t) {
  const dt = Math.min(t - lastT, .1); lastT = t;
  dctx.clearRect(0, 0, DW, DH);
  const c = Math.round(22 + 215 * S.dark);
  for (const m of motes) {
    if (!reduce) { m.y -= (.004 + .012 * m.z) * dt; m.x += Math.sin(t * .3 + m.ph) * .012 * dt; }
    if (m.y < -.02) { m.y = 1.02; m.x = Math.random(); }
    const px = (m.x - (S.mx - .5) * .03 * m.z) * DW, py = m.y * DH;
    const a = (.18 + .5 * (.5 + .5 * Math.sin(t * .9 + m.ph))) * m.z * (.55 + .45 * S.dark);
    dctx.fillStyle = `rgba(${c},${c},${c},${a})`;
    dctx.beginPath(); dctx.arc(px, py, m.s * m.z * DDPR, 0, 6.283); dctx.fill();
  }
}

/* ---------- smooth scroll ---------- */
const lenis = new Lenis({ lerp: reduce ? 1 : .09, smoothWheel: true, wheelMultiplier: .9 });
lenis.on('scroll', ScrollTrigger.update);
lenis.stop();

const maxScroll = () => spacer.offsetHeight - innerHeight;
const holdPx = i => (i === 0 ? 0 : ((i + HOLD) / N) * maxScroll());
const goto = i => lenis.scrollTo(holdPx(clamp(i, 0, N - 1)), { duration: 2.1, easing: t => 1 - Math.pow(1 - t, 4) });
$$('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); goto(+a.dataset.goto); }));

/* ---------- master scroll timeline ---------- */
const tl = gsap.timeline({
  defaults: { ease: 'none' },
  scrollTrigger: { trigger: spacer, start: 'top top', end: 'bottom bottom', scrub: .6, onUpdate: s => { S.p = s.progress; } },
});

scenes.forEach((sc, i) => {
  const chars = $$('.c', sc), fades = $$('[data-fade]', sc), xs = $$('[data-x]', sc), deps = $$('[data-depth]:not(.layer)', sc);
  const subs = $$('.layer.subject', sc), plate = $('.layer.plate .sp', sc);

  // scene crossfade (plates dissolve into each other like the reference slider)
  if (i > 0) tl.fromTo(sc, { autoAlpha: 0 }, { autoAlpha: 1, duration: .2 }, i - .1);
  if (i < N - 1) tl.to(sc, { autoAlpha: 0, duration: .2 }, i + .9);

  // subjects fly in / out separately from the background, nearer ones last
  subs.forEach(L => {
    const d = +L.dataset.depth, cx = +L.dataset.cx;
    if (i > 0) tl.fromTo(L, { autoAlpha: 0, y: 110 * d, x: (cx - .5) * 260, scale: .88 }, { autoAlpha: 1, y: 0, x: 0, scale: 1, duration: .38, ease: 'power3.out' }, i + .05 + d * .08);
    if (i < N - 1) tl.to(L, { autoAlpha: 0, y: -80 * d, x: -(cx - .5) * 140, scale: 1.1, duration: .2, ease: 'power2.in' }, i + .76 + (1 - d) * .06);
  });
  // scroll parallax per depth + slow push-in on the plate
  $$('.layer', sc).forEach(L => {
    const k = +L.dataset.depth * 30;
    tl.fromTo($('.sp', L), { y: i === 0 ? 0 : k }, { y: -k, duration: 1, ease: 'none' }, i);
  });
  if (plate) tl.fromTo(plate, { scale: 1 }, { scale: 1.07, duration: 1, ease: 'none' }, i);

  if (i > 0) {
    if (xs.length) tl.fromTo(xs, { x: (k, el) => el.dataset.x * 140 }, { x: 0, duration: .36, ease: 'power3.out' }, i + .1);
    if (chars.length) tl.fromTo(chars, { yPercent: 118 }, { yPercent: 0, duration: .26, stagger: { amount: .16 }, ease: 'power3.out' }, i + .12);
    if (fades.length) tl.fromTo(fades, { autoAlpha: 0, y: 34 }, { autoAlpha: 1, y: 0, duration: .26, stagger: { amount: .16 }, ease: 'power2.out' }, i + .22);
  }
  if (i < N - 1) {
    if (chars.length) tl.to(chars, { yPercent: -118, duration: .16, stagger: { amount: .08 }, ease: 'power2.in' }, i + .78);
    if (xs.length) tl.to(xs, { x: (k, el) => el.dataset.x * 140, duration: .2, ease: 'power2.in' }, i + .78);
    if (fades.length) tl.to(fades, { autoAlpha: 0, y: -34, duration: .15, ease: 'power2.in' }, i + .8);
  }
  deps.forEach(d => {
    const k = +d.dataset.depth * 46;
    tl.fromTo(d, { y: i === 0 ? 0 : k }, { y: -k, duration: 1, ease: 'none' }, i);
  });
});
// process line draws as you scroll through scene 6; HUD rail fills
tl.fromTo('#rail-fill', { scaleY: 0 }, { scaleY: 1, duration: N, ease: 'none' }, 0);
tl.set({}, {}, N); // pad timeline to exactly N

/* ---------- Process: an orb runs 01 -> 04 along the arc (3D depth, trail, ripples, label flips) ---------- */
const procScene = scenes[5], procPath = $('#proc-path'), procGlow = $('#proc-glow'), orb = $('.orb', procScene);
const procSteps = $$('.step', procScene);
const PLEN = procPath.getTotalLength ? procPath.getTotalLength() : 0;
let procLoop = null;
if (PLEN > 0) {
  const NODES = [0, .2, .8, 1];                         // path fractions where Strategy / Create / Launch / Scale sit
  const pt = u => procPath.getPointAtLength(clamp(u, 0, 1) * PLEN);
  const mk = cls => { const e = document.createElement('i'); e.className = cls; procScene.appendChild(e); return e; };
  const nodeEls = NODES.map(u => { const n = mk('node'), q = pt(u); n.style.left = q.x + '%'; n.style.top = q.y + '%'; return n; });
  const TR = 14, trail = Array.from({ length: TR }, () => mk('tr'));
  const run = { u: 0, a: 0 }, hit = [false, false, false, false];
  const fire = k => {
    [procSteps[k], nodeEls[k]].forEach((el, j) => { const c = j ? 'ping' : 'hit'; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); });
    procSteps.forEach((st, j) => st.classList.toggle('on', j === k));
  };
  const place = () => {
    const q = pt(run.u), depth = clamp((q.y - 62) / 18, 0, 1), sc = .8 + depth * .7;   // lower on the arc = closer to the viewer
    orb.style.left = q.x + '%'; orb.style.top = q.y + '%'; orb.style.opacity = run.a; orb.style.setProperty('--s', sc);
    orb.style.setProperty('--hx', (-18 + (q.x - 50) * -.5) + '%');                      // highlight slides as it travels = it rotates
    procGlow.style.strokeDashoffset = 1 - run.u;
    trail.forEach((t, k) => {
      const f = 1 - (k + 1) / (TR + 1), r = pt(run.u - (k + 1) * .014);
      t.style.left = r.x + '%'; t.style.top = r.y + '%'; t.style.opacity = f * .6 * run.a; t.style.setProperty('--s', sc * (.3 + f * .55));
    });
    NODES.forEach((n, k) => {
      const d = Math.abs(run.u - n);
      if (d < .03 && !hit[k]) { hit[k] = true; fire(k); } else if (d > .07) hit[k] = false;
    });
  };
  procLoop = gsap.timeline({ repeat: -1, paused: true, onUpdate: place })
    .set(run, { u: 0, a: 0 })
    .to(run, { a: 1, duration: .6, ease: 'power1.out' })
    .to(run, { u: NODES[1], duration: 1.7, ease: 'power2.inOut' }, .25)
    .to({}, { duration: .55 })
    .to(run, { u: NODES[2], duration: 3.2, ease: 'sine.inOut' })
    .to({}, { duration: .55 })
    .to(run, { u: NODES[3], duration: 1.7, ease: 'power2.inOut' })
    .to({}, { duration: 1.3 })
    .to(run, { a: 0, duration: .8, ease: 'power1.in' });
}

/* ---------- scroll snapping to readable "hold" points ---------- */
let snapT;
lenis.on('scroll', () => {
  clearTimeout(snapT);
  if (introRunning || contactOpen || workOpen || reduce || location.search.includes('nosnap')) return;
  snapT = setTimeout(() => {
    const s = S.p * N, i = clamp(Math.floor(s), 0, N - 1), f = s - i, down = lenis.direction >= 0;
    if (i === 0 && f < .8) return;
    if (i === N - 1 && f > .45) return;
    if (f >= .45 && f <= .8) return;
    const to = f < .45 ? (down ? i : i - 1) : (down ? i + 1 : i);
    lenis.scrollTo(holdPx(clamp(to, 0, N - 1)), { duration: 1.1, easing: t => 1 - Math.pow(1 - t, 3) });
  }, 170);
});

/* ---------- pointer: cursor, magnetic buttons, depth parallax ---------- */
const cursor = $('#cursor');
const cx = gsap.quickTo(cursor, 'x', { duration: .35, ease: 'power3' });
const cy = gsap.quickTo(cursor, 'y', { duration: .35, ease: 'power3' });
addEventListener('pointermove', e => {
  cx(e.clientX); cy(e.clientY);
  S.tmx = e.clientX / innerWidth; S.tmy = e.clientY / innerHeight;
});
const cLabel = $('span', cursor);
document.addEventListener('pointerover', e => {
  const t = e.target.closest('[data-cursor]');
  if (t) { cursor.classList.add('big'); cLabel.textContent = t.dataset.cursor; } else { cursor.classList.remove('big'); cLabel.textContent = ''; }
});
if (!coarse) {
  $$('.btn, .pill').forEach(b => {
    const qx = gsap.quickTo(b, 'x', { duration: .5, ease: 'power3' }), qy = gsap.quickTo(b, 'y', { duration: .5, ease: 'power3' });
    b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); qx((e.clientX - (r.left + r.width / 2)) * .3); qy((e.clientY - (r.top + r.height / 2)) * .4); });
    b.addEventListener('pointerleave', () => { qx(0); qy(0); });
  });
}

// service hover: the subject leans in
const svcSubjects = $$('.subject .mx', scenes[2]);
$$('[data-svc]').forEach(el => {
  el.addEventListener('pointerenter', () => gsap.to(svcSubjects, { scale: 1.045, duration: 1.1, ease: 'power2.out', overwrite: 'auto' }));
  el.addEventListener('pointerleave', () => gsap.to(svcSubjects, { scale: 1, duration: 1.4, ease: 'power2.out' }));
});

/* ---------- contact overlay ---------- */
const contact = $('#contact');
let contactOpen = false;
function toggleContact(open) {
  contactOpen = open;
  contact.setAttribute('aria-hidden', String(!open));
  if (open) { contact.style.visibility = 'visible'; lenis.stop(); }
  gsap.to(contact, {
    clipPath: open ? 'inset(0% 0 0 0)' : 'inset(100% 0 0 0)', duration: .9, ease: 'expo.inOut',
    onComplete: () => { if (!open) { contact.style.visibility = 'hidden'; lenis.start(); } else $('input', contact).focus(); },
  });
  if (open) gsap.fromTo('#contact form > *', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .8, stagger: .07, delay: .45, ease: 'power3.out' });
}
$$('[data-open-contact]').forEach(b => b.addEventListener('click', () => toggleContact(true)));
$('[data-close-contact]').addEventListener('click', () => toggleContact(false));
addEventListener('keydown', e => { if (e.key === 'Escape' && contactOpen) toggleContact(false); });
$('#contact-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f));
  let ok = true;
  $$('input, textarea', f).forEach(el => { const bad = !el.value.trim() || (el.type === 'email' && !/^\S+@\S+\.\S+$/.test(el.value)); el.classList.toggle('bad', bad); if (bad) ok = false; });
  if (!ok) return;
  // placeholder inbox — replace with the agency's real address
  location.href = `mailto:hello@themerki.com?subject=${encodeURIComponent('New project — ' + d.name)}&body=${encodeURIComponent(d.message + '\n\n' + d.name + ' · ' + d.email)}`;
});

/* ---------- Work / proof panel ---------- */
const workPanel = $('#work');
let workOpen = false;
// drop images into /photos/work/ and they appear here automatically (no code change)
const WORK_IMAGES = Object.entries(import.meta.glob('/photos/work/*.{jpg,jpeg,png,webp,avif}', { eager: true, query: '?url', import: 'default' }))
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([, url]) => url);
const gallery = $('#work-gallery');
if (WORK_IMAGES.length) {
  gallery.innerHTML = '<p class="eyebrow">Selected work</p><div class="grid"></div>';
  const grid = $('.grid', gallery);
  WORK_IMAGES.forEach((src, k) => {
    const f = document.createElement('figure'); const im = new Image();
    im.src = src; im.alt = `The Merki work ${k + 1}`; im.loading = 'lazy'; im.decoding = 'async';
    f.appendChild(im); grid.appendChild(f);
  });
} else gallery.remove();
$('#work-wa').href = `https://wa.me/918122512223?text=${encodeURIComponent("Hi The Merki, I saw your work and I'd like to start a project.")}`;

function toggleWork(open) {
  workOpen = open;
  workPanel.setAttribute('aria-hidden', String(!open));
  if (open) { workPanel.style.visibility = 'visible'; lenis.stop(); workPanel.scrollTop = 0; }
  gsap.to(workPanel, {
    clipPath: open ? 'inset(0% 0 0 0)' : 'inset(100% 0 0 0)', duration: .9, ease: 'expo.inOut',
    onComplete: () => { if (!open) { workPanel.style.visibility = 'hidden'; lenis.start(); } },
  });
  if (open) gsap.fromTo('#work .work-inner > *', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .8, stagger: .08, delay: .45, ease: 'power3.out' });
}
$$('[data-open-work]').forEach(b => b.addEventListener('click', () => toggleWork(true)));
$('[data-close-work]').addEventListener('click', () => toggleWork(false));
addEventListener('keydown', e => { if (e.key === 'Escape' && workOpen) toggleWork(false); });

/* ---------- WhatsApp enquiry: one button, message follows the slide you're on ---------- */
const WA_NUMBER = '918122512223';
const WA_MSG = [
  "Hi The Merki, I came across your website and I'd like to enquire about your services.",
  "Hi The Merki, I'd like to know more about your agency and how you work with brands.",
  "Hi The Merki, I'm interested in your services (brand identity, websites, content, social media). Could we talk?",
  "Hi The Merki, I saw your work and I'd like to discuss a project with you.",
  "Hi The Merki, I want to build a brand people remember. Can we talk?",
  "Hi The Merki, could you walk me through your process, from strategy to launch?",
  "Hi The Merki, I'd like to see more of your client work and results.",
  "Hi The Merki, I'd like to start a project. Here's what I have in mind: ",
];
const enquiry = $('#enquiry');
const setEnquiry = i => { enquiry.href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_MSG[i])}`; };
setEnquiry(0);

/* ---------- HUD ---------- */
const hudI = $('#hud-i'), hudName = $('#hud-name');
function setTheme(i) {
  S.theme = i;
  setEnquiry(i);
  body.dataset.theme = THEMES[i];
  hudName.textContent = scenes[i].dataset.name;
  gsap.fromTo([hudI, hudName], { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: .5, ease: 'power3.out' });
  hudI.textContent = String(i + 1).padStart(2, '0');
}

/* ---------- render loop ---------- */
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
  S.sm += (S.p * N - S.sm) * (reduce ? 1 : .14);
  const s = clamp(S.sm, 0, N - .0001), i = Math.floor(s);
  if (!introRunning && i !== S.theme) setTheme(i);

  // depth parallax: nearer layers shift more against the cursor
  S.mx += (S.tmx - S.mx) * .08; S.my += (S.tmy - S.my) * .08;
  const ox = (S.mx - .5) * 2, oy = (S.my - .5) * 2;
  for (const k of [i - 1, i, i + 1]) {
    if (k < 0 || k >= N) continue;
    for (const m of mxSetters[k]) { m.x(-ox * m.d * 18); m.y(-oy * m.d * 10); }
  }
  S.dark += ((THEMES[i] === 'dark' ? 1 : 0) - S.dark) * .08;
  if (procLoop) { if (Math.abs(S.sm - 5.5) < .62 && !reduce) procLoop.play(); else procLoop.pause(); }
  bgVideos.forEach((v, k) => {
    const want = !reduce && Math.abs(k - i) <= 1;
    if (want && v.paused) v.play().catch(() => {});
    else if (!want && !v.paused) v.pause();
  });
  drawDust(time);
});

/* ---------- intro: logo draws, name types, flies to the corner, artwork emerges from black ---------- */
let introRunning = true;
const brand = $('.brand');
const mark = $$('.mark path, .mark rect');
const wmChars = $$('.wordmark .c');
const hero = scenes[0];
const heroChars = $$('.c', hero), heroFades = $$('[data-fade]', hero), heroXs = $$('[data-x]', hero);

function placeBrandCentre() {
  gsap.set(brand, { x: 0, y: 0, scale: 1 });
  const r = brand.getBoundingClientRect();
  const k = clamp((innerWidth * (innerWidth < 860 ? .62 : .3)) / r.width, 1.2, 3.4);
  gsap.set(brand, { x: innerWidth / 2 - (r.width * k) / 2 - r.left, y: innerHeight / 2 - (r.height * k) / 2 - r.top, scale: k });
  return k;
}

const heroSubs = $$('.layer.subject', hero), heroPlate = $('.layer.plate', hero);
const imagesReady = Promise.race([
  Promise.all([...$$('img', hero).map(im => im.decode().catch(() => {})),
    new Promise(r => { const v = bgVideos[0]; if (v.readyState >= 3) r(); else v.addEventListener('canplay', r, { once: true }); })]),
  new Promise(r => setTimeout(r, 5000)),
]);

function runIntro() {
  gsap.set(hero, { autoAlpha: 1 });
  gsap.set(heroChars, { yPercent: 118 });
  gsap.set(heroFades, { autoAlpha: 0, y: 34 });
  gsap.set(wmChars, { yPercent: 115 });
  gsap.set(mark, { strokeDashoffset: 1, fillOpacity: 0 });
  gsap.set('.links, .hud, #enquiry', { autoAlpha: 0 });
  gsap.set(heroSubs, { autoAlpha: 0, y: -140, scale: 1.12 });
  gsap.set(heroPlate, { scale: 1.25 });
  placeBrandCentre();
  setTheme(0); body.dataset.theme = 'dark';     // white ink on the black intro

  const done = () => { introRunning = false; lenis.start(); gsap.set(brand, { clearProps: 'transform' }); };
  if (reduce) {
    $('#veil').style.display = 'none'; body.dataset.theme = THEMES[0];
    gsap.set([wmChars, heroChars], { yPercent: 0 }); gsap.set(heroFades, { autoAlpha: 1, y: 0 }); gsap.set(mark, { strokeDashoffset: 0, fillOpacity: 1 });
    gsap.set(heroSubs, { autoAlpha: 1, y: 0, scale: 1 }); gsap.set(heroPlate, { scale: 1 });
    gsap.set('.links, .hud, #enquiry', { autoAlpha: 1 }); done(); return;
  }

  const t = gsap.timeline();
  t.to(mark, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', stagger: .15 })
   .to(mark, { fillOpacity: 1, duration: .5, ease: 'power1.out' }, '-=.35')
   .to(wmChars, { yPercent: 0, duration: .7, stagger: .05, ease: 'power4.out' }, '-=.55')
   .add(() => { imagesReady.then(flyAndForm); }, '+=.35');   // never reveal before the artwork has decoded
}

function flyAndForm() {
  const t = gsap.timeline({ onComplete: done2 });
  t.to(brand, { x: 0, y: 0, scale: 1, duration: 1.5, ease: 'expo.inOut' }, 0)
   .add(() => { body.dataset.theme = THEMES[0]; }, .5)
   .to('#veil', { autoAlpha: 0, duration: 2.2, ease: 'power2.inOut' }, .35)     // artwork emerges from black
   .to(heroPlate, { scale: 1, duration: 3.4, ease: 'power3.out' }, .35)
   .to(heroSubs, { autoAlpha: 1, y: 0, scale: 1, duration: 2.1, stagger: .3, ease: 'power3.out' }, .9)
   .from(heroXs, { x: i => (i ? 1 : -1) * 140, duration: 1.3, ease: 'power3.out' }, 1.1)
   .to(heroChars, { yPercent: 0, duration: 1, stagger: { amount: .5 }, ease: 'power4.out' }, 1.2)
   .to(heroFades, { autoAlpha: 1, y: 0, duration: .9, stagger: .12, ease: 'power3.out' }, 1.8)
   .to('.links, .hud, #enquiry', { autoAlpha: 1, duration: 1, stagger: .1 }, 2.0);
  function done2() { introRunning = false; lenis.start(); gsap.set(brand, { clearProps: 'transform' }); setTheme(S.theme); }
}

runIntro();
