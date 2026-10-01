const CACHE = "pmt-roster-static-v2";
const STATIC = ["/roster.html", "/roster.css", "/roster.js", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (!STATIC.includes(url.pathname)) return;
  event.respondWith(fetch(request).then((response) => {
    if (!response.ok) return response;
    const copy = response.clone();
    return caches.open(CACHE).then((cache) => cache.put(request, copy)).then(() => response);
  }).catch(async () => await caches.match(request) || new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } })));
});
