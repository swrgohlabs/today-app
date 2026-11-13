/*
 * build.js - "multi-cursor build animation" for Today.
 *
 * API (window.TodayBuild):
 *   start(root, { speed = 1, agentsStart, agentsMax })  hide every [data-b] piece inside root, then let a
 *                               team of cursor "agents" build them back. No-op under
 *                               prefers-reduced-motion (the page simply stays finished).
 *   finish()                    reveal everything now, remove overlay / cursors / Skip,
 *                               stop the loop. Safe any time, repeatedly, never-started.
 *   isRunning()                 true while pieces are still being built.
 *   Agents: default 6 growing to 12 (phone, viewport < 640px: 3 and 3); override
 *   with agentsStart / agentsMax (clamped to 1..12, start <= max).
 *
 * Pieces: data-b="type | box | card | code | measure".
 *
 * Nesting: a `box` or `card` that contains other pieces is a container. It is built
 * first (its own non-piece content, e.g. an <h2>, wipes in with it) and its child
 * pieces only become eligible once it is done; until then they show as dashed slots
 * inside it. Pieces nested inside a `type`, `code` or `measure` piece are absorbed:
 * they are not managed separately and appear with their parent. Pieces with a zero
 * size at start() (not laid out) are left alone and never hidden.
 *
 * What is added to the real elements (all removed again on finish / when done):
 *   class  b-wait      opacity:0 while a piece waits (its box keeps its size)
 *   class  b-dragging  on a card while it is dragged or carried back
 *   class  b-drag-on   on <html> during a drag (disables text selection)
 *   inline style.clipPath  during the wipe of a piece (restored to the original)
 *   inline style.opacity / style.translate  on measure items and code lines while
 *                      they drop / slide in, and style.translate on a dragged card
 *                      (all restored to their original inline values).
 * Everything else lives in one overlay (div.b-overlay, aria-hidden) appended to <body>
 * and one fixed layer (div.b-fixed) holding the Skip button and the "You" label.
 *
 * Drag-to-fix: once start() has been called, cards ([data-b="card"]) in root can be
 * dragged (mouse: after 6px of movement; touch/pen: after a 450ms long-press). On
 * release an agent flies in and carries the card back. Works after the build ended
 * too: a temporary overlay + loop is created and torn down once the agent is idle.
 *
 * Safety: pieces on screen and ready for 4s are revealed instantly; a 25s failsafe
 * calls finish(); any exception in the rAF tick calls finish(). The loop stops
 * completely when nothing is left to do.
 */
