// Turns a KB's NOW.md into the data the Today page shows.
// Forgiving on purpose: KB Keepers write slightly different line styles.
//
//   ## Top 3 today     - anything
//   ## To-do           - [ ] Task — priority: Important — area: Personal — due: 2026-12-22
//                      - [ ] Task — Important · Personal · due 2026-12-22
//                      (due: TBC, or no due at all, means "no date yet"; ticked [x] lines are skipped)
//   ## Important dates - 2026-12-21 — 18:00 van pickup      (time may lead the text)
//                      - 2026-12-22 to 2026-12-23 — Yushan hike
//   ## Waiting on      - Who — what — since 2026-11-02
//   ## Notes           - anything
(function (root) {
  "use strict";

  var DATE = /\d{4}-\d{2}-\d{2}/;
  var SEP = /\s+[—–]\s+|\s+-{1,2}\s+/;          // " — ", " – ", " - ", " -- "
  var META = /^(priority|area|due|urgent|important|later)\b/i;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // "projects/taiwan-trip-2026-12" -> "Taiwan trip (Dec 2026)"
  function noteName(path) {
    var n = path.split("/").pop().replace(/\.md$/, ""), when = "";
    var ym = /-(\d{4})-(\d{2})(?:-\d{2})?$/.exec(n);
    if (ym && +ym[2] >= 1 && +ym[2] <= 12) { when = " (" + MONTHS[+ym[2] - 1] + " " + ym[1] + ")"; n = n.slice(0, ym.index); }
    n = n.replace(/[-_]+/g, " ").trim();
    return n.charAt(0).toUpperCase() + n.slice(1) + when;
  }

  function tidy(s) {
    return String(s || "")
      .replace(/\s*\(\s*\[\[[^\]]+\]\]\s*\)/g, "")                       // "([[note]])" -> ""
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")                        // [[path|Label]] -> Label
      .replace(/\[\[([^\]]+)\]\]/g, function (_, p) { return noteName(p); })
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")                         // [text](url) -> text
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sectionKey(heading) {
    var h = heading.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (/^top\b/.test(h)) return "top";
    if (/^to ?do/.test(h) || /^tasks?$/.test(h)) return "todos";
    if (/dates?$/.test(h) || /^(events|calendar|coming up)$/.test(h)) return "events";
    if (/^waiting/.test(h)) return "waiting";
    if (/^notes?$/.test(h)) return "notes";
    return null;
  }

  // -> [{ key, items: [{ text, done }] }]
  function sections(md) {
    var text = String(md || "").replace(/\r\n?/g, "\n")
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    var out = {}, cur = null;
    text.split("\n").forEach(function (line) {
      var h = /^#{2,6}\s+(.*)$/.exec(line);
      if (h) { cur = sectionKey(h[1]); if (cur && !out[cur]) out[cur] = []; return; }
      if (!cur) return;
      var li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!li) return;
      var body = li[1], done = false;
      var box = /^\[([ xX])\]\s*(.*)$/.exec(body);
      if (box) { done = box[1] !== " "; body = box[2]; }
      if (body.trim()) out[cur].push({ text: body, done: done });
    });
    return out;
  }

  function parseTodo(raw) {
    var parts = raw.split(SEP), keep = [], meta = [];
    parts.forEach(function (p, i) {
      // Split "Important · Personal · due ..." into its pieces too
      var bits = p.split(/\s*·\s*/);
      if (i > 0 && bits.every(function (b) { return META.test(b.trim()) || /^(work|personal)$/i.test(b.trim()); })) meta = meta.concat(bits);
      else keep.push(p);
    });
    var t = { text: tidy(keep.join(" — ")) };
    meta.forEach(function (m) {
      m = m.trim();
      var due = /^due:?\s*(.*)$/i.exec(m);
      if (due) {
        var d = DATE.exec(due[1]);
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(due[1].trim())) t.due = d[0];
        else if (due[1].trim()) t.tbc = tidy(due[1]);          // "TBC", "TBC (after 2026-11-23 lottery)"
        return;
      }
      var pr = /^(?:priority:?\s*)?(urgent|important|later)\b/i.exec(m);
      if (pr) t.priority = pr[1].charAt(0).toUpperCase() + pr[1].slice(1).toLowerCase();
    });
    return t;
  }

  function parseEvent(raw) {
    var m = /^\s*(\d{4}-\d{2}-\d{2})(?:\s*(?:to|until|–|—|-)\s*(\d{4}-\d{2}-\d{2}))?\s*(?:(\d{1,2}:\d{2})\s*)?\s*(?:[—–:-]+\s*)?([\s\S]*)$/.exec(raw);
    if (!m) return null;
    var e = { date: m[1], text: m[4] };
    if (m[2]) e.end = m[2];
    if (m[3]) e.time = m[3];
    var lead = /^(\d{1,2}:\d{2})\s*[—–-]?\s*(.*)$/.exec(e.text);   // "18:00 van pickup"
    if (!e.time && lead) { e.time = lead[1]; e.text = lead[2]; }
    var at = !e.time && /\bat (\d{1,2}:\d{2})\b/i.exec(e.text);                 // "Van pickup at 18:00"
    if (at) { e.time = at[1]; e.text = e.text.replace(/\s*\bat \d{1,2}:\d{2}\b/i, ""); }
    if (e.time && e.time.length === 4) e.time = "0" + e.time;
    e.text = tidy(e.text);
    e.text = e.text.charAt(0).toUpperCase() + e.text.slice(1);
    return e;
  }

  function parseWaiting(raw) {
    var parts = raw.split(SEP), w = {};
    var last = parts[parts.length - 1];
    var since = /^since:?\s*(.*)$/i.exec(last.trim());
    if (parts.length > 1 && since) { parts.pop(); var d = DATE.exec(since[1]); if (d) w.since = d[0]; }
    w.who = tidy(parts.shift());
    if (parts.length) w.what = tidy(parts.join(" — "));
    return w;
  }

  function parseNow(md) {
    var s = sections(md), fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(md || ""));
    var updated = fm && /^updated:\s*["']?(\S+?)["']?\s*$/m.exec(fm[1]);
    var open = function (k) { return (s[k] || []).filter(function (i) { return !i.done; }).map(function (i) { return i.text; }); };
    return {
      updated: updated ? updated[1] : undefined,
      top: open("top").map(tidy).filter(Boolean),
      todos: open("todos").map(parseTodo).filter(function (t) { return t.text; }),
      events: open("events").map(parseEvent).filter(Boolean),
      waiting: open("waiting").map(parseWaiting).filter(function (w) { return w.who; }),
      notes: open("notes").map(tidy).filter(Boolean)
    };
  }

  if (typeof module !== "undefined" && module.exports) module.exports = parseNow;
  else root.parseNow = parseNow;
})(this);
