const CACHE_NAME = 'fuel-up-v14';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=20261026_stable',
  './app.js',
  './manifest.json?v=20261021',
  './icon.svg?v=20261021',
  './apple-touch-icon.png?v=20261021',
  './icon-192.png?v=20261021',
  './icon-512.png?v=20261021'
];

// 安装阶段立即接管
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 激活阶段彻底清理旧版本缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 核心优化：Stale-While-Revalidate (缓存秒开 + 后台静默刷新)
// 彻底解决每次从手机主屏幕点开时等待跨国网络握手造成的 2-5 秒白屏！
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      // 1. 后台异步静默发起网络请求，检查并刷新本地缓存
      const fetchPromise = fetch(e.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // 弱网或离线时静默捕获，不干扰用户使用
        });

      // 2. 本地有缓存直接 0 毫秒秒开返回！彻底告别白屏！
      // 3. 仅在首次全新安装、尚未建立缓存时等待网络返回
      return cachedResponse || fetchPromise;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});