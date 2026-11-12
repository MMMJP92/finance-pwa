/* 财务管理 PWA 离线缓存（GitHub Pages 托管）
   sw.js 与页面同在站点根目录，默认作用域覆盖整个站点，
   因此可以缓存页面本身，断网冷启动从桌面图标打开时由缓存提供页面。
   注意：绝不缓存 Microsoft 登录与 Graph API 的请求。 */
var CACHE = "finance-pwa-v11";
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
        if (failed.length) console.warn("离线缓存未完成，缺少：" + failed.join(", "));
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
  /* 登录与云端数据请求永远走网络，不进缓存 */
  if (url.indexOf("login.microsoftonline.com") >= 0 ||
      url.indexOf("graph.microsoft.com") >= 0 ||
      url.indexOf("msauth.net") >= 0) return;
  /* 页面导航：网络优先，断网时回退到缓存里的页面 */
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
  /* 静态资源：缓存优先，后台更新 */
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
