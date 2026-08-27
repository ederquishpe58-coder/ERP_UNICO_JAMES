const CACHE_VERSION = "jaeder-shell-availability-table-final-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./styles.css",
  "./styles/print.css",
  "./styles/payroll.css",
  "./styles/payroll-print.css",
  "./app.js",
  "./scripts/config/runtime-env.js",
  "./scripts/config/env.js",
  "./scripts/core/utils.js",
  "./scripts/core/performance.js",
  "./scripts/core/module-loader.js",
  "./scripts/core/storage.js",
  "./scripts/core/state.js",
  "./scripts/services/pwa.js",
  "./scripts/services/supabase/supabase-client.js",
  "./scripts/services/supabase/auth-access.js",
  "./scripts/services/sync/entity-registry.js",
  "./scripts/services/sync/indexeddb-store.js",
  "./scripts/services/sync/incremental-sync.js",
  "./scripts/services/sync/realtime-sync.js",
  "./scripts/ui/layout.js",
  "./scripts/assets/bless-flower-logo-official-transparent.png"
];

async function discoverInterfaceAssets() {
  const response = await fetch("./index.html", { cache: "no-store" });
  if (!response.ok) return [];
  const html = await response.text();
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)]
    .map(match => match[0])
    // Los módulos diferidos se guardan al abrirlos mediante networkFirstAsset.
    // Precargarlos durante install descargaba todo el ERP en segundo plano.
    .filter(tag => !/type=["']application\/x-jaeder-lazy(?:-source)?["']/i.test(tag))
    .map(tag => tag.match(/(?:src|href)=["']([^"']+)["']/i)?.[1] || "")
    .filter(value => value && !/^(?:[a-z]+:|\/\/|#)/i.test(value))
    .map(value => `./${value.replace(/^\.\//, "")}`);
  return [...new Set(references)];
}

self.addEventListener("install", event => {
  event.waitUntil(
    Promise.all([caches.open(SHELL_CACHE), discoverInterfaceAssets()])
      .then(([cache, discovered]) => cache.addAll([...new Set([...APP_SHELL, ...discovered])]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("jaeder-shell-") && ![SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(request, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal, cache: "no-store" })
    .finally(() => clearTimeout(timer));
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response?.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request))
      || (await caches.match("./index.html"))
      || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const update = fetch(request)
    .then(async response => {
      if (response?.ok && response.type === "basic") {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached || (await update) || Response.error();
}

async function networkFirstAsset(request) {
  try {
    const response = await fetchWithTimeout(request);
    if (response?.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (["script", "style"].includes(request.destination) || url.pathname.endsWith("/runtime-env.js")) {
    event.respondWith(networkFirstAsset(request));
    return;
  }
  if (["image", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
