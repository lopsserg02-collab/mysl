// The service worker never answers for private or auth routes, and keeps only build files and board pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceWorkerSource } from "./sw";

type Handler = (event: unknown) => void;

function load(version = "v1") {
  const handlers = new Map<string, Handler>();
  const self = { addEventListener: (type: string, fn: Handler) => handlers.set(type, fn), location: { origin: "https://mysl.test" }, skipWaiting() {}, clients: { claim: async () => {} } };
  const store = { match: async () => undefined, put: async () => {}, delete: async () => true };
  const caches = { open: async () => store, delete: async () => true, keys: async () => [] };
  new Function("self", "caches", "fetch", serviceWorkerSource(version))(self, caches, async () => new Response(""));
  /** Whether the worker answers a request itself (true) or leaves it to the network untouched (false). */
  const handles = (url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) => {
    let responded = false;
    const request = { url: `https://mysl.test${url}`, method: init.method ?? "GET", mode: init.mode ?? "cors", headers: new Headers(init.headers ?? {}) };
    handlers.get("fetch")!({ request, respondWith: () => (responded = true), waitUntil: () => {} });
    return responded;
  };
  return { handlers, handles };
}

test("service worker: parses, and carries its version in the cache names", () => {
  const src = serviceWorkerSource("abc123");
  assert.match(src, /const VERSION = "abc123"/);
  assert.match(src, /Нет сети/);
  const { handlers } = load();
  assert.ok(handlers.has("fetch") && handlers.has("activate") && handlers.has("message"));
});

test("service worker: API, auth, sign-in, actions, data requests and other sites are never served from cache", () => {
  const { handles } = load();
  assert.equal(handles("/api/realtime-token", { method: "POST" }), false);
  assert.equal(handles("/api/assets/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10"), false);
  assert.equal(handles("/api/assets/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10?k=00", { mode: "navigate" }), false);
  assert.equal(handles("/auth/callback?code=x", { mode: "navigate" }), false);
  assert.equal(handles("/login", { mode: "navigate" }), false);
  assert.equal(handles("/board/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10", { method: "POST", mode: "navigate" }), false, "server actions");
  assert.equal(handles("/board/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10", { headers: { RSC: "1" } }), false);
  assert.equal(handles("/board/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10?_rsc=1"), false);
  assert.equal(handles("/", {}), false);
});

test("service worker: build files and board pages go through the worker; guest links are not kept", () => {
  const { handles } = load();
  assert.equal(handles("/_next/static/chunks/app.js"), true);
  assert.equal(handles("/board/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10", { mode: "navigate" }), true);
  // A guest link (?k=) and other pages only get the offline notice when the network fails; nothing is stored.
  assert.equal(handles("/board/0b6c3f3e-1d2a-4c55-9a51-1f7c2b6a9e10?k=0123", { mode: "navigate" }), true);
  assert.doesNotMatch(serviceWorkerSource("x"), /PAGES\)\)\.put\(request/);
});
