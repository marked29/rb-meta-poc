"use strict";

var CACHE_NAME = "mrbd-field-checklist-v10";
var APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "data/sample-instructions.json",
  "data/malformed-instructions.json",
  "public/fasteners.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE_NAME;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "index.html"));
    return;
  }

  var url = new URL(request.url);
  var isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin) {
    return;
  }

  if (url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function cacheFirst(request) {
  return caches.match(request, { ignoreSearch: true }).then(function (cached) {
    if (cached) {
      return cached;
    }

    return fetch(request).then(function (response) {
      cacheResponse(request, response.clone());
      return response;
    });
  });
}

function networkFirst(request, fallbackUrl) {
  return fetch(request)
    .then(function (response) {
      cacheResponse(request, response.clone());
      return response;
    })
    .catch(function () {
      return caches.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached) {
          return cached;
        }

        if (fallbackUrl) {
          return caches.match(fallbackUrl);
        }

        return new Response("", {
          status: 503,
          statusText: "Offline"
        });
      });
    });
}

function cacheResponse(request, response) {
  if (!response || response.status !== 200) {
    return;
  }

  caches.open(CACHE_NAME).then(function (cache) {
    cache.put(request, response);
  });
}
