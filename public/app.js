(function () {
  "use strict";
  // Never run inside another site's frame.
  if (window.top !== window.self) { document.body.innerHTML = ""; return; }
  var STORE = "today-app-v1";
  var FILE_PATH = "NOW.md";                  // the dashboard file each KB Keeper keeps current

  var REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;          // owner/name only
  var PATH_RE = /^(?!.*\.\.)[A-Za-z0-9._\/ -]+$/;              // a file in the repo, no ".."
  var $ = function (id) { return document.getElementById(id); };

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function save(obj) { try { localStorage.setItem(STORE, JSON.stringify(obj)); } catch (e) {} }

  // ---- One-tap setup links: ...#repo=owner/name&key=xxx (the part after # never leaves the phone)
  window.addEventListener("hashchange", function () { readSetupLink(); refresh(); });
  readSetupLink();
  function readSetupLink() {
    if (!location.hash || location.hash.length < 2) return;
    var p = new URLSearchParams(location.hash.slice(1));
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
  function niceDay(s) {
    var n = daysFromToday(s);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    var d = parseDay(s);
    var opts = n > 0 && n < 7 ? { weekday: "short" } : { day: "numeric", month: "short" };
    return d.toLocaleDateString("en-GB", opts);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // ---- HTML helpers. Everything from NOW.md goes through esc().
  function pill(text, tone) { return '<span class="pill ' + (tone || "") + '">' + esc(text) + "</span>"; }
  function li(title, sub, side, b) {
    return '<li data-b="' + (b || "box") + '"><span class="main"><span class="title">' + esc(title) + "</span>" +
      (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</span>" +
      (side ? '<span class="side">' + side + "</span>" : "") + "</li>";
  }
  function list(items, emptyText) {
    return '<ul class="rows">' + (items.length ? items.join("") : '<li class="empty" data-b="type">' + esc(emptyText) + "</li>") + "</ul>";
  }
  function section(heading, inner, opts) {
    opts = opts || {};
    return '<section' + (opts.cls ? ' class="' + opts.cls + '"' : "") + ">" +
      '<h2 data-b="type">' + esc(heading) + (opts.count != null ? ' <span class="count">' + esc(opts.count) + "</span>" : "") + "</h2>" +
      inner + "</section>";
  }
  function inDays(n) {
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    return "in " + n + " days";
  }
  function shortDate(s) {
    return parseDay(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // "after 2026-11-23 lottery" -> "after 23 Nov lottery" (no ISO dates in anything people read)
  function friendlyDates(text) {
    return String(text).replace(/\b(\d{4}-\d{2}-\d{2})\b/g, function (d) {
      return parseDay(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    });
  }

  // ---- Render
  var lastRendered = "", pending = null, pendingTimer = 0;
  var arr = function (x) { return Array.isArray(x) ? x : []; };
  function render(data) {
    data = data && typeof data === "object" ? data : {};
    var sig = JSON.stringify(data) + "|" + todayStr();                    // a new day re-renders even if the data is the same
    var B = window.TodayBuild;
    if (sig === lastRendered && $("board").childNodes.length) return;     // nothing changed: leave the page (and any build) alone
    if (B && B.isRunning()) {
      // Don't cut the build short: show the newer data as soon as it ends.
      pending = data;
      if (!pendingTimer) pendingTimer = setInterval(function () {
        if (window.TodayBuild.isRunning()) return;
        clearInterval(pendingTimer); pendingTimer = 0;
        var d = pending; pending = null; render(d); fadeIn();
      }, 400);
      return;
    }
    lastRendered = sig;

    var now = new Date();
    var h = now.getHours();
    var greet = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    var who = load().name || data.name;

    var todos = arr(data.todos), events = arr(data.events), waiting = arr(data.waiting), notes = arr(data.notes);
    var top = arr(data.top);
    var rank = { Urgent: 0, Important: 1, Later: 3 };
    var r = function (t) { return rank[t.priority] == null ? 2 : rank[t.priority]; };
    var onNow = function (e) {
      if (!e.date) return false;
      var a = daysFromToday(e.date), b = e.end ? daysFromToday(e.end) : a;
      return a <= 0 && b >= 0;
    };

    var eventsNow = events.filter(onNow).sort(function (a, b) { return String(a.time || "").localeCompare(String(b.time || "")); });
    var overdue = todos.filter(function (t) { return t.due && daysFromToday(t.due) < 0; })
      .sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); });
    var dueToday = todos.filter(function (t) { return t.due && daysFromToday(t.due) === 0; });

    var upcoming = []
      .concat(events.filter(function (e) { return e.date && daysFromToday(e.date) > 0; }).map(function (e) {
        var until = e.end && e.end !== e.date ? "until " + shortDate(e.end) : "";
        return { d: e.date, t: e.time, text: e.text, sub: [e.where, until].filter(Boolean).join(" · ") };
      }))
      .concat(todos.filter(function (t) { return t.due && daysFromToday(t.due) > 0; })
        .map(function (t) { return { d: t.due, text: t.text, sub: "To-do" + (t.priority ? " · " + t.priority : ""), todo: true }; }))
      .sort(function (a, b) { return (a.d + (a.t || "")).localeCompare(b.d + (b.t || "")); });
    var thisWeek = upcoming.filter(function (x) { return daysFromToday(x.d) <= 7; }).length;
    var nowCount = eventsNow.length + overdue.length + dueToday.length;

    // Header + plain-words summary
    var parts = [];
    if (overdue.length) parts.push(plural(overdue.length, "thing is", "things are") + " overdue.");
    if (eventsNow.length + dueToday.length) parts.push(plural(eventsNow.length + dueToday.length, "thing", "things") + " for today.");
    if (!parts.length) parts.push("Nothing due today.");
    if (upcoming.length) { var nx = upcoming[0]; parts.push("Next up: " + nx.text.replace(/[.;:,]+$/, "") + " " + inDays(daysFromToday(nx.d)).toLowerCase() + "."); }
    else if (!nowCount) parts.push("All clear.");
    $("head").innerHTML =
      '<h1 class="hello" data-b="type">' + esc(greet + (who ? ", " + who : "")) + "</h1>" +
      '<p class="date" data-b="type">' + esc(parseDay(todayStr()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) + "</p>" +
      '<p class="summary" data-b="type">' + esc(parts.join(" ")) + "</p>";

    // Today: tiles + only what needs doing now
    var tiles = [
      { n: nowCount, l: "Due today", hot: overdue.length > 0 },
      { n: thisWeek, l: "This week" },
      { n: todos.length, l: "To-dos" },
      { n: waiting.length, l: "Waiting to hear back" }
    ].map(function (t) {
      return '<div class="tile' + (t.hot ? " hot" : "") + '"><span class="num">' + esc(t.n) + '</span><span class="lbl">' + esc(t.l) + "</span></div>";
    }).join("");
    var nowRows = [];
    top.forEach(function (t) { nowRows.push(li(t, "", pill("Top 3", "accent"))); });
    eventsNow.forEach(function (e) {
      var multi = e.end && e.end !== e.date ? "until " + shortDate(e.end) : "";
      var at = e.time && daysFromToday(e.date) === 0 ? e.time : "All day";
      nowRows.push(li(e.text, [e.where, multi].filter(Boolean).join(" · "), '<span class="when">' + esc(at) + "</span>"));
    });
    overdue.forEach(function (t) { nowRows.push(li(t.text, "Was due " + shortDate(t.due), pill("Overdue", "warn"))); });
    dueToday.forEach(function (t) { nowRows.push(li(t.text, t.detail, pill("Due today", "accent"))); });
    var todayInner = '<div class="tiles" data-b="measure">' + tiles + "</div>" +
      (nowRows.length ? list(nowRows) : "");

    // Coming up: every future date, amber within two weeks
    var comingRows = upcoming.map(function (x) {
      var n = daysFromToday(x.d);
      var when = shortDate(x.d) + (x.t ? " · " + x.t : "");
      return li(x.text, [when, x.sub].filter(Boolean).join(" · "), pill(inDays(n), n <= 14 ? "amber" : ""));
    });

    // To-dos: everything open, most important first, dated ones by date
    var todoRows = todos.slice().sort(function (a, b) {
      return (r(a) - r(b)) || String(a.due || "9999").localeCompare(String(b.due || "9999"));
    }).map(function (t) {
      var sub = t.due ? (daysFromToday(t.due) < 0 ? "Was due " : "Due ") + shortDate(t.due)
        : t.tbc ? friendlyDates(String(t.tbc).replace(/^TBC\b\s*/i, "Date to be confirmed ").trim()) : "Anytime";
      if (t.detail) sub += " · " + t.detail;
      var tone = t.priority === "Urgent" ? "warn" : t.priority === "Important" ? "accent" : "";
      return li(t.text, sub, t.priority ? pill(t.priority, tone) : "");
    });

    // Waiting on
    var waitRows = waiting.map(function (w) {
      var n = w.since ? -daysFromToday(w.since) : null;
      var asked = n == null ? "" : n <= 0 ? "asked today" : n === 1 ? "asked yesterday" : "asked " + n + " days ago";
      var status = n != null && n >= 7 ? pill("No reply yet", "warn") : pill("Waiting");
      return li(w.who, [w.what, asked].filter(Boolean).join(" · "), status, "card");
    });

    var html = section("Today", todayInner, { cls: "hero" }) +
      section("Coming up", list(comingRows, "Nothing coming up."), { count: upcoming.length ? upcoming.length : null }) +
      section("To-dos", list(todoRows, "No to-dos. Nice."), { count: todos.length ? todos.length : null }) +
      section("Waiting to hear back", list(waitRows, "Not waiting on anyone."), { count: waiting.length ? waiting.length : null });
    if (notes.length) {
      html += section("Notes", notes.map(function (n) {
        return '<div class="callout" data-b="card">' + esc(typeof n === "string" ? n : n.text) + "</div>";
      }).join(""));
    }
    var cfg = load();
    if (!cfg.demo && cfg.repo && REPO_RE.test(cfg.repo)) {
      var base = "https://github.com/" + cfg.repo;
      var links = [["Everything saved", base], ["Projects", base + "/tree/main/projects"], ["Decisions", base + "/tree/main/decisions"], ["Today's list", base + "/blob/main/NOW.md"]];
      html += '<details class="nb" data-b="box"><summary>Behind the scenes</summary><div class="links">' + links.map(function (l) {
        return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + "</a>";
      }).join("") + "</div></details>";
    }
    $("board").innerHTML = html;

    var stamp = data.changed || data.updated;
    $("updated").textContent = "";
    if (stamp) {
      var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(stamp);
      var u = dateOnly ? parseDay(stamp) : new Date(stamp);
      $("updated").textContent = isNaN(u) ? "" : "Last updated " + (dateOnly ? niceDay(stamp)
        : u.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
    }

    playBuild();
  }

  // The build animation (design agreed in agent-desk threads/today-app-design.md):
  // full build on the first open of the day; later opens just fade in, with a small Replay button.
  var built = false;
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function startBuild() {
    var B = window.TodayBuild;
    // A running fade-in animation would override the build's hiding, so drop it first.
    ["head", "board"].forEach(function (id) { $(id).classList.remove("fade-in"); });
    try { B.start($("dash"), { speed: 1 }); } catch (e) { try { B.finish(); } catch (e2) {} }
  }
  function playBuild() {
    var B = window.TodayBuild;
    if (built || $("dash").hidden) return;
    built = true;
    $("replay").hidden = !B || calm;
    if (!B || calm) return;
    var cfg = load(), day = todayStr();
    if (cfg.builtOn !== day) { cfg.builtOn = day; save(cfg); startBuild(); return; }
    fadeIn();
  }
  function fadeIn() {
    if (calm) return;
    ["head", "board"].forEach(function (id) { var el = $(id); el.classList.remove("fade-in"); void el.offsetWidth; el.classList.add("fade-in"); });
  }

  function showMsg(text) { var m = $("dashMsg"); m.textContent = text; m.hidden = !text; }

  // ---- Fetch from the private GitHub notebook
  function toData(text) {
    var t = String(text || "").replace(/^\uFEFF/, "");
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
      if (k === "key") showMsg("Your key has stopped working. Tap “Reconnect” below and paste a new one.");
      else if (k === "noaccess") showMsg("Your key can't open this notebook yet. It needs read access to it — once that's fixed, tap “Refresh” below.");
      else if (k === "missing") showMsg("Your page isn't ready yet. Tell your bot something and check back soon.");
      else showMsg(cfg.last ? "Can't connect right now, so this is your last saved view." : "Can't connect right now. Check your internet and try again.");
      // No saved copy: show only the message. An empty page would wrongly say "All clear".
    });
  }

  function showSetup(msg) {
    if (window.TodayBuild) window.TodayBuild.finish();   // never leave the build overlay over the setup screen
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
  $("refresh").onclick = refresh;
  $("replay").onclick = function () { var B = window.TodayBuild; if (!B) return; B.finish(); window.scrollTo(0, 0); startBuild(); };
  // Reconnect forgets the key and the saved copy of the page.
  $("reset").onclick = function () { var c = load(); delete c.key; delete c.demo; delete c.last; save(c); showSetup(); };

  // Only re-check while the dashboard is showing, so switching apps mid-setup (to copy the key) keeps what was typed.
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("dash").hidden) refresh(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  refresh();
})();
