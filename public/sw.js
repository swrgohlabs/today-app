// Caches the app itself so it opens instantly/offline. Data is never cached here
// (the page keeps its own last copy in localStorage).
const CACHE = "today-shell-v5";
const SHELL = ["./", "app.js", "build.js", "build.css", "now-parser.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // GitHub API: straight to network
  // Network first, always revalidated (a 304 is cheap), so app updates show on next open.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
      if (r.ok && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === "navigate" ? caches.match("./") : undefined))));
});
