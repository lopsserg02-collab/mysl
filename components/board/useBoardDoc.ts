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
  cursor: { x: number; y: number } | null;
  selection: string[];
}

async function fetchToken(boardId: string): Promise<string> {
  const res = await fetch("/api/realtime-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ boardId }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).token;
}

export function useBoardDoc(boardId: string, user: { id: string; name: string }) {
  const doc = useMemo(() => new Y.Doc(), [boardId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  // True once the board content is loaded, from this browser's copy or from the server.
  const [ready, setReady] = useState(false);
  const [meta, setMetaState] = useState<BoardMeta>({});
  // Items and board settings (background) share one undo history.
  const undo = useMemo(() => new Y.UndoManager([itemsMap(doc), metaMap(doc)], { captureTimeout: 400 }), [doc]);

  useEffect(() => {
    // Offline first: the board opens from the browser's copy, then merges with the server.
    const local = new IndexeddbPersistence(`mysl-board-${boardId}`, doc);
    let localLoaded = false;
    local.whenSynced.then(() => {
      localLoaded = true;
      // An empty local copy says nothing; wait for the server unless we are offline.
      if (itemsMap(doc).size > 0) setReady(true);
    });
    const url = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:1234";
    const p = new HocuspocusProvider({
      url,
      name: `board:${boardId}`,
      document: doc,
      token: () => fetchToken(boardId),
      onStatus: ({ status }) => {
        setStatus(status === "connected" ? "connected" : status === "connecting" ? "connecting" : "offline");
        if (status === "disconnected" && localLoaded) setReady(true);
      },
      onSynced: () => setReady(true),
    });
    const color = colorForUser(user.id);
    p.awareness?.setLocalStateField("user", { userId: user.id, name: user.name, color });

    let lastPeers = "[]";
    const readPeers = () => {
      const out: Peer[] = [];
      p.awareness?.getStates().forEach((s, clientId) => {
        if (clientId === doc.clientID || !s.user) return;
        out.push({ clientId, ...s.user, cursor: s.cursor ?? null, selection: s.selection ?? [] });
      });
      // Our own cursor changes the awareness too; only re-render when someone else changed.
      const key = JSON.stringify(out);
      if (key === lastPeers) return;
      lastPeers = key;
      setPeers(out);
    };
    p.awareness?.on("change", readPeers);

    // Re-read only the items an update touched; untouched items keep their object, so their views skip rendering.
    const map = itemsMap(doc);
    const cache = new Map<string, Item>();
    let order: Item[] = [];
    const index = new Map<string, number>(); // position of each item in `order`
    const resort = () => {
      order = sortItems([...cache.values()]);
      index.clear();
      order.forEach((i, k) => index.set(i.id, k));
    };
    const sync = (events?: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      if (!events) {
        cache.clear();
        map.forEach((m, id) => cache.set(id, readItem(m)));
        resort();
      } else {
        const touched = new Set<string>();
        for (const ev of events) {
          if (ev.target === map) ev.changes.keys.forEach((_, k) => touched.add(k));
          else if (typeof ev.path[0] === "string") touched.add(ev.path[0]);
        }
        // Most edits (move, text, colour) keep every item's place in the stacking order: swap the objects in place.
        let inPlace = true;
        const next = order.slice();
        touched.forEach((id) => {
          const m = map.get(id);
          const before = cache.get(id);
          if (!m) {
            cache.delete(id);
            inPlace = false;
            return;
          }
          const item = readItem(m);
          cache.set(id, item);
          if (!before || before.z !== item.z || before.type !== item.type) inPlace = false;
          else next[index.get(id)!] = item;
        });
        if (inPlace) order = next;
        else resort();
      }
      setItems(order);
    };
    map.observeDeep(sync);
    sync();
    const meta = metaMap(doc);
    const syncMeta = () => setMetaState(readMeta(doc));
    meta.observe(syncMeta);
    syncMeta();
    setProvider(p);

    return () => {
      map.unobserveDeep(sync);
      meta.unobserve(syncMeta);
      p.awareness?.off("change", readPeers);
      p.destroy();
      local.destroy();
    };
  }, [boardId, doc, user.id, user.name]);

  return { doc, provider, items, meta, status, peers, undo, ready };
}
