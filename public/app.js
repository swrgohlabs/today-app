(function () {
  "use strict";
  // Never run inside another site's frame.
  if (window.top !== window.self) { document.body.innerHTML = ""; return; }
  var STORE = "today-app-v1";
  var FILE_PATH = "NOW.md";                  // the dashboard file each KB Keeper keeps current
  var COMING_DAYS = 14;                       // how far ahead "Coming up" looks

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
    return d.toLocaleDateString(undefined, opts);
  }
  function ago(s) {
    var n = -daysFromToday(s);
    if (n <= 0) return "since today";
    if (n === 1) return "since yesterday";
    return n + " days";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function row(when, whenClass, what, sub) {
    return '<li><span class="when ' + (whenClass || "") + '">' + esc(when) + '</span>' +
      '<span class="what">' + esc(what) + (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") + "</span></li>";
  }
  function fill(id, rows, emptyText) {
    $(id).innerHTML = rows.length ? rows.join("") : '<li class="empty">' + esc(emptyText) + "</li>";
  }

  // ---- Render
  function render(data) {
    var now = new Date();
    var h = now.getHours();
    var greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    var who = load().name || data.name;
    $("hello").textContent = greet + (who ? ", " + who : "");
    $("date").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

    var todos = data.todos || [], events = data.events || [], waiting = data.waiting || [], notes = data.notes || [];
    var top = data.top || [];

    // Today = top 3 + events on today + to-dos due today, overdue, or with no date yet
    var todayRows = [];
    top.forEach(function (t) { todayRows.push(row("Top 3", "now", t, "")); });
    var onNow = function (e) {
      if (!e.date) return false;
      var a = daysFromToday(e.date), b = e.end ? daysFromToday(e.end) : a;
      return a <= 0 && b >= 0;
    };
    events.filter(onNow)
      .sort(function (a, b) { return String(a.time || "").localeCompare(String(b.time || "")); })
      .forEach(function (e) {
        var multi = e.end && e.end !== e.date ? "until " + niceDay(e.end) : "";
        todayRows.push(row(e.time && daysFromToday(e.date) === 0 ? e.time : "All day", "now", e.text, [e.where, multi].filter(Boolean).join(" · ")));
      });
    todos.filter(function (t) { return t.due && daysFromToday(t.due) < 0; })
      .sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); })
      .forEach(function (t) { todayRows.push(row("Overdue", "late", t.text, "was due " + niceDay(t.due))); });
    todos.filter(function (t) { return t.due && daysFromToday(t.due) === 0; })
      .forEach(function (t) { todayRows.push(row("To do", "now", t.text, t.detail)); });
    var rank = { Urgent: 0, Important: 1, Later: 3 };
    var r = function (t) { return rank[t.priority] == null ? 2 : rank[t.priority]; };
    todos.filter(function (t) { return !t.due; })
      .sort(function (a, b) { return r(a) - r(b); })
      .forEach(function (t) {
        var sub = t.detail || (t.tbc ? String(t.tbc).replace(/^TBC\b\s*/i, "date to be confirmed ").trim() : "");
        var urgent = t.priority === "Urgent";
        todayRows.push(row(urgent ? "Urgent" : "Anytime", urgent ? "now" : "", t.text, sub));
      });
    fill("today", todayRows, "Nothing for today. Enjoy it!");

    fill("waiting", waiting.map(function (w) {
      return row(w.since ? ago(w.since) : "", "", w.who + (w.what ? " — " + w.what : ""), "");
    }), "Not waiting on anyone.");

    var upcoming = []
      .concat(events.filter(function (e) { return e.date; }).map(function (e) {
        var until = e.end && e.end !== e.date ? "until " + niceDay(e.end) : "";
        return { d: e.date, t: e.time, text: e.text, sub: [e.where, until].filter(Boolean).join(" · ") };
      }))
      .concat(todos.filter(function (t) { return t.due; }).map(function (t) { return { d: t.due, text: t.text, sub: "to do" }; }))
      .filter(function (x) { var n = daysFromToday(x.d); return n > 0 && n <= COMING_DAYS; })
      .sort(function (a, b) { return (a.d + (a.t || "")).localeCompare(b.d + (b.t || "")); });
    fill("coming", upcoming.map(function (x) {
      return row(niceDay(x.d), "", x.text, [x.t, x.sub].filter(Boolean).join(" · "));
    }), "Nothing in the next two weeks.");

    $("notesWrap").hidden = !notes.length;
    fill("notes", notes.map(function (n) { return row("", "", typeof n === "string" ? n : n.text, ""); }), "");

    var stamp = data.changed || data.updated;
    $("updated").textContent = "";
    if (stamp) {
      var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(stamp);
      var u = dateOnly ? parseDay(stamp) : new Date(stamp);
      $("updated").textContent = isNaN(u) ? "" : "Last updated " + (dateOnly ? niceDay(stamp)
        : u.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }));
    }
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
        if (r.status === 404) throw { kind: "missing" };
        if (!r.ok) throw { kind: "other" };
        return r.text();
      }).then(toData);
    return Promise.all([file, changed]).then(function (v) { if (v[1]) v[0].changed = v[1]; return v[0]; });
  }

  function refresh() {
    var cfg = load();
    if (!cfg.demo && !(cfg.repo && cfg.key && REPO_RE.test(cfg.repo))) return showSetup();
    if (cfg.path && !PATH_RE.test(cfg.path)) delete cfg.path;
    $("setup").hidden = true; $("dash").hidden = false;
    if (cfg.last) render(cfg.last);           // show last copy instantly
    fetchData(cfg).then(function (data) {
      showMsg("");
      cfg = load(); cfg.last = data; save(cfg);
      render(data);
    }).catch(function (err) {
      var k = err && err.kind;
      if (k === "key") showMsg("Your key has stopped working. Tap “Reconnect” below and paste a new one.");
      else if (k === "missing") showMsg("Your page isn't ready yet. Tell your bot something and check back soon.");
      else showMsg(cfg.last ? "Can't connect right now, so this is your last saved view." : "Can't connect right now. Check your internet and try again.");
      if (!cfg.last && k !== "key") render({});
    });
  }

  function showSetup(msg) {
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
  // Reconnect forgets the key and the saved copy of the page.
  $("reset").onclick = function () { var c = load(); delete c.key; delete c.demo; delete c.last; save(c); showSetup(); };

  // Only re-check while the dashboard is showing, so switching apps mid-setup (to copy the key) keeps what was typed.
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !$("dash").hidden) refresh(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  refresh();
})();
