"use client";
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { itemsMap, metaMap, readItem, readMeta, sortItems, type BoardMeta, type Item } from "@/lib/board/model";
import { colorForUser } from "@/lib/board/palette";

export type ConnStatus = "connecting" | "connected" | "offline";

export interface Peer {
  clientId: number;
  userId: string;
  name: string;
  color: { fill: string; label: string };
  selection: string[];
}

/** Another person's pointer on the board (board coordinates). */
export interface PeerCursor {
  clientId: number;
  name: string;
  color: { fill: string; label: string };
  x: number;
  y: number;
}

/**
 * Live cursors, kept outside React state: they change dozens of times a second per person, and only the
 * cursor layer subscribes to them, so a moving cursor never re-renders the board.
 */
export interface CursorStore {
  get(): PeerCursor[];
  subscribe(listener: () => void): () => void;
}

function cursorStore() {
  let value: PeerCursor[] = [];
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next: PeerCursor[]) {
      value = next;
      listeners.forEach((l) => l());
    },
  };
}

/** Runs `fn` once in the next animation frame however often it is asked for (a timer when the tab is hidden). */
function perFrame(fn: () => void) {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    pending = 0;
    clearTimeout(timer);
    timer = undefined;
    fn();
  };
  return {
    schedule() {
      if (pending || timer) return;
      if (typeof document !== "undefined" && document.hidden) timer = setTimeout(run, 50);
      else pending = requestAnimationFrame(run);
    },
    flush() {
      if (pending || timer) {
        cancelAnimationFrame(pending);
        run();
      }
    },
    cancel() {
      cancelAnimationFrame(pending);
      clearTimeout(timer);
      pending = 0;
      timer = undefined;
    },
  };
}

