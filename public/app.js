(function () {
  "use strict";
  // Never run inside another site's frame.
  if (window.top !== window.self) { document.body.innerHTML = ""; return; }
  var STORE = "today-app-v1";
  var FILE_PATH = "NOW.md";                  // the dashboard file each KB Keeper keeps current
  var TABS = ["today", "coming", "todos", "waiting"];
  var TITLES = { today: "Today", coming: "Coming up", todos: "To-dos", waiting: "Waiting to hear back" };

  var REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;          // owner/name only
  var PATH_RE = /^(?!.*\.\.)[A-Za-z0-9._\/ -]+$/;              // a file in the repo, no ".."
  var $ = function (id) { return document.getElementById(id); };
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function save(obj) { try { localStorage.setItem(STORE, JSON.stringify(obj)); } catch (e) {} }
  function hashTab() { var h = location.hash.slice(1); return TABS.indexOf(h) >= 0 ? h : ""; }

  // ---- One-tap setup links: ...#repo=owner/name&key=xxx (the part after # never leaves the phone).
  // Tab hashes (#today, #coming, …) are navigation, not setup links.
  function readSetupLink() {
    if (!location.hash || location.hash.length < 2 || hashTab()) return false;
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.has("repo") && !p.has("key") && !p.has("demo") && !p.has("name") && !p.has("path")) return false;
    history.replaceState(null, "", location.pathname);   // strip the key from the address bar first
    var cfg = load();
    var repo = (p.get("repo") || "").trim(), key = (p.get("key") || "").trim(), path = (p.get("path") || "").trim();
    if (p.get("demo") !== null) { cfg.demo = true; }
    if (repo && REPO_RE.test(repo)) {
      // A key only ever goes with the notebook it was set up for.
      if (repo !== cfg.repo && !key) delete cfg.key;
      if (repo !== cfg.repo) delete cfg.last;
      cfg.repo = repo; delete cfg.demo;
    }
    if (key && /^[A-Za-z0-9_]+$/.test(key)) { cfg.key = key; }
    if (path && PATH_RE.test(path)) { cfg.path = path; }
    if (p.get("name")) { cfg.name = p.get("name").trim().slice(0, 40); }
    save(cfg);
    return true;
  }

  // ---- Dates. "Today" is the Singapore date, same rule the KBs use (AGENTS.md).
  var SGT;
  try { SGT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }); } catch (e) {}
  function todayStr(d) {
    d = d || new Date();
    if (SGT) { var s = SGT.format(d); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; }
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseDay(s) { var a = String(s).slice(0, 10).split("-"); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function daysFromToday(s) { return Math.round((parseDay(s) - parseDay(todayStr())) / 86400000); }
  function fmt(s, opts) { return parseDay(s).toLocaleDateString("en-GB", opts); }
  function shortDate(s) { return fmt(s, { weekday: "short", day: "numeric", month: "short" }); }   // "Fri 20 Nov"
  function fmtTime(t) {                                                                               // "15:00" -> "3pm"
    var m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); if (!m) return "";
    var h = +m[1], ap = h < 12 ? "am" : "pm"; h = h % 12 || 12;
    return h + (m[2] === "00" ? "" : ":" + m[2]) + ap;
  }
  function dateLabel(start, end, time) {                                                              // "Mon 16 – Wed 18 Nov, 3pm"
    var s;
    if (end && end !== start) {
      var sameMonth = start.slice(0, 7) === end.slice(0, 7);
      s = (sameMonth ? fmt(start, { weekday: "short", day: "numeric" }) : shortDate(start)) + " – " + shortDate(end);
    } else s = shortDate(start);
    return s + (time ? ", " + fmtTime(time) : "");
  }
  function inDays(n) { return n <= 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // "after 2026-11-23 lottery" -> "after 23 Nov lottery" (no ISO dates in anything people read)
  function friendlyDates(text) {
    return String(text).replace(/\b(\d{4}-\d{2}-\d{2})\b/g, function (d) { return fmt(d, { day: "numeric", month: "short" }); });
  }
  function updatedText(stamp) {
    if (!stamp) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) {
      var n = daysFromToday(stamp);
      return n === 0 ? "Updated today" : n === -1 ? "Updated yesterday" : "Updated on " + fmt(stamp, { day: "numeric", month: "short" });
    }
    var t = new Date(stamp); if (isNaN(t)) return "";
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "Updated just now";
    if (min < 60) return "Updated " + min + " min ago";
    if (min < 24 * 60) return "Updated " + plural(Math.round(min / 60), "hour", "hours") + " ago";
    var day = daysFromToday(todayStr(t));
    return day === -1 ? "Updated yesterday" : "Updated on " + t.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  // ---- HTML helpers. Everything from NOW.md goes through esc().
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pill(text, tone) { return '<span class="pill ' + (tone || "") + '">' + esc(text) + "</span>"; }
  function row(title, sub, side, opts) {
    opts = opts || {};
    return '<li data-b="box"><span class="main"><span class="title">' + esc(title) + "</span>" +
      (sub ? '<span class="sub' + (opts.late ? " late" : "") + '">' + esc(sub) + "</span>" : "") + "</span>" +
      (side ? '<span class="side">' + side + "</span>" : "") + "</li>";
  }
  function group(heading, rows, tag) {
    if (!rows.length) return "";
    tag = tag || "ul";
    return '<h2 class="group-h" data-b="type">' + esc(heading) + "</h2>" +
      "<" + tag + ' class="rows' + (tag === "ol" ? " top3" : "") + '">' + rows.join("") + "</" + tag + ">";
  }
  function empty(text) { return '<p class="empty" data-b="type">' + esc(text) + "</p>"; }
  var arr = function (x) { return Array.isArray(x) ? x : []; };

  // ---- Model: turn parsed NOW.md into what the tabs need
  function model(data) {
    // Coerce everything to the shapes the tabs expect (the JSON path or an old saved copy could be odd).
    var str = function (x) { return x == null ? "" : String(x); };
    var DAY = /^\d{4}-\d{2}-\d{2}$/;
    var todos = arr(data.todos).filter(function (t) { return t && t.text; }).map(function (t) {
      return { text: str(t.text), priority: str(t.priority), due: DAY.test(t.due) ? t.due : "", tbc: str(t.tbc), detail: str(t.detail) };
    });
    var events = arr(data.events).filter(function (e) { return e && DAY.test(e.date) && e.text; }).map(function (e) {
      return { text: str(e.text), date: e.date, end: DAY.test(e.end) ? e.end : "", time: str(e.time), where: str(e.where) };
    });
    var waiting = arr(data.waiting).filter(function (w) { return w && w.who; }).map(function (w) {
      return { who: str(w.who), what: str(w.what), since: DAY.test(w.since) ? w.since : "" };
    });
    var notes = arr(data.notes).map(function (n) { return str(typeof n === "string" ? n : n && n.text); }).filter(Boolean);
    var top = arr(data.top).map(str).filter(Boolean);
    var endN = function (e) { return daysFromToday(e.end || e.date); };

    var eventsNow = events.filter(function (e) { return daysFromToday(e.date) <= 0 && endN(e) >= 0; })
      .sort(function (a, b) { return String(a.time || "").localeCompare(String(b.time || "")); });
    var overdue = todos.filter(function (t) { return t.due && daysFromToday(t.due) < 0; })
      .sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); });
    var dueToday = todos.filter(function (t) { return t.due && daysFromToday(t.due) === 0; });
    var tomorrow = events.filter(function (e) { return daysFromToday(e.date) === 1; })
      .concat(todos.filter(function (t) { return t.due && daysFromToday(t.due) === 1; }));

    // Coming up: everything from today on (ongoing ranges count as today)
    var coming = events.filter(function (e) { return endN(e) >= 0; }).map(function (e) {
      return { n: Math.max(0, daysFromToday(e.date)), key: (daysFromToday(e.date) < 0 ? todayStr() : e.date) + (e.time || ""),
        text: e.text, when: dateLabel(e.date, e.end, e.time), sub: e.where };
    }).concat(todos.filter(function (t) { return t.due && daysFromToday(t.due) >= 0; }).map(function (t) {
      return { n: daysFromToday(t.due), key: t.due + "~", text: t.text, when: shortDate(t.due), sub: "To-do" };
    })).sort(function (a, b) { return a.key.localeCompare(b.key); });

    var wd = (parseDay(todayStr()).getDay() + 6) % 7;     // Monday = 0
    var thisWeekEnd = 6 - wd, nextWeekEnd = thisWeekEnd + 7;
    return {
      todos: todos, events: events, waiting: waiting, notes: notes, top: top,
      eventsNow: eventsNow, overdue: overdue, dueToday: dueToday, tomorrow: tomorrow, coming: coming,
      thisWeekEnd: thisWeekEnd, nextWeekEnd: nextWeekEnd,
      nowCount: eventsNow.length + overdue.length + dueToday.length,
      thisWeek: coming.filter(function (x) { return x.n <= thisWeekEnd; }).length,   // same as the "This week" group
      urgentDot: todos.some(function (t) { return t.priority === "Urgent" && t.due && daysFromToday(t.due) <= 0; }),
      soonDot: coming.some(function (x) { return x.n <= 1; })
    };
  }

  // ---- Tab: Today
  function paneToday(m, who) {
    var h = new Date().getHours();
    var greet = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    var parts = [];
    if (m.overdue.length) parts.push(plural(m.overdue.length, "thing is", "things are") + " overdue.");
    var todayN = m.eventsNow.length + m.dueToday.length;
    if (todayN) parts.push(plural(todayN, "thing", "things") + " for today.");
    if (!parts.length) parts.push("Nothing due today.");
    var nx = m.coming.filter(function (x) { return x.n > 0; })[0];
    if (nx) parts.push("Next up: " + nx.text.replace(/[.;:,]+$/, "") + " " + inDays(nx.n) + ".");
    else if (!m.nowCount) parts.push("All clear.");

    var tiles = [
      { n: m.nowCount, l: "Due today", hot: m.overdue.length > 0, go: "now" },
      { n: m.thisWeek, l: "This week", go: "coming" },
      { n: m.todos.length, l: "To-dos", go: "todos" },
      { n: m.waiting.length, l: "Waiting", go: "waiting" }
    ].map(function (t) {
      return '<button class="tile' + (t.hot ? " hot" : "") + '" data-go="' + t.go + '" aria-label="' + esc(t.n + " " + t.l) + '">' +
        '<span class="num">' + esc(t.n) + '</span><span class="lbl">' + esc(t.l) + "</span></button>";
    }).join("");

    var nowRows = [];
    m.eventsNow.forEach(function (e) {
      var multi = e.end && e.end !== e.date ? "Until " + shortDate(e.end) : "";
      var at = e.time && daysFromToday(e.date) === 0 ? fmtTime(e.time) : "All day";
      nowRows.push(row(e.text, [e.where, multi].filter(Boolean).join(" · "), '<span class="when">' + esc(at) + "</span>"));
    });
    m.overdue.forEach(function (t) { nowRows.push(row(t.text, "Was due " + shortDate(t.due), "", { late: true })); });
    m.dueToday.forEach(function (t) { nowRows.push(row(t.text, t.detail, '<span class="when">Today</span>')); });
    m.tomorrow.forEach(function (x) {
      var at = x.time ? fmtTime(x.time) : "Tomorrow";
      nowRows.push(row(x.text, x.date && x.time ? "Tomorrow" : (x.due ? "To-do" : ""), '<span class="when">' + esc(at) + "</span>"));
    });

    var html = '<header id="head">' +
      '<h1 class="hello" data-b="type">' + esc(greet + (who ? ", " + who : "")) + "</h1>" +
      '<p class="date" data-b="type">' + esc(fmt(todayStr(), { weekday: "long", day: "numeric", month: "long" })) + "</p>" +
      '<p class="summary" data-b="type">' + esc(parts.join(" ")) + "</p></header>" +
      '<div class="tiles" data-b="measure">' + tiles + "</div>" +
      group("Top 3", m.top.map(function (t) { return row(t, "", ""); }), "ol") +
      '<div id="nowList">' + group("Today and tomorrow", nowRows) + "</div>";
    if (!m.top.length && !nowRows.length) html += empty("Nothing on today. Enjoy it.");
    if (m.notes.length) {
      html += '<h2 class="group-h" data-b="type">Notes</h2>' +
        m.notes.map(function (n) { return '<div class="callout" data-b="card">' + esc(n) + "</div>"; }).join("");
    }
    html += '<div class="pane-foot"><p class="meta" id="updated"></p><button class="linkbtn" id="about">About this page</button></div>';
    return html;
  }

  // ---- Tab: Coming up (Things-style time groups)
  function paneComing(m) {
    if (!m.coming.length) return empty("Nothing coming up. A quiet stretch.");
    var g = { week: [], next: [], later: [] };
    m.coming.forEach(function (x) {
      var r = row(x.text, [x.when, x.sub].filter(Boolean).join(" · "), pill(inDays(x.n), x.n <= 14 ? "amber" : "plain"));
      (x.n <= m.thisWeekEnd ? g.week : x.n <= m.nextWeekEnd ? g.next : g.later).push(r);
    });
    return group("This week", g.week) + group("Next week", g.next) + group("Later", g.later);
  }

  // ---- Tab: To-dos (priority carried by the group heading, no pills)
  function paneTodos(m) {
    if (!m.todos.length) return empty("All clear.");
    var groups = Object.create(null);
    groups.Urgent = []; groups.Important = []; groups.Later = []; groups.Other = [];
    m.todos.slice().sort(function (a, b) { return String(a.due || "9999").localeCompare(String(b.due || "9999")); })
      .forEach(function (t) {
        var late = t.due && daysFromToday(t.due) < 0;
        var sub = t.due ? (late ? "Was due " : "Due ") + shortDate(t.due) : "No date yet";
        if (!t.due && t.tbc) {
          var extra = friendlyDates(String(t.tbc).replace(/^TBC\b\s*/i, "").replace(/^\((.*)\)$/, "$1").trim());
          if (extra) sub += " · " + extra;
        }
        if (t.detail) sub += " · " + t.detail;
        (groups[t.priority] || groups.Other).push(row(t.text, sub, "", { late: late }));
      });
    return group("Urgent", groups.Urgent) + group("Important", groups.Important) + group("Later", groups.Later) +
      group(groups.Urgent.length + groups.Important.length + groups.Later.length ? "Other" : "To-dos", groups.Other);
  }

  // ---- Tab: Waiting (one card per item, longest wait first)
  function paneWaiting(m) {
    if (!m.waiting.length) return empty("Not waiting on anyone.");
    return '<div class="cards">' + m.waiting.slice().sort(function (a, b) {
      return String(a.since || "9999").localeCompare(String(b.since || "9999"));
    }).map(function (w) {
      var n = w.since ? -daysFromToday(w.since) : null;
      var asked = n == null ? "" : n <= 0 ? "Asked today" : n === 1 ? "Asked yesterday" : "Asked " + n + " days ago";
      return '<div class="card" data-b="card"><div class="top"><span class="who">' + esc(w.who) + "</span>" +
        (n != null && n >= 7 ? pill("No reply yet", "warn") : "") + "</div>" +
        (w.what ? '<div class="what">' + esc(w.what) + "</div>" : "") +
        (asked ? '<div class="meta">' + esc(asked) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }

  // ---- Render all tabs
  var lastRendered = "", lastData = null, pending = null, pendingTimer = 0;
  function render(data) {
    data = data && typeof data === "object" ? data : {};
    lastData = data;
    var sig = JSON.stringify(data) + "|" + todayStr();                    // a new day re-renders even if the data is the same
    var B = window.TodayBuild;
    if (sig === lastRendered && $("pane-today").childNodes.length) { setUpdated(); return; }
    if (B && B.isRunning()) {
      // Don't cut the build short: show the newer data as soon as it ends.
      pending = data;
      if (!pendingTimer) pendingTimer = setInterval(function () {
        if (window.TodayBuild.isRunning()) return;
        clearInterval(pendingTimer); pendingTimer = 0;
        var d = pending; pending = null; if (safeRender(d)) fadeIn();
      }, 400);
      return;
    }
    var m = model(data);
    var who = load().name || data.name;
    $("pane-today").innerHTML = paneToday(m, who);
    $("pane-coming").innerHTML = paneComing(m);
    $("pane-todos").innerHTML = paneTodos(m);
    $("pane-waiting").innerHTML = paneWaiting(m);
    lastRendered = sig;

    setDot("todos", m.urgentDot);
    setDot("coming", m.soonDot);
    setUpdated();
    $("about").onclick = openSheet;
    [].forEach.call($("pane-today").querySelectorAll(".tile"), function (b) {
      b.onclick = function () {
        var go = b.getAttribute("data-go");
        if (go === "now") { var el = $("nowList"); if (el && el.firstChild) el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" }); }
        else location.hash = go;
      };
    });
    fillSheetLinks();
    onScroll();
    playBuild();
  }
  function setUpdated() { var u = $("updated"); if (u && lastData) u.textContent = updatedText(lastData.changed || lastData.updated); }
  function setDot(tab, on) {
    var a = document.querySelector('.tab[data-tab="' + tab + '"]'); if (!a) return;
    a.querySelector(".dot").hidden = !on;
    var label = (tab === "todos" ? "To-dos" : "Coming up") + (on ? (tab === "todos" ? ", something urgent is due" : ", something today or tomorrow") : "");
    a.setAttribute("aria-label", label);
  }

  // ---- Tabs
  var current = "today", scrolls = {};
  function showTab(name, opts) {
    opts = opts || {};
    if (TABS.indexOf(name) < 0) name = "today";
    var B = window.TodayBuild;
    if (name !== "today" && B && B.isRunning()) B.finish();             // other tabs always show instantly
    if (name === current && !opts.force) return;
    scrolls[current] = window.scrollY;
    current = name;
    document.body.setAttribute("data-tab", name);
    TABS.forEach(function (t) {
      $("pane-" + t).hidden = t !== name;
      var a = document.querySelector('.tab[data-tab="' + t + '"]');
      if (t === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    $("barTitle").textContent = TITLES[name];
    // On Today the big greeting is the page heading; elsewhere the bar title is.
    if (name === "today") $("barTitle").setAttribute("aria-hidden", "true"); else $("barTitle").removeAttribute("aria-hidden");
    var pane = $("pane-" + name);
    if (!calm && !opts.force) { pane.classList.remove("fade-tab"); void pane.offsetWidth; pane.classList.add("fade-tab"); }
    window.scrollTo(0, scrolls[name] || 0);
    onScroll();
  }
  [].forEach.call(document.querySelectorAll(".tab"), function (a) {
    a.addEventListener("click", function (e) {
      if (a.getAttribute("data-tab") === current) {                      // tapping the current tab scrolls to the top
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
      }
    });
  });

  // Slim bar: hairline once content is under it; on Today the title appears once the big greeting scrolls away.
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY;
      $("appbar").classList.toggle("scrolled", y > 2);
      var h1 = document.querySelector("#pane-today .hello");
      var titled = current !== "today" || (h1 && y > h1.offsetTop + h1.offsetHeight - 44);
      $("appbar").classList.toggle("titled", !!titled);
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---- About sheet
  var lastFocus = null;
  function openSheet() {
    lastFocus = document.activeElement;
    $("scrim").hidden = false; $("sheet").hidden = false;
    $("replay").hidden = !window.TodayBuild || calm;
    setInert(true);
    $("sheetDone").focus();
  }
  // While the sheet is open, the page behind it can't be focused or read out.
  function setInert(on) {
    [$("appbar"), document.querySelector("#dash > main"), document.querySelector(".tabbar")].forEach(function (el) {
      if (!el) return;
      if (on) { el.setAttribute("inert", ""); el.setAttribute("aria-hidden", "true"); }
      else { el.removeAttribute("inert"); el.removeAttribute("aria-hidden"); }
    });
  }
  function closeSheet() {
    if ($("sheet").hidden) return;
    $("scrim").hidden = true; $("sheet").hidden = true;
    setInert(false);
    var back = lastFocus && document.contains(lastFocus) ? lastFocus : $("about");   // the page may have re-rendered meanwhile
    if (back && back.focus) back.focus();
  }
  function fillSheetLinks() {
    var cfg = load(), box = $("sheetLinks");
    if (cfg.demo || !cfg.repo || !REPO_RE.test(cfg.repo)) { box.innerHTML = ""; box.hidden = true; return; }
    var base = "https://github.com/" + cfg.repo;
    var links = [["Everything saved", base], ["Projects", base + "/tree/main/projects"], ["Decisions", base + "/tree/main/decisions"], ["Today's list", base + "/blob/main/NOW.md"]];
    box.innerHTML = links.map(function (l) {
      return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + "</a>";
    }).join("");
    box.hidden = false;
  }
  $("scrim").onclick = closeSheet;
  $("sheetDone").onclick = closeSheet;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

  // ---- The build animation (agent-desk threads/today-app-design.md): first open of the day, Today tab only.
  var built = false;
  function startBuild() {
    var B = window.TodayBuild;
    $("pane-today").classList.remove("fade-in", "fade-tab");           // a running fade would override the build's hiding
    try { B.start($("pane-today"), { speed: 1 }); } catch (e) { try { B.finish(); } catch (e2) {} }
  }
  function playBuild() {
    var B = window.TodayBuild;
    if (built || $("dash").hidden) return;
    built = true;
    if (!B || calm || current !== "today") return;
    var cfg = load(), day = todayStr();
    if (cfg.builtOn !== day) { cfg.builtOn = day; save(cfg); startBuild(); return; }
    fadeIn();
  }
  function fadeIn() {
    if (calm) return;
    var el = $("pane-today"); el.classList.remove("fade-in"); void el.offsetWidth; el.classList.add("fade-in");
  }

  function showMsg(text) { var m = $("dashMsg"); m.textContent = text; m.hidden = !text; }

  // ---- Fetch from the private GitHub notebook
  function toData(text) {
    var t = String(text || "").replace(/^﻿/, "");
    return /^\s*\{/.test(t) ? JSON.parse(t) : window.parseNow(t);   // NOW.md, or a JSON summary if path points at one
  }
  function api(cfg, path, accept) {
    return fetch("https://api.github.com/repos/" + cfg.repo + "/" + path, {
      headers: { "Authorization": "Bearer " + cfg.key, "Accept": accept },
      cache: "no-store"
    });
  }
  function fetchData(cfg) {
    if (cfg.demo) return fetch("today.example.md", { cache: "no-store" }).then(function (r) { return r.text(); }).then(toData);
    var path = cfg.path || FILE_PATH;
    // When the file last changed (best effort; the page works without it)
    var changed = api(cfg, "commits?per_page=1&path=" + encodeURIComponent(path), "application/vnd.github+json")
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (c) { return c && c[0] && c[0].commit && c[0].commit.committer && c[0].commit.committer.date; })
      .catch(function () { return undefined; });
    var file = api(cfg, "contents/" + path.split("/").map(encodeURIComponent).join("/") + "?t=" + Date.now(), "application/vnd.github.raw+json")
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw { kind: "key" };
        if (r.status === 404) {
          // GitHub says "not found" both when the file is missing and when the key can't see the repo at all.
          return fetch("https://api.github.com/repos/" + cfg.repo, {
            headers: { "Authorization": "Bearer " + cfg.key, "Accept": "application/vnd.github+json" }, cache: "no-store"
          }).then(function (rr) { throw { kind: rr.status === 404 ? "noaccess" : "missing" }; },
                  function () { throw { kind: "missing" }; });
        }
        if (!r.ok) throw { kind: "other" };
        return r.text();
      }).then(toData);
    return Promise.all([file, changed]).then(function (v) { if (v[1]) v[0].changed = v[1]; return v[0]; });
  }

  function safeRender(data) {
    try { render(data); return true; } catch (e) { return false; }
  }
  var loadSeq = 0;
  function refresh() {
    var cfg = load();
    if (!cfg.demo && !(cfg.repo && cfg.key && REPO_RE.test(cfg.repo))) return showSetup();
    if (cfg.path && !PATH_RE.test(cfg.path)) delete cfg.path;
    $("setup").hidden = true; $("dash").hidden = false;
    if (cfg.last && !safeRender(cfg.last)) { delete cfg.last; save(cfg); }   // show last copy instantly; drop it if it's broken
    var seq = ++loadSeq;
    fetchData(cfg).then(function (data) {
      if (seq !== loadSeq) return;            // a newer load started; ignore this older answer
      showMsg("");
      if (!safeRender(data)) throw { kind: "other" };
      cfg = load(); cfg.last = data; save(cfg);  // only keep data that rendered
    }).catch(function (err) {
      if (seq !== loadSeq) return;
      var k = err && err.kind;
      if (k === "key") showMsg("Your key has stopped working. Open “About this page” at the bottom of Today and tap Reconnect.");
      else if (k === "noaccess") showMsg("Your key can't open this notebook yet. It needs read access to it — once that's fixed, reopen the app.");
      else if (k === "missing") showMsg("Your page isn't ready yet. Tell your bot something and check back soon.");
      else showMsg(cfg.last ? "Can't connect right now, so this is your last saved view." : "Can't connect right now. Check your internet and try again.");
      if (!cfg.last && k === "key") openSheet();
    });
  }

  function showSetup(msg) {
    if (window.TodayBuild) window.TodayBuild.finish();   // never leave the build overlay over the setup screen
    closeSheet();
    var cfg = load();
    $("dash").hidden = true; $("setup").hidden = false;
    $("repo").value = cfg.repo || "";
    $("name").value = cfg.name || "";
    var m = $("setupMsg"); m.textContent = msg || ""; m.hidden = !msg;
  }

  $("save").onclick = function () {
    var repo = $("repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    var key = $("key").value.trim();
    if (!REPO_RE.test(repo)) return showSetup("Please enter the notebook like name/NotebookName.");
    if (!key) return showSetup("Please paste your key.");
    if (!/^[A-Za-z0-9_]+$/.test(key)) return showSetup("That key doesn't look right. Please copy it again, without spaces.");
    var cfg = load(); cfg.repo = repo; cfg.key = key; delete cfg.demo; delete cfg.last;
    var name = $("name").value.trim(); if (name) cfg.name = name; else delete cfg.name;
    save(cfg);
    $("key").value = "";
    refresh();
  };
  $("refresh").onclick = function () { closeSheet(); refresh(); };
  $("replay").onclick = function () {
    var B = window.TodayBuild; if (!B) return;
    closeSheet(); B.finish();
    if (current !== "today") location.hash = "today";
    window.scrollTo(0, 0); startBuild();
  };
  // Reconnect forgets the key and the saved copy of the page.
  $("reset").onclick = function () { var c = load(); delete c.key; delete c.demo; delete c.last; save(c); showSetup(); };

  window.addEventListener("hashchange", function () {
    var t = hashTab();
    if (t) { showTab(t); return; }
    if (readSetupLink()) { showTab("today"); refresh(); return; }
    showTab("today");                                                    // Back to the bare page, or an unknown hash
  });
  // Only re-check while the dashboard is showing, so switching apps mid-setup (to copy the key) keeps what was typed.
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("dash").hidden) refresh(); });

  // ---- Start: setup link first, then Today by default (a tab hash is kept on reload).
  readSetupLink();
  showTab(hashTab() || "today", { force: true });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  refresh();
})();