(function () {
  'use strict';

  var NAMES = ['Planner', 'Coder', 'Designer', 'Reviewer', 'Writer', 'Researcher',
    'Tester', 'Stylist', 'Linter', 'Editor', 'Builder', 'Scout'];
  var KINDS = { type: 1, box: 1, card: 1, code: 1, measure: 1 };
  var CHAR_MS = 15, TYPE_MIN = 450, TYPE_MAX = 1400, PAUSE = 280, WIPE = 500;
  var MAX_CHARS = Math.floor(TYPE_MAX / CHAR_MS);
  var STUCK_MS = 4000, WORK_STUCK_MS = 9000, FAILSAFE_MS = 25000;
  var FADE_AFTER_BUILD = 3500, FADE_AFTER_FIX = 1500, FADE_MS = 450;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var SPARK = 'M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z';

  // ---- state -------------------------------------------------------------
  var root = null, building = false, hadBuild = false;
  var overlay = null, fixedLayer = null, skipBtn = null, youEl = null;
  var pieces = [], pmap = null, agents = [], fx = [];
  var raf = 0, last = 0, speed = 1, boost = 1, rate = 1, lastScroll = 0;
  var lastLayout = 0, nextSpawn = 0, quietSince = 0, failTimer = 0;
  var ox = 0, oy = 0, ow = 0, aStart = 0, aMax = 0;
  var fixes = new Map(), origTr = new WeakMap(), curOff = new WeakMap();
  var D = null, dragRoot = null;

  // ---- helpers -----------------------------------------------------------
  function mq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function reduced() { return mq('(prefers-reduced-motion: reduce)'); }
  function vw() { return document.documentElement.clientWidth || window.innerWidth || 0; }
  function vh() { return window.innerHeight || document.documentElement.clientHeight || 0; }
  function isPhone() { return vw() < 640; }
  function sx() { return window.scrollX || window.pageXOffset || 0; }
  function sy() { return window.scrollY || window.pageYOffset || 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function mk(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function rm(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
  function place(el, x, y, w, h) {
    el.style.left = x.toFixed(1) + 'px'; el.style.top = y.toFixed(1) + 'px';
    if (w != null) el.style.width = Math.max(0, w).toFixed(1) + 'px';
    if (h != null) el.style.height = Math.max(0, h).toFixed(1) + 'px';
  }
  function toO(r) { return { x: r.left + sx() - ox, y: r.top + sy() - oy, w: r.width, h: r.height }; }
  function color(a) { return 'var(--b-a' + (a.idx + 1) + ')'; }
  function fade(el, t) { if (!el) return; el.classList.add('b-gone'); fx.push({ el: el, until: t + 350 }); }

  function sparkle() {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'b-spark');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', SPARK);
    s.appendChild(p);
    return s;
  }

  // ---- display "source" (text only; inserted via textContent) ------------
  function squash(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
  }
  function tagName(el) { return el.tagName.toLowerCase(); }
  function openTag(el) {
    var cls = [], cl = el.classList;
    for (var i = 0; i < cl.length && cls.length < 2; i++) if (cl[i].indexOf('b-') !== 0) cls.push(cl[i]);
    return '<' + tagName(el) + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>';
  }
  function source(p) {
    var el = p.el, t = tagName(el), kids = el.children, s;
    if (p.kind === 'code') {
      var lines = String(el.textContent || '').split('\n').filter(function (l) { return l.trim(); }).slice(0, 2);
      s = openTag(el) + lines.map(function (l) { return '\n  ' + squash(l, 34); }).join('');
    } else if (p.kind === 'type' || !kids.length) {
      s = openTag(el) + squash(el.textContent, 60) + '</' + t + '>';
    } else {
      s = openTag(el);
      var n = Math.min(3, kids.length);
      for (var i = 0; i < n; i++) {
        s += '\n  ' + openTag(kids[i]) + squash(kids[i].textContent, 20) + '</' + tagName(kids[i]) + '>';
      }
      if (kids.length > n) s += '\n  …';
      s += '\n</' + t + '>';
    }
    return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS - 1) + '…' : s;
  }

  // ---- pieces ------------------------------------------------------------
  function collect(r) {
    var list = r.querySelectorAll('[data-b]'), absorbed = new Set();
    pieces = []; pmap = new Map();
    for (var i = 0; i < list.length; i++) {
      var el = list[i], kind = String(el.getAttribute('data-b') || '').trim().toLowerCase();
      if (!KINDS[kind]) continue;
      var parent = null, skip = false, anc = el.parentElement;
      while (anc && anc !== r) {
        if (pmap.has(anc)) { parent = pmap.get(anc); break; }
        if (absorbed.has(anc)) { skip = true; break; }
        anc = anc.parentElement;
      }
      if (parent && parent.kind !== 'box' && parent.kind !== 'card') skip = true;
      if (skip) { absorbed.add(el); continue; }
      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      var p = { el: el, kind: kind, parent: parent, state: 'wait', rect: null, ghost: null,
        seen: 0, since: 0, agent: null, oClip: el.style.clipPath || '', kids: null };
      pmap.set(el, p); pieces.push(p);
    }
  }
  function isReady(p) { return p.state === 'wait' && (!p.parent || p.parent.state === 'done'); }
  function prepKids(p, els) {
    p.kids = els.map(function (e) { return { el: e, op: e.style.opacity, tr: e.style.translate }; });
    p.kids.forEach(function (k) { k.el.style.opacity = '0'; });
  }
  function restoreKids(p) {
    if (!p.kids) return;
    p.kids.forEach(function (k) { k.el.style.opacity = k.op; k.el.style.translate = k.tr; });
    p.kids = null;
  }
  function revealNow(p) {
    if (p.ghost) { rm(p.ghost); p.ghost = null; }
    restoreKids(p);
    p.el.style.clipPath = p.oClip;
    p.el.classList.remove('b-wait');
    p.state = 'done'; p.agent = null;
  }
  function forceDone(p) {
    if (p.state === 'done') return;
    if (p.parent) forceDone(p.parent);
    var a = p.agent;
    if (a && a.task && a.task.pc === p) dropTask(a);
    revealNow(p);
  }
  function itemsOf(el) {
    return Array.prototype.filter.call(el.children, function (c) {
      var r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    });
  }
  function codeLines(el) {
    var c = el.children;
    if (c.length === 1 && c[0].children.length >= 2) c = c[0].children;
    return c.length >= 2 ? Array.prototype.slice.call(c) : null;
  }

  // ---- layers ------------------------------------------------------------
  function ensureLayers() {
    if (overlay) return;
    overlay = mk('div', 'b-overlay');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
    fixedLayer = mk('div', 'b-fixed', document.body);
    window.addEventListener('resize', onResize);
    layout();
  }
  function layout() {
    lastLayout = now();
    overlay.style.height = '0px';
    var oR = overlay.getBoundingClientRect(), de = document.documentElement;
    ox = oR.left + sx(); oy = oR.top + sy();
    ow = Math.max(0, de.clientWidth - oR.left);
    var H = Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0);
    overlay.style.width = ow + 'px';
    overlay.style.height = Math.max(0, H - oy) + 'px';
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.state === 'done') continue;
      p.rect = toO(p.el.getBoundingClientRect());
      if (p.ghost) place(p.ghost, p.rect.x, p.rect.y, p.rect.w, p.rect.h);
    }
  }
  function onResize() { if (overlay) layout(); }
  function onKey(e) { if ((e.key === 'Escape' || e.key === 'Esc') && building) finish(); }
  function onMouse(e) {
    if (!youEl || (e.pointerType && e.pointerType !== 'mouse')) return;
    youEl.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    youEl.classList.add('b-on');
  }
  function onMouseOut(e) { if (youEl && !e.relatedTarget) youEl.classList.remove('b-on'); }

  // ---- agents ------------------------------------------------------------
  function setStatus(a, s) {
    if (a.status === s) return;
    a.status = s;
    a.label.textContent = a.name + ' · ' + s;
    a.el.classList.toggle('b-busy', s !== 'idle');
  }
  function draw(a) {
    a.el.style.transform = 'translate3d(' + a.x.toFixed(1) + 'px,' + a.y.toFixed(1) + 'px,0)';
    // Keep the name pill on screen: near the right edge it sits to the left of the cursor.
    var flip = a.x > (parseFloat(overlay && overlay.style.width) || window.innerWidth) - 140;
    if (flip !== a.flip) { a.flip = flip; a.el.classList.toggle('b-flip', flip); }
  }
  function spawn() {
    var used = {}, idx = 0;
    agents.forEach(function (a) { used[a.idx] = 1; });
    while (used[idx] && idx < NAMES.length - 1) idx++;
    if (used[idx]) idx = agents.length % NAMES.length;
    var a = { idx: idx, name: NAMES[idx], x: 0, y: 0, ax: 0, ay: 0, ph: Math.random() * 6.28,
      status: '', task: null, typed: null, extras: [] };
    a.el = mk('div', 'b-agent', overlay);
    a.el.style.setProperty('--b-c', color(a));
    a.el.appendChild(sparkle());
    a.label = mk('span', 'b-label', a.el);
    var W = vw(), H = vh(), side = Math.floor(Math.random() * 4), x, y;
    if (side === 0) { x = -28; y = rnd(0.1, 0.9) * H; }
    else if (side === 1) { x = W + 28; y = rnd(0.1, 0.9) * H; }
    else if (side === 2) { x = rnd(0.1, 0.9) * W; y = -28; }
    else { x = rnd(0.1, 0.9) * W; y = H + 28; }
    a.x = x + sx() - ox; a.y = y + sy() - oy;
    setStatus(a, 'thinking');
    a.task = { kind: 'enter', ph: 'enter', t: 0 };
    path(a, rnd(0.2, 0.8) * W + sx() - ox, rnd(0.2, 0.65) * H + sy() - oy);
    agents.push(a); draw(a);
    return a;
  }
  function path(a, x1, y1) {
    var k = a.task, dx = x1 - a.x, dy = y1 - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    var bend = rnd(-0.28, 0.28) * d;
    k.path = { x0: a.x, y0: a.y, x1: x1, y1: y1,
      cx: (a.x + x1) / 2 - dy / d * bend, cy: (a.y + y1) / 2 + dx / d * bend };
    k.t = 0; k.dur = clamp(250 + d * 0.45, 250, 700);
  }
  function along(a) {
    var k = a.task, e = ease(Math.min(1, k.t / k.dur)), u = 1 - e, p = k.path;
    a.x = u * u * p.x0 + 2 * u * e * p.cx + e * e * p.x1;
    a.y = u * u * p.y0 + 2 * u * e * p.cy + e * e * p.y1;
    return k.t >= k.dur;
  }
  function follow(a, x, y, dtR, tau) {
    var f = 1 - Math.exp(-dtR / tau);
    a.x += (x - a.x) * f; a.y += (y - a.y) * f;
  }
  function goIdle(a) {
    a.task = null; a.ax = a.x; a.ay = a.y; setStatus(a, 'idle');
  }
  function dropTask(a) {
    if (a.typed) { rm(a.typed); a.typed = null; }
    a.extras.forEach(rm); a.extras = [];
    goIdle(a);
  }
  function isFree(a) { return !a.task || a.task.kind === 'enter'; }

  function assign(a, p, t) {
    p.state = 'work'; p.agent = a; p.since = t;
    a.task = { kind: 'build', ph: 'move', pc: p, t: 0 };
    setStatus(a, 'thinking');
    path(a, p.rect.x + Math.min(14, p.rect.w / 2), p.rect.y + Math.min(14, p.rect.h / 2));
    if (p.ghost) { p.ghost.style.setProperty('--b-c', color(a)); p.ghost.classList.add('b-on'); }
  }
  function startWrite(a, k, p) {
    k.ph = 'write'; k.t = 0;
    k.text = source(p);
    k.dur = clamp(k.text.length * CHAR_MS, TYPE_MIN, TYPE_MAX);
    k.shown = -1; k.row = 0; k.col = 0;
    k.maxW = Math.max(160, Math.min(Math.max(p.rect.w, 200), ow - p.rect.x - 6));
    setStatus(a, 'writing');
    var pre = mk('pre', 'b-code', overlay);
    pre.style.setProperty('--b-c', color(a));
    place(pre, p.rect.x, p.rect.y);
    pre.style.maxWidth = k.maxW + 'px';
    a.typed = pre;
  }
  function startRender(a, k, p, t) {
    setStatus(a, 'rendering');
    fade(a.typed, t); a.typed = null;
    fade(p.ghost, t); p.ghost = null;
    var el = p.el;
    k.ph = 'render'; k.t = 0; k.dur = WIPE; k.bottom = 0; k.mode = '';
    if (p.kind === 'measure') {
      var its = itemsOf(el);
      k.items = its.map(function (c) { return toO(c.getBoundingClientRect()); });
      prepKids(p, its);
    } else if (p.kind === 'code') {
      var lines = codeLines(el);
      if (lines) { prepKids(p, lines); k.mode = 'kids'; }
      else {
        var cs = getComputedStyle(el), fs = parseFloat(cs.fontSize) || 13;
        var lh = parseFloat(cs.lineHeight); if (!(lh > 0)) lh = fs * 1.4;
        var pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
        var n = Math.round((p.rect.h - pt - pb) / lh);
        if (n > 1) { k.mode = 'text'; k.lh = lh; k.pt = pt; k.n = n; k.bottom = Math.max(0, p.rect.h - pt - lh - 1); }
      }
    }
    el.style.clipPath = clip(1, k.bottom);
    el.classList.remove('b-wait');
  }
  function clip(hidden, bottom) {
    return 'inset(0px ' + (hidden * 100).toFixed(2) + '% ' + (bottom || 0).toFixed(1) + 'px 0px)';
  }
  function flash(a, p, t) {
    var r = p.rect, s = mk('div', 'b-sel', overlay), d = 900 / rate;
    s.style.setProperty('--b-c', color(a));
    place(s, r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    s.style.animationDuration = d.toFixed(0) + 'ms';
    mk('span', 'b-size', s).textContent = Math.round(r.w) + ' × ' + Math.round(r.h);
    fx.push({ el: s, until: t + d + 40 });
  }
  function finishPiece(a, p, t) {
    restoreKids(p);
    p.el.style.clipPath = p.oClip;
    p.state = 'done'; p.agent = null;
    a.extras.forEach(function (e) { fade(e, t); }); a.extras = [];
    goIdle(a);
  }
  function extra(a, cls) {
    var e = mk('div', cls, overlay);
    e.style.setProperty('--b-c', color(a));
    a.extras.push(e);
    return e;
  }

  function updateAgent(a, dtB, dtR, t) {
    var k = a.task;
    if (!k) {
      a.ph += dtR * 0.0012;
      a.x = a.ax + Math.sin(a.ph) * 6; a.y = a.ay + Math.cos(a.ph * 1.3) * 4;
      draw(a); return;
    }
    k.t += dtB;
    var p = k.pc, r = p && p.rect, e, i;
    switch (k.ph) {
      case 'enter':
        if (along(a)) goIdle(a);
        break;
      case 'move':
        if (along(a)) {
          if (k.kind === 'fix') { k.ph = 'carry'; k.t = 0; k.dur = 650; }
          else startWrite(a, k, p);
        }
        break;
      case 'write':
        var n = Math.min(k.text.length, Math.floor(k.text.length * k.t / k.dur));
        if (n !== k.shown) {
          k.shown = n;
          var seg = k.text.slice(0, n), nl = seg.lastIndexOf('\n');
          a.typed.textContent = seg;
          k.row = (seg.match(/\n/g) || []).length; k.col = n - nl - 1;
        }
        follow(a, r.x + 9 + Math.min(k.col * 6.6, k.maxW - 18), r.y + 15 + k.row * 15, dtR, 40);
        if (k.t >= k.dur) { a.typed.textContent = k.text; k.ph = 'pause'; k.t = 0; }
        break;
      case 'pause':
        if (k.t >= PAUSE) startRender(a, k, p, t);
        break;
      case 'render':
        e = ease(Math.min(1, k.t / k.dur));
        p.el.style.clipPath = clip(1 - e, k.bottom);
        a.x = r.x + r.w * e;
        a.y = r.y + (k.mode === 'text' ? k.pt + k.lh / 2 : r.h / 2);
        if (k.t >= k.dur) {
          flash(a, p, t);
          k.t = 0;
          if (p.kind === 'measure' && k.items.length) {
            p.el.style.clipPath = p.oClip;
            k.ph = 'drop'; k.cur = 0; k.started = [];
            setStatus(a, 'aligning');
            var top = 1e9, bot = -1e9;
            k.items.forEach(function (q) { top = Math.min(top, q.y); bot = Math.max(bot, q.y + q.h); });
            place(extra(a, 'b-ruler'), r.x, bot + 6, r.w, 7);
            k.guide = extra(a, 'b-guide'); k.top = top; k.bot = bot;
          } else if (k.mode === 'kids') { p.el.style.clipPath = p.oClip; k.ph = 'lines'; k.started = []; }
          else if (k.mode === 'text') { k.ph = 'tlines'; }
          else finishPiece(a, p, t);
        }
        break;
      case 'drop':
        var STEP = 240, DUR = 320;
        for (i = 0; i < p.kids.length; i++) {
          var st = i * STEP;
          if (k.t < st) break;
          e = easeOut(Math.min(1, (k.t - st) / DUR));
          p.kids[i].el.style.opacity = e.toFixed(3);
          p.kids[i].el.style.translate = '0px ' + (-(1 - e) * 16).toFixed(1) + 'px';
          if (!k.started[i]) {
            k.started[i] = 1; k.cur = i;
            var q = k.items[i];
            place(k.guide, q.x, k.top - 10, null, k.bot - k.top + 20);
            if (i > 0) {
              var pr = k.items[i - 1], g, gx, gy;
              if (Math.abs(q.y - pr.y) < 4) { g = q.x - (pr.x + pr.w); gx = pr.x + pr.w + g / 2; gy = q.y + q.h / 2; }
              else { g = q.y - (pr.y + pr.h); gx = q.x + q.w / 2; gy = pr.y + pr.h + g / 2; }
              if (g >= 0) {
                var lab = extra(a, 'b-gap');
                lab.textContent = String(Math.round(g));
                place(lab, gx, gy);
              }
            }
          }
        }
        var c = k.items[k.cur];
        follow(a, c.x + c.w / 2, c.y - 4, dtR, 70);
        if (k.t >= (p.kids.length - 1) * STEP + DUR + 350) finishPiece(a, p, t);
        break;
      case 'lines':
        var LS = 90, LD = 260;
        for (i = 0; i < p.kids.length; i++) {
          var s2 = i * LS;
          if (k.t < s2) break;
          e = easeOut(Math.min(1, (k.t - s2) / LD));
          p.kids[i].el.style.opacity = e.toFixed(3);
          p.kids[i].el.style.translate = (-(1 - e) * 10).toFixed(1) + 'px 0px';
          if (!k.started[i]) { k.started[i] = toO(p.kids[i].el.getBoundingClientRect()); k.cur = i; }
        }
        var lr = k.started[k.cur];
        if (lr) follow(a, lr.x, lr.y + lr.h / 2, dtR, 50);
        if (k.t >= (p.kids.length - 1) * LS + LD) finishPiece(a, p, t);
        break;
      case 'tlines':
        var m = k.n - 1, L = Math.min(110, 1400 / m), f = Math.min(m, k.t / L);
        var kk = Math.floor(f) + easeOut(f - Math.floor(f));
        if (kk > m) kk = m;
        p.el.style.clipPath = clip(0, k.bottom * (1 - kk / m));
        follow(a, r.x + 12, r.y + k.pt + k.lh * (kk + 0.5), dtR, 40);
        if (k.t >= m * L) finishPiece(a, p, t);
        break;
      case 'carry':
        e = ease(Math.min(1, k.t / k.dur));
        var fo = 1 - e;
        setOff(k.el, k.ox * fo, k.oy * fo);
        a.x = k.gx + k.ox * fo; a.y = k.gy + k.oy * fo;
        if (k.t >= k.dur) {
          clearOff(k.el); k.el.classList.remove('b-dragging');
          fixes.delete(k.el);
          goIdle(a);
        }
        break;
    }
    draw(a);
  }

  // ---- loop --------------------------------------------------------------
  function startLoop() {
    if (!raf) { last = 0; raf = window.requestAnimationFrame(tick); }
  }
  function tick(ts) {
    raf = 0;
    try { step(typeof ts === 'number' ? ts : now()); }
    catch (err) {
      try { if (window.console) console.warn('[TodayBuild] stopped:', err); } catch (e2) { /* ignore */ }
      finish(); return;
    }
    if (overlay) raf = window.requestAnimationFrame(tick);
  }
  function step(t) {
    var dtR = last ? clamp(t - last, 0, 100) : 16;
    last = t;
    var y = sy(), v = Math.abs(y - lastScroll) / Math.max(1, dtR);
    lastScroll = y;
    var target = Math.min(4, 1 + v * 1.2);
    boost += (target - boost) * (target > boost ? 0.3 : 0.04);
    rate = speed * boost;
    var dtB = dtR * rate, i;
    if (t - lastLayout > 500) layout();

    if (building) {
      var vt = y - oy, H = vh(), ready = [];
      for (i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        if (p.state === 'done') continue;
        var on = p.rect.y < vt + H && p.rect.y + p.rect.h > vt;
        if (p.state === 'work') {
          if (on && t - p.since > WORK_STUCK_MS) forceDone(p);
          continue;
        }
        if (!isReady(p)) { p.seen = 0; continue; }
        if (on) {
          if (!p.seen) p.seen = t;
          else if (t - p.seen > STUCK_MS) { forceDone(p); continue; }
        } else p.seen = 0;
        if (p.rect.y < vt + H * 1.3 && p.rect.y + p.rect.h > vt - H * 0.3) ready.push(p);
      }
      var free = 0;
      for (i = 0; i < agents.length && ready.length; i++) {
        var a = agents[i];
        if (!isFree(a)) continue;
        var best = -1, bs = 1e18;
        for (var j = 0; j < ready.length; j++) {
          var q = ready[j], dx = a.x - q.rect.x, dy = a.y - q.rect.y;
          var sc = Math.sqrt(dx * dx + dy * dy) * 0.5 + (q.rect.y - vt);
          if (sc < bs) { bs = sc; best = j; }
        }
        assign(a, ready[best], t);
        ready.splice(best, 1);
      }
      agents.forEach(function (ag) { if (isFree(ag)) free++; });
      if (ready.length > free && agents.length < aMax && t >= nextSpawn) {
        spawn(); nextSpawn = t + 600 / rate;
      }
      var all = true;
      for (i = 0; i < pieces.length; i++) if (pieces[i].state !== 'done') { all = false; break; }
      if (all) endBuild();
    }

    for (i = 0; i < agents.length; i++) updateAgent(agents[i], dtB, dtR, t);
    for (i = fx.length - 1; i >= 0; i--) if (t >= fx[i].until) { rm(fx[i].el); fx.splice(i, 1); }

    if (!building) {
      var busy = (D && D.active) || agents.some(function (ag) { return ag.task && ag.task.kind !== 'enter'; });
      if (busy) { quietSince = 0; overlay.classList.remove('b-out'); }
      else {
        if (!quietSince) quietSince = t;
        var wait = hadBuild ? FADE_AFTER_BUILD : FADE_AFTER_FIX;
        if (t - quietSince > wait) overlay.classList.add('b-out');
        if (t - quietSince > wait + FADE_MS) teardown();
      }
    }
  }
  function endBuild() {
    building = false; hadBuild = true; quietSince = 0;
    rm(skipBtn); skipBtn = null;
    clearTimeout(failTimer); failTimer = 0;
    document.removeEventListener('keydown', onKey, true);
  }

  function teardown() {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    clearTimeout(failTimer); failTimer = 0;
    fixes.forEach(function (a, card) { clearOff(card); card.classList.remove('b-dragging'); });
    fixes.clear();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointermove', onMouse, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    window.removeEventListener('resize', onResize);
    rm(overlay); rm(fixedLayer);
    overlay = fixedLayer = skipBtn = youEl = null;
    agents = []; fx = [];
    building = false; hadBuild = false; quietSince = 0;
  }

  // ---- drag to fix -------------------------------------------------------
  function setOff(el, x, y) {
    if (!origTr.has(el)) origTr.set(el, el.style.translate || '');
    curOff.set(el, { x: x, y: y });
    el.style.translate = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
  }
  function clearOff(el) {
    if (origTr.has(el)) { el.style.translate = origTr.get(el); origTr.delete(el); }
    curOff.delete(el);
  }
  function abortFix(card) {
    var a = fixes.get(card);
    if (a) { fixes.delete(card); if (a.task && a.task.kind === 'fix') goIdle(a); }
    return curOff.get(card) || { x: 0, y: 0 };
  }
  function fixCard(card, offX, offY) {
    if (!document.body) return;
    ensureLayers();
    var r = toO(card.getBoundingClientRect()), gx = r.x + r.w / 2, gy = r.y + Math.min(16, r.h / 2);
    var a = null, best = 1e18;
    agents.forEach(function (c) {
      if (!isFree(c)) return;
      var d = (c.x - gx) * (c.x - gx) + (c.y - gy) * (c.y - gy);
      if (d < best) { best = d; a = c; }
    });
    if (!a) a = spawn();
    a.task = { kind: 'fix', ph: 'move', el: card, ox: offX, oy: offY, gx: gx - offX, gy: gy - offY, t: 0 };
    setStatus(a, 'fixing');
    path(a, gx, gy);
    fixes.set(card, a);
    quietSince = 0;
    if (overlay) overlay.classList.remove('b-out');
    startLoop();
  }
  function bindDrag(r) {
    if (dragRoot === r) return;
    if (dragRoot) {
      dragRoot.removeEventListener('pointerdown', onDown);
      dragRoot.removeEventListener('touchmove', onTouchMove);
      dragRoot.removeEventListener('contextmenu', onCtx);
    }
    dragRoot = r;
    r.addEventListener('pointerdown', onDown);
    r.addEventListener('touchmove', onTouchMove, { passive: false });
    r.addEventListener('contextmenu', onCtx);
  }
  function onDown(e) {
    if (D || reduced()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var tg = e.target;
    if (!tg || !tg.closest) return;
    var card = tg.closest('[data-b="card"]');
    if (!card || !dragRoot.contains(card)) return;
    var hit = tg.closest('a,button,input,textarea,select,label,summary,[contenteditable],[draggable="true"]');
    if (hit && card.contains(hit)) return;
    for (var n = card; n && n !== dragRoot; n = n.parentElement) {
      var pp = pmap && pmap.get(n);
      if (pp && pp.state !== 'done') return;
    }
    var off = abortFix(card);
    D = { el: card, id: e.pointerId, touch: e.pointerType !== 'mouse', sx: e.clientX, sy: e.clientY,
      bx: off.x, by: off.y, active: false, timer: 0 };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    if (D.touch) D.timer = setTimeout(function () { if (D && !D.active) beginDrag(); }, 450);
    else if (off.x || off.y) beginDrag();
  }
  function beginDrag() {
    D.active = true;
    clearTimeout(D.timer);
    D.el.classList.add('b-dragging');
    document.documentElement.classList.add('b-drag-on');
    try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ }
    setOff(D.el, D.bx, D.by);
    quietSince = 0;
  }
  function onMove(e) {
    if (!D || e.pointerId !== D.id) return;
    var mx = e.clientX - D.sx, my = e.clientY - D.sy;
    if (!D.active) {
      if (D.touch) { if (mx * mx + my * my > 64) endDrag(); return; }
      if (mx * mx + my * my <= 36) return;
      beginDrag();
    }
    setOff(D.el, D.bx + mx, D.by + my);
  }
  function onTouchMove(e) { if (D && D.active && e.cancelable) e.preventDefault(); }
  function onCtx(e) { if (D) e.preventDefault(); }
  function onUp(e) { if (D && e.pointerId === D.id) endDrag(); }
  function suppressClick() {
    var h = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', h, true);
    setTimeout(function () { window.removeEventListener('click', h, true); }, 0);
  }
  function endDrag() {
    var d = D; D = null;
    if (!d) return;
    clearTimeout(d.timer);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    document.documentElement.classList.remove('b-drag-on');
    if (!d.active) return;
    if (!d.touch) suppressClick();
    var o = curOff.get(d.el) || { x: 0, y: 0 };
    if (Math.abs(o.x) + Math.abs(o.y) < 1 || reduced()) { clearOff(d.el); d.el.classList.remove('b-dragging'); return; }
    try { fixCard(d.el, o.x, o.y); }
    catch (err) { clearOff(d.el); d.el.classList.remove('b-dragging'); }
  }

  // ---- public ------------------------------------------------------------
  function finish() {
    try {
      for (var i = 0; i < pieces.length; i++) revealNow(pieces[i]);
    } catch (e) { /* keep going */ }
    try {
      if (root && root.querySelectorAll) {
        var left = root.querySelectorAll('.b-wait');
        for (var j = 0; j < left.length; j++) left[j].classList.remove('b-wait');
      }
    } catch (e) { /* keep going */ }
    pieces = []; pmap = null;
    try { teardown(); } catch (e) { /* ignore */ }
    building = false;
  }

  function start(r, opts) {
    try {
      if (!r || !r.querySelectorAll || !document.body) return;
      if (reduced()) return;
      finish();
      root = r;
      var sp = opts && +opts.speed;
      speed = sp > 0 && isFinite(sp) ? sp : 1;
      var phone = isPhone(), as = opts && Math.floor(+opts.agentsStart), am = opts && Math.floor(+opts.agentsMax);
      aMax = clamp(am > 0 ? am : (phone ? 3 : 12), 1, NAMES.length);
      aStart = clamp(as > 0 ? as : (phone ? 3 : 6), 1, aMax);
      boost = 1; rate = speed; lastScroll = sy();
      collect(r);
      bindDrag(r);
      if (!pieces.length) return;
      building = true; hadBuild = false;
      ensureLayers();
      pieces.forEach(function (p) {
        p.rect = toO(p.el.getBoundingClientRect());
        var g = mk('div', 'b-ghost', overlay);
        try { g.style.borderRadius = getComputedStyle(p.el).borderRadius || ''; } catch (e) { /* ignore */ }
        place(g, p.rect.x, p.rect.y, p.rect.w, p.rect.h);
        p.ghost = g;
        p.el.classList.add('b-wait');
      });
      skipBtn = mk('button', 'b-skip', fixedLayer);
      skipBtn.type = 'button';
      skipBtn.textContent = 'Skip';
      skipBtn.setAttribute('aria-label', 'Skip the build animation');
      skipBtn.addEventListener('click', function () { finish(); });
      if (mq('(pointer: fine)')) {
        youEl = mk('div', 'b-you', fixedLayer);
        youEl.setAttribute('aria-hidden', 'true');
        mk('span', 'b-label', youEl).textContent = 'You';
        document.addEventListener('pointermove', onMouse, true);
        document.addEventListener('mouseout', onMouseOut, true);
      }
      document.addEventListener('keydown', onKey, true);
      var n = Math.min(aStart, pieces.length);
      for (var i = 0; i < n; i++) spawn();
      nextSpawn = now() + 900;
      failTimer = setTimeout(function () { if (building) finish(); }, FAILSAFE_MS);
      startLoop();
    } catch (err) {
      try { if (window.console) console.warn('[TodayBuild] start failed:', err); } catch (e) { /* ignore */ }
      finish();
    }
  }

  window.TodayBuild = {
    start: start,
    finish: finish,
    isRunning: function () { return building; }
  };
})();