async function fetchToken(boardId: string, guestSecret?: string): Promise<string> {
  const res = await fetch("/api/realtime-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(guestSecret ? { boardId, k: guestSecret } : { boardId }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).token;
}

/** guestSecret: viewing by link without signing in. Guests keep no copy of the board in this browser. */
export function useBoardDoc(boardId: string, user: { id: string; name: string }, guestSecret?: string) {
  const doc = useMemo(() => new Y.Doc(), [boardId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  const cursors = useMemo(() => cursorStore(), [boardId]);
  // True once the board content is loaded, from this browser's copy or from the server.
  const [ready, setReady] = useState(false);
  const [meta, setMetaState] = useState<BoardMeta>({});
  // Items and board settings (background) share one undo history.
  const undo = useMemo(() => new Y.UndoManager([itemsMap(doc), metaMap(doc)], { captureTimeout: 400 }), [doc]);

  useEffect(() => {
    // Offline first: the board opens from the browser's copy, then merges with the server.
    // Content that arrived from the browser's copy or the server is applied before the board says it is ready,
    // so the first view fits the content.
    let flushItems = () => {};
    const markReady = () => {
      flushItems();
      setReady(true);
    };
    const local = guestSecret ? null : new IndexeddbPersistence(`mysl-board-${boardId}`, doc);
    let localLoaded = false;
    let online = navigator.onLine;
    let socket: ConnStatus = "connecting";
    // No network at all says more than the socket's own state, which keeps "connecting" while it retries.
    const report = () => setStatus(online ? socket : "offline");
    local?.whenSynced.then(() => {
      localLoaded = true;
      // An empty local copy says nothing; wait for the server unless we are offline.
      if (itemsMap(doc).size > 0 || !online) markReady();
    });
    const onOnline = () => {
      online = true;
      report();
      // Reconnect now rather than at the end of the retry backoff; the edits made offline then merge.
      void p.configuration.websocketProvider.connect();
    };
    const onOffline = () => {
      online = false;
      report();
      if (localLoaded) markReady();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    report();
    const url = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:1234";
    const p = new HocuspocusProvider({
      url,
      name: `board:${boardId}`,
      document: doc,
      token: () => fetchToken(boardId, guestSecret),
      onStatus: ({ status }) => {
        socket = status === "connected" ? "connected" : status === "connecting" ? "connecting" : "offline";
        report();
        if (status === "disconnected" && localLoaded) markReady();
      },
      onSynced: () => markReady(),
    });
    const color = colorForUser(user.id);
    p.awareness?.setLocalStateField("user", { userId: user.id, name: user.name, color });

    // Awareness changes arrive many times a second with many people on the board: read them at most once
    // per frame. People (avatars, selections) go to React state only when they change; cursors go to the store.
    let lastPeers = "[]";
    let lastCursors = "";
    const readAwareness = perFrame(() => {
      const out: Peer[] = [];
      const pointers: PeerCursor[] = [];
      p.awareness?.getStates().forEach((s, clientId) => {
        if (clientId === doc.clientID || !s.user) return;
        out.push({ clientId, userId: s.user.userId, name: s.user.name, color: s.user.color, selection: s.selection ?? [] });
        if (s.cursor) pointers.push({ clientId, name: s.user.name, color: s.user.color, x: s.cursor.x, y: s.cursor.y });
      });
      const key = JSON.stringify(out);
      if (key !== lastPeers) {
        lastPeers = key;
        setPeers(out);
      }
      const ckey = pointers.map((c) => `${c.clientId}:${c.x},${c.y}`).join(";");
      if (ckey !== lastCursors) {
        lastCursors = ckey;
        cursors.set(pointers);
      }
    });
    const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      // Our own cursor changes the awareness too: nothing to read for that.
      if (added.length + removed.length === 0 && updated.every((id) => id === doc.clientID)) return;
      readAwareness.schedule();
    };
    p.awareness?.on("change", onAwareness);

    // Re-read only the items an update touched; untouched items keep their object, so their views skip rendering.
    // Our own edits show at once; other people's are gathered and applied once per frame, so a stream of them
    // costs one render a frame, not one per update.
    const map = itemsMap(doc);
    const cache = new Map<string, Item>();
    let order: Item[] = [];
    const index = new Map<string, number>(); // position of each item in `order`
    const resort = () => {
      order = sortItems([...cache.values()]);
      index.clear();
      order.forEach((i, k) => index.set(i.id, k));
    };
    const pending = new Set<string>();
    const apply = () => {
      if (pending.size === 0) return;
      // Most edits (move, text, colour) keep every item's place in the stacking order: swap the objects in place.
      let inPlace = true;
      const next = order.slice();
      pending.forEach((id) => {
        const m = map.get(id);
        const before = cache.get(id);
        if (!m) {
          if (before) inPlace = false;
          cache.delete(id);
          return;
        }
        const item = readItem(m);
        cache.set(id, item);
        if (!before || before.z !== item.z || before.type !== item.type) inPlace = false;
        else next[index.get(id)!] = item;
      });
      pending.clear();
      if (inPlace) order = next;
      else resort();
      setItems(order);
    };
    const remote = perFrame(apply);
    flushItems = () => remote.flush();
    const sync = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
      for (const ev of events) {
        if (ev.target === map) ev.changes.keys.forEach((_, k) => pending.add(k));
        else if (typeof ev.path[0] === "string") pending.add(ev.path[0]);
      }
      if (tr.local) {
        remote.cancel();
        apply();
      } else remote.schedule();
    };
    map.forEach((m, id) => cache.set(id, readItem(m)));
    resort();
    setItems(order);
    map.observeDeep(sync);
    const meta = metaMap(doc);
    const syncMeta = () => setMetaState(readMeta(doc));
    meta.observe(syncMeta);
    syncMeta();
    setProvider(p);

    return () => {
      map.unobserveDeep(sync);
      meta.unobserve(syncMeta);
      remote.cancel();
      readAwareness.cancel();
      p.awareness?.off("change", onAwareness);
      p.destroy();
      local?.destroy();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [boardId, doc, user.id, user.name, guestSecret, cursors]);

  return { doc, provider, items, meta, status, peers, cursors: cursors as CursorStore, undo, ready };
}
