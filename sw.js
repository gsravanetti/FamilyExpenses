/*
  Service worker intenzionalmente minimale.
  Memorizza solo l'interfaccia statica; NON intercetta le richieste esterne
  verso Google, quindi dati del foglio e token OAuth non entrano in CacheStorage.
*/
var CACHE_NAME = 'conti-shell-v1';
var ASSET_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(ASSET_SHELL);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (name) {
      return name !== CACHE_NAME;
    }).map(function (name) { return caches.delete(name); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);
  // Mai gestire API Sheets, Google Identity o altre origini: niente cache dati.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Rete prima: quando aggiorni index.html su GitHub Pages, la PWA riceve la
  // versione nuova; la cache serve solo come ripiego se la rete non c'è.
  event.respondWith(fetch(request).then(function (response) {
    if (response.ok && request.destination !== 'document') {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(request, clone); });
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
    });
  }));
});
