/* Finance Manager PWA offline cache (hosted on GitHub Pages)
   sw.js lives at the site root alongside the page, so its default scope covers the whole site,
   which lets it cache the page itself, so a cold start from the home-screen icon while offline is served from cache.
   Note: never cache Microsoft sign-in or Graph API requests. */
var CACHE = "finance-pwa-v5";
var PAGE_URL = "https://mmmjp92.github.io/finance-pwa/";
var SHELL = [
  PAGE_URL,
  "manifest.webmanifest",
  "icon.svg",
  "icon-maskable.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      var failed = [];
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { failed.push(u); });
      })).then(function () {
        if (failed.length) console.warn("Offline cache incomplete, missing: " + failed.join(", "));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = e.request.url;
  if (e.request.method !== "GET") return;
  /* Sign-in and cloud data requests always go to the network, never into the cache */
  if (url.indexOf("login.microsoftonline.com") >= 0 ||
      url.indexOf("graph.microsoft.com") >= 0 ||
      url.indexOf("msauth.net") >= 0) return;
  /* Page navigation: network first, fall back to the cached page when offline */
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(PAGE_URL, copy); });
        return resp;
      }).catch(function () {
        return caches.match(PAGE_URL, { ignoreSearch: true })
          .then(function (m) { return m || caches.match(e.request, { ignoreSearch: true }); });
      })
    );
    return;
  }
  /* Static assets: cache first, refresh in the background */
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (resp) {
        if (resp && resp.status === 200 && url.indexOf(self.location.origin) === 0) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
