// Dev-only harness for public/build.js. Query params: ?speed=2  ?rm=1 (emulate reduced motion)
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  if (q.get('rm') === '1') {
    var orig = window.matchMedia.bind(window);
    window.matchMedia = function (s) {
      if (/prefers-reduced-motion/.test(s)) {
        return { matches: true, media: s, addListener: function () {}, removeListener: function () {},
          addEventListener: function () {}, removeEventListener: function () {} };
      }
      return orig(s);
    };
  }
  var frames = 0, origRaf = window.requestAnimationFrame.bind(window);
  // ?shim=1 drives frames with setTimeout (for headless / hidden preview panes that throttle rAF).
  if (q.get('shim') === '1') {
    origRaf = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
    window.cancelAnimationFrame = function (id) { clearTimeout(id); };
  }
  window.requestAnimationFrame = function (cb) { frames++; return origRaf(cb); };
  window.buildTest = { frames: function () { return frames; } };
  var speed = parseFloat(q.get('speed')) || 1;
  function go() { window.TodayBuild.start(document.getElementById('dash'), { speed: speed }); }
  document.getElementById('rerun').addEventListener('click', function () { window.TodayBuild.finish(); go(); });
  document.getElementById('fin').addEventListener('click', function () { window.TodayBuild.finish(); });
  var stat = document.getElementById('stat');
  setInterval(function () {
    stat.textContent = 'running ' + window.TodayBuild.isRunning() + ' · rAF ' + frames +
      ' · hidden ' + document.querySelectorAll('.b-wait').length +
      ' · overlay ' + !!document.querySelector('.b-overlay');
  }, 250);
  go();
})();
